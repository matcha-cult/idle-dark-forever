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
import { OpIdempotencyService } from '../../game/op-idempotency.service.js';
import { OnlineSessionService } from '../../online/online-session.service.js';
import {
  DATA_TABLES,
  EVENT_BUS,
  GAME_CLOCK,
  PlayerContextService,
  type EventBus,
  type NowSource,
  slotDtoOf,
} from '../shared/index.js';
import { PanelCharacterService } from '../shared/panel-character.service.js';
import { BattleCollector } from './internal/battle-collector.js';
import { buildBattleWorld, nextWorldSeed } from './internal/headless.js';
import {
  evaluateMapUnlock,
  mapListDtoOf,
  pendingOfflineMsOf,
  resolveWorldPosition,
  requirementContextOf,
} from '../shared/map-dto.js';
import { nextCursor, planAdvance, planRound, shouldStopRound } from './internal/tick-scheduler.js';
import {
  beginClose,
  createLifecycle,
  isDestroyed,
  markDestroyed,
  markOnline,
  shouldReap,
  type SessionLifecycle,
} from './internal/session-lifecycle.js';
import { unitStateDtoOf } from './internal/unit-state.js';
import { EXP_RATE, OFFLINE_MAX_MS, WORLD_CONFIG, parseSessionReapMs } from './world.config.js';

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
  /**
   * 战斗 hook 需要重绑（面板域改动了装备 / 技能 / 强化 / 词缀后置位）。
   * 由下一次 tick 消费 —— 避免每 tick 无条件重绑，也避免面板域反向依赖世界内部结构。
   */
  combatDirty: boolean;
  /** 该会话累计**实际推进**的虚拟毫秒（`world_time_ratio` 分子）。 */
  advancedMs: number;
  /** 该会话累计真实经过的毫秒（`world_time_ratio` 分母）。 */
  realMs: number;
  /** 生命周期（`active → closing → destroyed`；空闲回收与 dispose 幂等）。 */
  lifecycle: SessionLifecycle;
}

/** 世界调度指标快照（07 T-A1；全部为进程内累计/瞬时值，无数据时为 0 或 1，绝不 NaN）。 */
export interface WorldStats {
  readonly sessionsTotal: number;
  readonly onlineCharacters: number;
  /** 全局 `Σ推进虚拟时间 / Σ真实经过时间`（I1）；无样本时为 1。 */
  readonly worldTimeRatio: number;
  readonly worldTimeRatioMin: number;
  readonly worldTimeRatioP50: number;
  readonly roundCharsProcessed: number;
  readonly roundCallbacksUsed: number;
  readonly roundCpuMs: number;
  readonly roundsTotal: number;
  readonly roundsCutOff: number;
  /** 被显式截断丢弃的虚拟毫秒：**正常恒为 0**（>0 即缺陷信号）。 */
  readonly truncatedMsTotal: number;
  readonly debtWarnTotal: number;
  /** 空闲会话回收累计数（L3 生效证据）。 */
  readonly sessionReapedTotal: number;
  /** 当前空闲回收阈值（ms；`0` = 关闭）。 */
  readonly sessionIdleReapMs: number;
  readonly callbackBudgetPerRound: number;
  readonly maxRoundCpuMs: number;
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
  // ── 调度指标（07 T-A1/T-A2；进程内累计/瞬时，无数据时为 0 而非 NaN） ──
  private roundsTotal = 0;
  private roundsCutOff = 0;
  private roundCharsProcessed = 0;
  private roundCallbacksUsed = 0;
  private roundCpuMs = 0;
  private truncatedMsTotal = 0;
  private debtWarnTotal = 0;
  private reapedTotal = 0;
  private lastSweepAt: number | null = null;
  /**
   * 空闲会话回收阈值（ms）：`<= 0`（含 `0`）= 关闭回收（09 §7 回滚开关）。
   * 默认读 `SESSION_REAP_MS`；单测可直接改写本字段。
   */
  sessionIdleReapMs = parseSessionReapMs(process.env.SESSION_REAP_MS);

  constructor(
    private readonly playerContext: PlayerContextService,
    private readonly onlineSessions: OnlineSessionService,
    private readonly opIds: OpIdempotencyService,
    private readonly panelCharacters: PanelCharacterService,
    @Inject(NOTIFICATION_BATCHER) private readonly batcher: NotificationBatcher,
    @Inject(GAME_CLOCK) now: NowSource,
    @Inject(DATA_TABLES) tables: DataTables,
    /** 跨服事件总线（08 §2.3）：发布 `MapEntered`/`EnemyKilled`，订阅 `CombatHooksDirty`。 */
    @Inject(EVENT_BUS) private readonly events: EventBus,
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
    // 面板域（item / character）改动了战斗相关状态 → 本 tick 重绑 hook。
    // 订阅而非被直接调用：解环后 item/character 不再 import battle（08 §2.3）。
    this.events.on('CombatHooksDirty', (event) => {
      this.markCombatDirty(event.userId, event.characterId);
    });
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
    // 空闲会话回收（节流）：离线且空闲超阈值的会话先落库再释放（09 §7 R1）。
    if (this.lastSweepAt === null || now - this.lastSweepAt >= WORLD_CONFIG.sessionSweepIntervalMs) {
      this.lastSweepAt = now;
      this.sweepIdleSessions(now);
    }
    const keys = [...this.sessions.keys()];
    if (keys.length === 0) {
      this.tickCursor = 0;
      this.roundCharsProcessed = 0;
      this.roundCallbacksUsed = 0;
      this.roundCpuMs = 0;
      void this.maybeFlush();
      return;
    }

    // 预算驱动（07 T-A2）：从游标起绕一圈，**不设人数上限**；
    // 跑满全局回调预算或单轮 CPU 预算即停，剩余角色顺延到下一轮（`lastTickAt` 不变 ⇒ 时间不丢）。
    const plan = planRound(keys, this.tickCursor);
    let processed = 0;
    let callbacksUsed = 0;
    let cutOff = false;
    for (const key of plan.order) {
      const cpuElapsedMs = Math.max(0, this.now() - now);
      if (
        shouldStopRound({
          callbacksUsed,
          callbackBudget: WORLD_CONFIG.globalCallbackBudgetPerRound,
          elapsedCpuMs: cpuElapsedMs,
          cpuBudgetMs: WORLD_CONFIG.maxRoundCpuMs,
        })
      ) {
        cutOff = true;
        break;
      }
      const session = this.sessions.get(key);
      if (!session) continue;
      try {
        callbacksUsed += this.tickSession(session, now);
      } catch (error) {
        this.logger.warn(`world tick 失败：${session.characterId}`, {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      processed += 1;
    }
    this.tickCursor = nextCursor(plan.startCursor, processed, keys.length);

    this.roundCharsProcessed = processed;
    this.roundCallbacksUsed = callbacksUsed;
    this.roundCpuMs = Math.max(0, this.now() - now);
    this.roundsTotal += 1;
    if (cutOff) {
      this.roundsCutOff += 1;
      // I3：显式降级，绝不静默 —— 剩余角色在下一轮补全 elapsed。
      this.logger.warn(
        `[OVERLOAD] world tick 本轮预算打满：processed=${processed}/${keys.length} callbacks=${callbacksUsed} cpuMs=${this.roundCpuMs}`,
      );
    }

    void this.maybeFlush();
  }

  /** 推进单个会话；返回本次实际执行的回调数（供全局预算累加）。 */
  private tickSession(session: WorldSession, now: number): number {
    // 离线角色：不推送、不推进（离线收益由 idle 域结算）。
    if (!this.onlineSessions.isOnline(session.userId, now)) return 0;
    session.lifecycle = markOnline(session.lifecycle, now);

    const advance = planAdvance({
      now,
      lastTickAt: session.lastTickAt,
      carryMs: session.carryMs,
      debtWarnMs: WORLD_CONFIG.worldTimeDebtWarnMs,
      debtShedMs: WORLD_CONFIG.worldTimeDebtShedMs,
    });
    session.lastTickAt = now;
    session.realMs += advance.elapsedMs;

    // 面板域改过装备 / 技能 / 强化 / 词缀 → 本 tick 先重绑战斗 hook。
    // 去 MobX 后 `PlayerUnit` 不再自动追踪这些来源（见 `combat/player-unit.ts` 顶部契约表），
    // 不重绑的话面板改动在战斗里不生效。
    if (session.combatDirty) {
      session.combatDirty = false;
      try {
        const unit = session.world.playerUnit;
        if (unit !== null && unit !== undefined) {
          unit.rebindEquipmentHooks();
          unit.rebindPassiveHooks();
          unit.rebindEnhanceHooks();
        }
      } catch (error) {
        this.logger.warn(
          `重绑战斗 hook 失败 userId=${session.userId} characterId=${session.characterId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (advance.shedMs > 0) {
      // I3：**显式**截断（metric + 日志），不是静默丢弃。`world_truncated_ms_total > 0` 即缺陷信号。
      this.truncatedMsTotal += advance.shedMs;
      this.logger.warn(
        `[OVERLOAD] 世界时间截断 userId=${session.userId} characterId=${session.characterId} requestedMs=${advance.requestedMs} shedMs=${advance.shedMs}`,
      );
    } else if (advance.warn) {
      this.debtWarnTotal += 1;
      this.logger.warn(
        `[OVERLOAD] 世界时间债务 userId=${session.userId} characterId=${session.characterId} requestedMs=${advance.requestedMs}`,
      );
    }

    let callbacksUsed = 0;
    if (advance.advanceMs > 0) {
      const remaining = session.clock.stepPaused(
        advance.advanceMs,
        WORLD_CONFIG.callbackBudgetPerCharacterPerTick,
      );
      session.carryMs = remaining > 0 ? remaining : 0;
      session.advancedMs += Math.max(0, advance.advanceMs - Math.max(0, remaining));
      callbacksUsed =
        typeof session.clock.callbacksUsed === 'function' ? session.clock.callbacksUsed() : 0;
    } else {
      session.carryMs = 0;
    }

    this.emitTick(session, now);

    if (now - session.lastPersistAt >= WORLD_CONFIG.persistIntervalMs) {
      session.lastPersistAt = now;
      // 在线期间持续刷新结算锚点：否则「在线挂机数小时」后再看 idle.report 会把
      // 已经在实时世界里推进过的时间重复结算一次。
      const player = this.playerContext.peek(session.userId, session.characterId);
      if (player) player.timestamp = now;
      this.playerContext.markDirty(session.userId, session.characterId);
      this.schedulePersist(session);
    }
    return callbacksUsed;
  }

  /**
   * 空闲会话回收（09 §7 R1）：离线且空闲 ≥ 阈值 → 走 `stop()`（**先 persistPosition + flush
   * 再 dispose**，绝不丢脏数据）。
   *
   * - **在线**会话（含被预算顺延、本轮未 tick 的）只刷新 `lastOnlineAt`，绝不回收；
   * - 已在关闭流程（`closing` / `destroyed`）的会话跳过；
   * - `sessionIdleReapMs <= 0` = 关闭回收（回滚开关）。
   */
  private sweepIdleSessions(now: number): void {
    if (this.sessionIdleReapMs <= 0) return;
    for (const session of [...this.sessions.values()]) {
      if (this.onlineSessions.isOnline(session.userId, now)) {
        session.lifecycle = markOnline(session.lifecycle, now);
        continue;
      }
      if (session.lifecycle.state !== 'active') continue;
      if (!shouldReap(session.lifecycle.lastOnlineAt, now, this.sessionIdleReapMs)) continue;
      this.reapedTotal += 1;
      void this.stop(session.userId, session.characterId).catch((error: unknown) => {
        this.logger.warn(`空闲会话回收失败：${session.characterId}`, {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
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
   * 调度指标快照（07 T-A1/T-A2）。
   *
   * `worldTimeRatio` = 全部会话的 `Σ实际推进 / Σ真实经过`。无样本（或真实经过为 0）时定义为 **1**，
   * 避免空世界 / 固定时钟（单测）产生 `NaN`。
   */
  get stats(): WorldStats {
    const now = this.now();
    let onlineCharacters = 0;
    let advanced = 0;
    let real = 0;
    const ratios: number[] = [];
    for (const session of this.sessions.values()) {
      if (this.onlineSessions.isOnline(session.userId, now)) onlineCharacters += 1;
      advanced += session.advancedMs;
      real += session.realMs;
      if (session.realMs > 0) ratios.push(session.advancedMs / session.realMs);
    }
    ratios.sort((a, b) => a - b);
    const finiteOr1 = (value: number): number => (Number.isFinite(value) ? value : 1);
    const mid = ratios.length > 0 ? (ratios[Math.floor((ratios.length - 1) / 2)] as number) : 1;
    return {
      sessionsTotal: this.sessions.size,
      onlineCharacters,
      worldTimeRatio: real > 0 ? finiteOr1(advanced / real) : 1,
      worldTimeRatioMin: ratios.length > 0 ? finiteOr1(ratios[0] as number) : 1,
      worldTimeRatioP50: finiteOr1(mid),
      roundCharsProcessed: this.roundCharsProcessed,
      roundCallbacksUsed: this.roundCallbacksUsed,
      roundCpuMs: this.roundCpuMs,
      roundsTotal: this.roundsTotal,
      roundsCutOff: this.roundsCutOff,
      truncatedMsTotal: this.truncatedMsTotal,
      debtWarnTotal: this.debtWarnTotal,
      sessionReapedTotal: this.reapedTotal,
      sessionIdleReapMs: Math.max(0, Math.trunc(this.sessionIdleReapMs)),
      callbackBudgetPerRound: WORLD_CONFIG.globalCallbackBudgetPerRound,
      maxRoundCpuMs: WORLD_CONFIG.maxRoundCpuMs,
    };
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
    const position = resolveWorldPosition(this.tables, extras.worldMaps[characterId]);
    // 持久化位置是「当前地图」的**唯一权威**（08 §2.3 / 09 §4.3）：quest 域据此判定
    // 剧情的地图条件，不再反向调用 battle。会话启动即写入，保证从未进过图的角色也有位置。
    extras.worldMaps[characterId] = { map: position.map, endlessLevel: position.endlessLevel };
    this.playerContext.markAccountDirty(userId);
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
      combatDirty: false,
      advancedMs: 0,
      realMs: 0,
      lifecycle: createLifecycle(now),
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
      expRate: EXP_RATE,
      medicineLevel: (type) => extras.medicineLevel[type] ?? 0,
      onEnemyKilled: (type, count) =>
        this.events.emit({ type: 'EnemyKilled', userId, characterId, enemyType: type, count }),
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
    // 会话首次落地在该地图 = 「进入地图」：补一次剧情推进，否则
    // `enterMap(当前图)` 会走 early-return 分支，剧情永远不会自动触发。
    // 由 quest 服务订阅同步处理（解环：battle 不再 import story）。
    this.events.emit({ type: 'MapEntered', userId, characterId, map: position.map });
    return session;
  }

  /** 停会话并落库（切人 / 登出 / 离开地图）。 */
  async stop(userId: number, characterId: string): Promise<void> {
    // 「当前角色」指针只在它仍指向本角色时才清 —— 切人流程是
    // `start(新角色)` 之后再 `stop(旧角色)`，此处不能把刚设好的新指针抹掉。
    if (this.activeByUser.get(userId) === characterId) {
      this.activeByUser.delete(userId);
    }
    const key = this.keyOf(userId, characterId);
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    session.lifecycle = beginClose(session.lifecycle);
    await this.persistPosition(session);
    this.disposeSession(session);
    const player = this.playerContext.peek(userId, characterId);
    if (player) {
      player.timestamp = this.now();
      this.playerContext.markDirty(userId, characterId);
    }
    await this.playerContext.flush(userId, characterId);
  }

  /**
   * 把该账号视为**回到「未选角色」**：停掉活跃世界会话 + 清理两个「当前角色」注册表。
   *
   * ## 谁调用 & 为什么
   *
   * **每次 WS 握手成功后**（`app.module.ts` 的 `authenticate`）调用。
   *
   * 「当前角色」是账号级内存状态，而 `player.select` 是 WS Action。若不随新连接失效：
   * 刷新页面时旧 socket 关闭、新 socket 以同一 token 打开，服务端仍认为该角色"在线"
   * （`OnlineSessionService.isOnline` 是**账号级**判据），于是世界继续 tick，把
   * `(world, tick)` 战斗推送灌给一个停在「选角页」的页面 —— 玩家此时并没有在玩任何角色。
   *
   * 语义上就是「每次进入都要选角色」：新连接 = 未选角色。断线重连由前端重新
   * `player.select` 补上（`RootStore.reenterCharacterIfNeeded`）。
   *
   * 失败只记日志：**握手不能因为清理失败而拒绝连接**。
   */
  async resetActiveCharacter(userId: number): Promise<void> {
    const active = this.activeByUser.get(userId);
    this.activeByUser.delete(userId);
    this.panelCharacters.clear(userId);
    // 队列里可能还压着上一批 `(world, tick)`：必须**丢弃**而不是 flush，
    // 否则新连上、还停在选角页的连接会收到最后一帧战斗推送（实测漏 1 帧）。
    this.batcher.drop(userId);
    if (active === undefined) return;
    // 走 stop() 而不是直接删会话：它会持久化地图位置并把角色状态 flush 落库
    // （刷新页面正是最后一次可靠落库机会）。
    await this.stop(userId, active);
  }

  /**
   * 解析「本次请求要操作哪个角色」——**角色归属校验的唯一入口**。
   *
   * 规则（fail-closed）：
   * - 显式给了 key：必须**等于本账号的当前角色**，否则拒绝。这样客户端不可能
   *   用一条连接去操作账号里另一个角色的世界 / 离线收益。
   * - 没给 key：回退到当前角色（前端 `world.snapshot` 等暂不带 key）；
   * - 两者都没有（尚未选角）→ 拒绝。
   *
   * ⚠️ 为什么必须校验：推送与推进都是**按角色会话**产生的，而框架的定向推送是
   * **按 userId 扇出到这个账号的全部连接**。若允许「A 连接操作 B 角色」，就会出现
   * 「同一个账号的两条连接互相看到/推进对方的角色」——即串号与双份推送。
   * 配合 `PlayerLogicService.select` 的「切人即停旧会话」，保证**同一账号同一时刻
   * 只有一个活跃角色会话**，因此推送到该账号任何连接的消息都只属于当前角色。
   */
  resolveActiveCharacter(
    userId: number,
    raw: unknown,
  ): { ok: true; key: string } | { ok: false; fail: ActionResult<never> } {
    const explicit = typeof raw === 'string' ? raw.trim() : '';
    const active = this.activeByUser.get(userId);
    if (explicit === '') {
      if (active === undefined) return { ok: false, fail: fail(BusinessErrorCode.NOT_IN_MAP, '尚未选择角色') };
      return { ok: true, key: active };
    }
    if (active === undefined) {
      return { ok: false, fail: fail(BusinessErrorCode.NOT_IN_MAP, '尚未选择角色') };
    }
    if (active !== explicit) {
      return {
        ok: false,
        fail: fail(BusinessErrorCode.PLAYER_NOT_FOUND, '该角色不是当前选择的角色'),
      };
    }
    return { ok: true, key: explicit };
  }

  private disposeSession(session: WorldSession): void {
    // 幂等：已销毁的会话不再 dispose（空闲回收与显式 stop 可能竞争同一条会话）。
    if (isDestroyed(session.lifecycle)) return;
    session.lifecycle = markDestroyed(session.lifecycle);
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

  /**
   * 面板域改动了**战斗相关**状态后调用：装备/卸下、切换职业、选/取消技能与强化、
   * 附魔与重铸（词缀变化）。
   *
   * 去 MobX 后 `PlayerUnit` 不再自动追踪这些来源，必须由上层显式重绑
   * （见 `packages/game-core/src/combat/player-unit.ts` 顶部的契约表）。
   * 这里只置脏标记，真正的重绑在下一次 tick 完成 —— 一次 tick 内多次改动只重绑一次，
   * 且面板域不必依赖 `WorldService` 的内部结构。
   *
   * 对**没有活跃会话**的角色是 no-op（下次 `player.select` 进场时会按最新存档重建单位）。
   */
  markCombatDirty(userId: number, characterId?: string): void {
    const resolved = characterId ?? this.activeByUser.get(userId);
    if (resolved === undefined || resolved === '') return;
    const session = this.sessions.get(this.keyOf(userId, resolved));
    if (session !== undefined) session.combatDirty = true;
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
    opId?: string,
  ): Promise<ActionResult<WorldSnapshotDto>> {
    const session = await this.start(userId, characterId);
    if (!session) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    const map = this.tables.maps[mapKey];
    if (!map) return fail(BusinessErrorCode.MAP_LOCKED, '地图不存在');
    // 重复进入当前地图 = 「重置本图」（原版重新进入地图会重置刷怪与战斗），
    // 不报 ALREADY_IN_MAP、也不重复扣钥匙 —— 这样前端 select 后直接 enterMap 永远可用。
    if (session.world.map === mapKey) {
      session.world.onMapChanged();
      return ok(await this.snapshotOf(session));
    }

    // 消耗类操作（进入地城会扣钥匙）必须幂等：同 opId 重放不重复扣费。
    const claim = this.opIds.begin(userId, opId);
    if (claim.kind === 'invalid') {
      return fail(BusinessErrorCode.INVALID_PARAM, claim.reason);
    }
    if (claim.kind === 'duplicate') {
      if (claim.inFlight) return fail(BusinessErrorCode.DUPLICATE_OPERATION, '地图切换正在处理中');
      return ok(await this.snapshotOf(session));
    }

    try {
      const player = session.world.player as Player | null;
      if (!player) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);

      const extras = await this.playerContext.extrasOf(userId);
      // 解锁判定唯一入口（shared/map-dto）：map 控制器与 battle 会话宿主共用同一实现。
      const unlocked = evaluateMapUnlock(map.requirement, player, session.world.map, extras);
      if (!unlocked) {
        this.opIds.abort(userId, opId ?? '');
        return fail(BusinessErrorCode.MAP_LOCKED);
      }

      const ticketGroup = map.group ?? mapKey;
      if (map.isDungeon) {
        if (safeCountTicket(player, ticketGroup) <= 0) {
          this.opIds.abort(userId, opId ?? '');
          return fail(BusinessErrorCode.NO_TICKET);
        }
        player.costTicket(ticketGroup);
      }

      session.world.map = mapKey;
      await this.persistPosition(session);
      // 进图剧情推进必须在 flush 之前：击杀任务登记落在 extras 里，要一起落库。
      // 由 quest 服务订阅 `MapEntered` 同步处理（08 §2.3 解环）。
      this.events.emit({ type: 'MapEntered', userId, characterId, map: mapKey });
      player.timestamp = this.now();
      this.playerContext.markDirty(userId, characterId);
      await this.playerContext.flush(userId, characterId);
      const snapshot = await this.snapshotOf(session);
      this.opIds.settle(userId, opId ?? '', snapshot);
      return ok(snapshot);
    } catch (error) {
      this.opIds.abort(userId, opId ?? '');
      throw error;
    }
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
