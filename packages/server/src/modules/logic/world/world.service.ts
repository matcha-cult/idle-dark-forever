/**
 * `WorldService` —— 权威世界运行时（cmd 30 核心）
 *
 * 职责：
 * 1. **受管 tick 循环**：`setInterval(WORLD_CONFIG.tickIntervalMs)`，每个「在线且已选角」
 *    的角色一棵 `RealClock` + 一个 `BattleWorld`；tick 内 `pause()` + `stepPaused(rest, budget)`
 *    推进（固定预算，绝不阻塞事件循环）；
 * 2. **事件批次聚合**：`BattleCollector` 收集本 tick 的全部战斗事件 → `WorldTickDto`
 *    → `NOTIFICATION_BATCHER.enqueue`（**绝不逐伤害推送**）；
 * 3. **持久化节流**：只在关键节点（进/出地图、离线结算、切人）与 ~30s 周期落库。
 *
 * 时钟语义：`stepPaused` 要求时钟处于暂停态；因此会话启动后即 `pause()`，
 * 每个 tick 用「距上次 tick 的真实毫秒」作为推进量（自动对齐墙钟，且有 catch-up 上限）。
 */
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  checkRequirement,
  RealClock,
  type Clock,
  type DataTables,
  type EnemyUnit,
  type InventorySlot,
  type Player,
} from '@idle-dark/game-core';
import {
  type ActionResult,
  BATTLE_CMD,
  BusinessErrorCode,
  type LootDto,
  type OfflineReportDto,
  WORLD_CMD,
  type WorldSnapshotDto,
  type WorldTickDto,
  fail,
  ok,
} from '@idle-dark/protocol';
import type { NotificationBatcher } from '../../game/notification-batcher.js';
import { NOTIFICATION_BATCHER } from '../../game/notification-batcher.provider.js';
import { OnlineSessionService } from '../../online/online-session.service.js';
import { DATA_TABLES, GAME_CLOCK, PlayerContextService, type AccountExtras, type NowSource, slotDtoOf } from '../shared/index.js';
import { BattleCollector } from './internal/battle-collector.js';
import { buildBattleWorld, nextWorldSeed } from './internal/headless.js';
import { mapListDtoOf, pendingOfflineMsOf, requirementContextOf } from './internal/map-dto.js';
import { unitStateDtoOf } from './internal/unit-state.js';
import { OFFLINE_MAX_MS, WORLD_CONFIG } from './world.config.js';

/** Tick 上限：单一真相。 */
export const WORLD_TICK_MS = WORLD_CONFIG.tickIntervalMs;

interface WorldSession {
  userId: number;
  characterId: string;
  clock: Clock;
  collector: BattleCollector;
  world: ReturnType<typeof buildBattleWorld>['world'];
  seed: number;
  carryMs: number;
  lastTickAt: number;
  lastPersistAt: number;
  pendingLoot: LootDto[];
}

@Injectable()
export class WorldService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorldService.name);
  private readonly now: NowSource;
  private readonly tables: DataTables;
  private readonly sessions = new Map<string, WorldSession>();
  /** `userId → 最近一次 `player.select` 的角色`（前端后续请求不带 key 时的权威解析）。 */
  private readonly activeByUser = new Map<number, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCursor = 0;
  private persisting = false;
  private destroyed = false;

  constructor(
    private readonly playerContext: PlayerContextService,
    private readonly onlineSessions: OnlineSessionService,
    @Inject(NOTIFICATION_BATCHER) private readonly batcher: NotificationBatcher,
    @Inject(GAME_CLOCK) now: NowSource,
    @Inject(DATA_TABLES) tables: DataTables,
  ) {
    this.now = now;
    this.tables = tables;
  }

  // ────────────────────────────── 生命周期 ──────────────────────────────

  onModuleInit(): void {
    // 推送合并策略：`world.tick` 累积事件 + 取最新单位快照 + 累加经验/金币。
    this.batcher.registerMerger(WORLD_CMD.cmd, WORLD_CMD.tick, mergeWorldTick);
    // `battle.loot` 在一个批次内累积成数组（前端做防御式处理；见交付报告"未闭合项"）。
    this.batcher.registerMerger(BATTLE_CMD.cmd, BATTLE_CMD.loot, mergeLoot);
    this.startLoop();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.stopLoop();
    for (const session of [...this.sessions.values()]) {
      this.disposeSession(session);
    }
    this.sessions.clear();
    void this.playerContext.flushAll().catch(() => undefined);
  }

  private startLoop(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), WORLD_CONFIG.tickIntervalMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  private stopLoop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ────────────────────────────── tick ──────────────────────────────

  /** 单次心跳（同步；落库异步且有并发保护）。 */
  tick(): void {
    if (this.destroyed) return;
    const now = this.now();
    const keys = [...this.sessions.keys()];
    if (keys.length === 0) return;

    const limit = Math.min(keys.length, WORLD_CONFIG.maxCharactersPerTick);
    for (let i = 0; i < limit; i++) {
      const key = keys[(this.tickCursor + i) % keys.length];
      if (key === undefined) continue;
      const session = this.sessions.get(key);
      if (!session) continue;
      try {
        this.tickSession(session, now);
      } catch (error) {
        this.logger.warn(`world tick 失败：${session.characterId}`, {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.tickCursor = (this.tickCursor + limit) % Math.max(keys.length, 1);

    void this.maybeFlush();
  }

  private tickSession(session: WorldSession, now: number): void {
    // 离线角色：不推送、不推进（离线收益由 idle 域结算）。
    if (!this.onlineSessions.isOnline(session.userId, now)) return;

    const elapsed = Math.max(0, now - session.lastTickAt);
    session.lastTickAt = now;
    const rest = Math.min(elapsed, WORLD_CONFIG.maxCatchUpMs) + session.carryMs;
    if (rest > 0) {
      const remaining = session.clock.stepPaused(
        rest,
        WORLD_CONFIG.callbackBudgetPerCharacterPerTick,
      );
      session.carryMs = remaining > 0 ? remaining : 0;
    }

    this.emitTick(session, now);

    if (now - session.lastPersistAt >= WORLD_CONFIG.persistIntervalMs) {
      session.lastPersistAt = now;
      this.playerContext.markDirty(session.userId, session.characterId);
      this.schedulePersist(session);
    }
  }

  private emitTick(session: WorldSession, now: number): void {
    const frame = session.collector.drain();
    const units = session.world.units.map((unit) =>
      unitStateDtoOf(unit, session.world.playerUnit),
    );
    const payload: WorldTickDto = {
      serverTime: now,
      units,
      events: frame.events,
      gainedExp: frame.gainedExp,
      gainedGold: frame.gainedGold,
    };
    this.batcher.enqueue(session.userId, {
      cmd: WORLD_CMD.cmd,
      subCmd: WORLD_CMD.tick,
      data: payload,
    });

    if (session.pendingLoot.length > 0) {
      const loots = session.pendingLoot.splice(0, session.pendingLoot.length);
      for (const loot of loots) {
        this.batcher.enqueue(session.userId, {
          cmd: BATTLE_CMD.cmd,
          subCmd: BATTLE_CMD.loot,
          data: loot,
        });
      }
    }
  }

  private schedulePersist(session: WorldSession): void {
    if (this.persisting) return;
    this.persisting = true;
    void this.playerContext
      .flush(session.userId, session.characterId)
      .catch((error: unknown) => {
        this.logger.warn(`世界定时落库失败：${session.characterId}`, {
          reason: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.persisting = false;
      });
  }

  private async maybeFlush(): Promise<void> {
    if (this.persisting) return;
    this.persisting = true;
    try {
      await this.playerContext.flushDirty();
    } catch {
      // 落库失败不阻塞模拟；下个周期重试。
    } finally {
      this.persisting = false;
    }
  }

  // ────────────────────────────── 会话 ──────────────────────────────

  private keyOf(userId: number, characterId: string): string {
    return `${userId}\u0000${characterId}`;
  }

  isInBattle(userId: number, characterId: string): boolean {
    return this.sessions.has(this.keyOf(userId, characterId));
  }

  activeCharacterIds(userId: number): string[] {
    const prefix = `${userId}\u0000`;
    const out: string[] = [];
    for (const key of this.sessions.keys()) {
      if (key.startsWith(prefix)) out.push(key.slice(prefix.length));
    }
    return out;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 最近一次 `player.select` 的角色 key。
   *
   * 前端 transport 的 `world.snapshot` / `world.leave` / `battle.focus` / `idle.*`
   * 都不带角色 key（见 `game-api.ts`），因此服务端必须有这个「当前角色」指针。
   */
  activeCharacterOf(userId: number): string | undefined {
    return this.activeByUser.get(userId);
  }

  positionOf(
    userId: number,
    characterId: string,
  ): { map: string; endlessLevel: number } | undefined {
    const session = this.sessions.get(this.keyOf(userId, characterId));
    if (!session) return undefined;
    return { map: session.world.map, endlessLevel: session.world.endlessLevel };
  }

  /**
   * 启动 / 获取会话（`player.select`、`world.snapshot` 都会走到这里）。
   *
   * @returns 角色不存在时返回 `null`。
   */
  async start(userId: number, characterId: string): Promise<WorldSession | null> {
    const key = this.keyOf(userId, characterId);
    const existing = this.sessions.get(key);
    if (existing) {
      this.activeByUser.set(userId, characterId);
      return existing;
    }

    const player = await this.playerContext.load(userId, characterId);
    if (!player) return null;

    const extras = await this.playerContext.extrasOf(userId);
    const position = resolvePosition(this.tables, extras.worldMaps[characterId]);
    const storedSeed = extras.worldSeeds[characterId];
    let seed = typeof storedSeed === 'number' && Number.isFinite(storedSeed) ? storedSeed : 0;
    if (seed === 0) {
      seed = nextWorldSeed();
      extras.worldSeeds[characterId] = seed;
      this.playerContext.markAccountDirty(userId);
    }

    const now = this.now();
    const clock = new RealClock(this.now);
    const collector = new BattleCollector();
    const session: WorldSession = {
      userId,
      characterId,
      clock,
      collector,
      world: null as unknown as WorldSession['world'],
      seed,
      carryMs: 0,
      lastTickAt: now,
      lastPersistAt: now,
      pendingLoot: [],
    };

    const built = buildBattleWorld({
      tables: this.tables,
      player,
      map: position.map,
      endlessLevel: position.endlessLevel,
      seed,
      sink: collector,
      clock,
      updateRate: 1,
      medicineLevel: (type) => extras.medicineLevel[type] ?? 0,
      onEnemyKilled: (type, count) => this.onEnemyKilled(userId, extras, type, count),
      lootRecorder: {
        record: (slot, handled) => {
          session.pendingLoot.push(toLootDto(slot, handled));
        },
      },
    });
    session.world = built.world;

    clock.pause();
    player.timestamp = now;
    this.playerContext.markDirty(userId, characterId);

    this.sessions.set(key, session);
    this.activeByUser.set(userId, characterId);
    return session;
  }

  /** 停会话并落库（切人 / 登出 / 离开地图）。 */
  async stop(userId: number, characterId: string): Promise<void> {
    const key = this.keyOf(userId, characterId);
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    await this.persistPosition(session);
    this.disposeSession(session);
    const player = this.playerContext.peek(userId, characterId);
    if (player) {
      player.timestamp = this.now();
      this.playerContext.markDirty(userId, characterId);
    }
    await this.playerContext.flush(userId, characterId);
  }

  private disposeSession(session: WorldSession): void {
    try {
      session.world.dispose();
    } catch {
      // 半初始化 / 已 dispose：忽略。
    }
    try {
      session.clock.dispose();
    } catch {
      // 同上。
    }
  }

  private async persistPosition(session: WorldSession): Promise<void> {
    const extras = await this.playerContext.extrasOf(session.userId);
    extras.worldMaps[session.characterId] = {
      map: session.world.map,
      endlessLevel: session.world.endlessLevel,
    };
    this.playerContext.markAccountDirty(session.userId);
  }

  /** 战斗内核击杀回调（原版 `game.onEnemyKilled`）：递减剧情击杀任务。 */
  private onEnemyKilled(
    userId: number,
    extras: AccountExtras,
    type: string,
    count: number,
  ): void {
    const tasks = extras.enemyTasks[type];
    if (!tasks) return;
    let changed = false;
    const dec = Math.max(1, Math.trunc(count));
    for (const storyKey of Object.keys(tasks)) {
      const remaining = tasks[storyKey];
      if (remaining === undefined || remaining <= 0) continue;
      tasks[storyKey] = Math.max(0, remaining - dec);
      changed = true;
    }
    if (changed) this.playerContext.markAccountDirty(userId);
  }

  // ────────────────────────────── Action 支撑 ──────────────────────────────

  async snapshot(userId: number, characterId: string): Promise<ActionResult<WorldSnapshotDto>> {
    const session = await this.start(userId, characterId);
    if (!session) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    return ok(await this.snapshotOf(session));
  }

  async enterMap(
    userId: number,
    characterId: string,
    mapKey: string,
  ): Promise<ActionResult<WorldSnapshotDto>> {
    const session = await this.start(userId, characterId);
    if (!session) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    const map = this.tables.maps[mapKey];
    if (!map) return fail(BusinessErrorCode.MAP_LOCKED, '地图不存在');
    if (session.world.map === mapKey) return fail(BusinessErrorCode.ALREADY_IN_MAP);

    const player = session.world.player as Player | null;
    if (!player) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);

    const extras = await this.playerContext.extrasOf(userId);
    let unlocked = false;
    try {
      unlocked = checkRequirement(
        map.requirement,
        requirementContextOf(player, session.world.map, extras),
      );
    } catch {
      unlocked = false;
    }
    if (!unlocked) return fail(BusinessErrorCode.MAP_LOCKED);

    const ticketGroup = map.group ?? mapKey;
    if (map.isDungeon) {
      if (safeCountTicket(player, ticketGroup) <= 0) return fail(BusinessErrorCode.NO_TICKET);
      player.costTicket(ticketGroup);
    }

    session.world.map = mapKey;
    await this.persistPosition(session);
    player.timestamp = this.now();
    this.playerContext.markDirty(userId, characterId);
    await this.playerContext.flush(userId, characterId);
    return ok(await this.snapshotOf(session));
  }

  async leave(userId: number, characterId: string): Promise<ActionResult<null>> {
    if (!this.sessions.has(this.keyOf(userId, characterId))) {
      return fail(BusinessErrorCode.NOT_IN_MAP);
    }
    await this.stop(userId, characterId);
    return ok(null);
  }

  /**
   * 放弃离线收益（原版「跳过」按钮）。
   *
   * 结算锚点重置为「现在」，返回**零收益**报告（字段齐全，前端复用同一渲染）。
   */
  async skipOffline(userId: number, characterId: string): Promise<ActionResult<OfflineReportDto>> {
    const player = await this.playerContext.load(userId, characterId);
    if (!player) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    const now = this.now();
    const pending = Math.max(0, now - player.timestamp);
    player.timestamp = now;
    this.playerContext.markDirty(userId, characterId);
    await this.playerContext.flush(userId, characterId);
    return ok(zeroReport(pending));
  }

  /** 切换攻击目标（`battle.focus`）。 */
  async focus(userId: number, characterId: string, targetId: string): Promise<ActionResult<null>> {
    const session = this.sessions.get(this.keyOf(userId, characterId));
    if (!session) return fail(BusinessErrorCode.NOT_IN_MAP);
    const target = session.world.units.find((unit) => unit.id === targetId);
    if (!target || target.camp === 'ghost') return fail(BusinessErrorCode.NOT_FOUND, '目标不存在');
    session.world.focusEnemy(target as EnemyUnit);
    return ok(null);
  }

  /** 技能可用性投影（`career` 域用；本波返回空表 = 全部未判定）。 */
  usableByKey(): Record<string, boolean> {
    return {};
  }

  /**
   * 待结算离线时长（`player.select` → `PendingOfflineMs`）。
   *
   * 以 `Player.timestamp` 为锚点，**只在内存已加载时**给出；未加载时由调用方
   * 先 `playerContext.load`。
   */
  pendingOfflineMs(userId: number, characterId: string): number {
    const player = this.playerContext.peek(userId, characterId);
    if (!player) return 0;
    return pendingOfflineMsOf(player, this.now(), OFFLINE_MAX_MS);
  }

  private async snapshotOf(session: WorldSession): Promise<WorldSnapshotDto> {
    const player = session.world.player as Player | null;
    const extras = await this.playerContext.extrasOf(session.userId);
    return {
      map: session.world.map,
      endlessLevel: session.world.endlessLevel,
      units: session.world.units.map((unit) => unitStateDtoOf(unit, session.world.playerUnit)),
      maps: player ? mapListDtoOf(this.tables, player, extras, session.world.map) : [],
      pendingMaps: session.world.pendingMaps.map(([key, endlessLevel]) => ({ key, endlessLevel })),
      updateRate: session.world.updateRate,
      paused: session.clock.isPaused(),
    };
  }
}

// ────────────────────────────── 模块级纯函数 ──────────────────────────────

/** `world.tick` 合并器：累积事件 + 取最新快照 + 累加经验/金币。 */
export function mergeWorldTick(prev: unknown, next: unknown): WorldTickDto {
  const a = asTick(prev);
  const b = asTick(next);
  if (!a) return b ?? { serverTime: 0, units: [], events: [], gainedExp: 0, gainedGold: 0 };
  if (!b) return a;
  return {
    serverTime: Math.max(a.serverTime, b.serverTime),
    units: b.units,
    events: [...a.events, ...b.events],
    gainedExp: a.gainedExp + b.gainedExp,
    gainedGold: a.gainedGold + b.gainedGold,
  };
}

function asTick(value: unknown): WorldTickDto | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Partial<WorldTickDto>;
  if (!Array.isArray(record.units)) return null;
  return {
    serverTime: typeof record.serverTime === 'number' ? record.serverTime : 0,
    units: record.units,
    events: Array.isArray(record.events) ? record.events : [],
    gainedExp: typeof record.gainedExp === 'number' ? record.gainedExp : 0,
    gainedGold: typeof record.gainedGold === 'number' ? record.gainedGold : 0,
  };
}

/** `battle.loot` 合并器：同批次多次掉落累积成数组。 */
export function mergeLoot(prev: unknown, next: unknown): LootDto[] {
  const out: LootDto[] = [];
  if (Array.isArray(prev)) out.push(...(prev as LootDto[]));
  else if (prev !== undefined && prev !== null) out.push(prev as LootDto);
  if (Array.isArray(next)) out.push(...(next as LootDto[]));
  else if (next !== undefined && next !== null) out.push(next as LootDto);
  return out;
}

function toLootDto(slot: InventorySlot, handled: string): LootDto {
  const action: LootDto['handled'] =
    handled === 'sell' || handled === 'decompose' ? handled : 'pickup';
  const dto: LootDto = { slot: slotDtoOf(slot, 0), handled: action };
  if (action === 'sell' && slot.key === 'gold') dto.gold = slot.count ?? 0;
  return dto;
}

function resolvePosition(
  tables: DataTables,
  stored: { map: string; endlessLevel: number } | undefined,
): { map: string; endlessLevel: number } {
  if (!stored) return { map: 'home', endlessLevel: 0 };
  const map = tables.maps[stored.map] ? stored.map : 'home';
  return { map, endlessLevel: stored.endlessLevel };
}

function safeCountTicket(player: Player, group: string): number {
  try {
    const count = player.countTicket(group);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

function zeroReport(offlineMs: number): OfflineReportDto {
  return {
    offlineMs: Math.max(0, Number.isFinite(offlineMs) ? offlineMs : 0),
    cappedMs: 0,
    simulatedMs: 0,
    extrapolatedMs: 0,
    gainedExp: 0,
    gainedGold: 0,
    kills: 0,
    loots: [],
    materials: [],
    pausedByMaxOffline: false,
  };
}
