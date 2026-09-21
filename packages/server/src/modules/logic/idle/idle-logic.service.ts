/**
 * `IdleService` —— 离线结算（cmd 120）
 *
 * 算法（方案 §8.3 的 **C1 有界快进模拟 + C2 解析外推兜底**）：
 *
 * ```
 * rawMs         = now - player.timestamp                    （真实离线时长）
 * cappedMs      = min(rawMs, 72h)                           （结算上限，保持原版 72h 语义）
 * simulatedMs   = C1：用同一内核 + VirtualClock 真模拟，上限 30 分钟虚拟时间
 *                 且单次「击杀预算」5000、调用预算 360（防单帧阻塞）
 * extrapolatedMs= cappedMs - simulatedMs                     （C2：按模拟得到的速率外推）
 * ```
 *
 * W6：旧氪金秘境体系（挑战队列 / 冷却 / 票 / run 相位 / 无尽层）已物理删除。
 * 离线只模拟**角色持久化当前地图**（有怪才结算），安全区零收益并照常推进时间锚点。
 *
 * **不占真实时间**：全程 `VirtualClock.advanceBy(ms, budget)`，无宿主定时器、无 await。
 * 超过 24h 的离线会置 `pausedByMaxOffline`（表示「已达最大离线暂停阈值」，字段语义见交付报告）。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  InventorySlot,
  VirtualClock,
  chaosMapKeyOfTier,
  isChaosMap,
  isCombatArea,
  type DataTables,
  type Player,
} from '@idle-dark/game-core';
import {
  type ActionResult,
  BusinessErrorCode,
  type OfflineReportDto,
  type Quality,
  fail,
  ok,
} from '@idle-dark/protocol';
import {
  DATA_TABLES,
  GAME_CLOCK,
  PlayerContextService,
  type AccountExtras,
  type NowSource,
} from '../shared/index.js';
import { BattleCollector } from '../shared/battle-collector.js';
import { buildBattleWorld, nextWorldSeed } from '../shared/headless.js';
import {
  EXP_RATE,
  OFFLINE_MAX_MS,
  OFFLINE_PAUSE_AFTER_MS,
  writeWorldMapKeepingProgress,
  type WorldMapState,
} from '../shared/index.js';
import { countsOf, nextChaosStep } from '../chaos/internal/chaos-ops.js';

/** 离线结算硬上限（保持原版 72h 语义）。 */
export const MAX_OFFLINE_MS = OFFLINE_MAX_MS;
/** 超过该离线时长即标记 `pausedByMaxOffline`（产品阈值 24h）。 */
export const PAUSE_AFTER_MS = OFFLINE_PAUSE_AFTER_MS;
/** C1 真模拟的虚拟时间预算。 */
export const SIM_BUDGET_MS = 30 * 60 * 1000;
/** C1 真模拟的击杀预算。 */
export const SIM_KILL_BUDGET = 5_000;
/** 单次 `advanceBy` 的事件预算。 */
export const SIM_CALLBACK_BUDGET = 5_000;
/** 单次结算最多调用 `advanceBy` 的次数（防病态循环）。 */
export const SIM_MAX_CALLS = 360;
/** 混沌仪离线推进的 run 次数上限（序列 ≤16 + 重试；防病态循环）。 */
export const CHAOS_MAX_RUNS = 64;
/** 混沌仪中断 / 序列走完后角色回到的普通地图。 */
const HOME_MAP = 'home';

/** 混沌仪离线推进的产出。 */
interface ChaosSimResult {
  simulatedMs: number;
  exp: number;
  gold: number;
  kills: number;
  loots: Array<{ key: string; count: number; quality: Quality }>;
  materials: Array<{ key: string; count: number }>;
  /** 推进结束后角色所在地图（混沌图 = 停在当前钥石；`home` = 已停止）。 */
  map: string;
  active: boolean;
  index: number;
  retry: number;
}

/** 单张地图快进模拟的产出。 */
interface MapSimResult {
  simulatedMs: number;
  gainedExp: number;
  gainedGold: number;
  kills: number;
  loots: Array<{ key: string; count: number; quality: Quality }>;
  materials: Array<{ key: string; count: number }>;
  /** W6：混沌图本次 run 的结算（`null` = 未结算 / 非混沌图）。 */
  chaosOutcome: 'clear' | 'death' | null;
}

@Injectable()
export class IdleService {
  private readonly logger = new Logger(IdleService.name);
  private readonly now: NowSource;
  private readonly tables: DataTables;
  /** characterId(userId 前缀) → 已结算待领取报告。 */
  private readonly cached = new Map<string, OfflineReportDto>();

  constructor(
    private readonly playerContext: PlayerContextService,
    @Inject(GAME_CLOCK) now: NowSource,
    @Inject(DATA_TABLES) tables: DataTables,
  ) {
    this.now = now;
    this.tables = tables;
  }

  private keyOf(userId: number, characterId: string): string {
    return `${userId}\u0000${characterId}`;
  }

  /** 上次离线结算报告（未结算则即时结算并缓存）。 */
  async report(userId: number, characterId: string): Promise<ActionResult<OfflineReportDto>> {
    const key = this.keyOf(userId, characterId);
    const hit = this.cached.get(key);
    if (hit) return ok(hit);
    return this.settle(userId, characterId);
  }

  /** 领取离线收益：返回报告并清空缓存（下次 `report` 会重新结算，通常为 0）。 */
  async claim(userId: number, characterId: string): Promise<ActionResult<OfflineReportDto>> {
    const key = this.keyOf(userId, characterId);
    const hit = this.cached.get(key);
    if (hit) {
      this.cached.delete(key);
      return ok(hit);
    }
    const result = await this.settle(userId, characterId);
    // `settle` 会把报告写入缓存；claim 的语义是「领取并清空」，因此这里必须再删一次。
    if (result.success) this.cached.delete(key);
    return result;
  }

  private async settle(
    userId: number,
    characterId: string,
  ): Promise<ActionResult<OfflineReportDto>> {
    const player = await this.playerContext.load(userId, characterId);
    if (!player) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);

    const now = this.now();
    const rawMs = Math.max(0, now - player.timestamp);
    const cappedMs = Math.min(rawMs, MAX_OFFLINE_MS);
    const pausedByMaxOffline = rawMs > PAUSE_AFTER_MS;

    if (cappedMs <= 0) {
      player.timestamp = now;
      this.playerContext.markDirty(userId, characterId);
      await this.playerContext.flush(userId, characterId);
      return ok(emptyReport(rawMs, 0, pausedByMaxOffline));
    }

    const extras = await this.playerContext.extrasOf(userId);
    const currentMap = this.currentMapOf(extras, characterId);

    // RD1：不在战斗区域 → 零收益（时间锚点照常推进）。
    if (!isCombatArea(this.tables.maps[currentMap])) {
      player.timestamp = now;
      this.playerContext.markDirty(userId, characterId);
      await this.playerContext.flush(userId, characterId);
      return ok(emptyReport(rawMs, 0, pausedByMaxOffline));
    }

    const seed = await this.seedOf(userId, characterId, extras);

    // W6：混沌仪运行中且持久化地图是混沌图 → 按钥石序列推进（**不做速率外推**）。
    if (player.chaosActive && isChaosMap(this.tables.maps[currentMap])) {
      const chaos = this.simulateChaosRun(
        player,
        extras,
        currentMap,
        characterId,
        seed,
        Math.min(cappedMs, SIM_BUDGET_MS),
      );
      if (chaos.gold > 0) player.gold += chaos.gold;
      if (chaos.exp > 0) applyExpBounded(player, chaos.exp);
      for (const material of chaos.materials) {
        addMaterial(player, this.tables, material.key, material.count);
      }
      // W11 / C6：**唯一写入口** —— 同图保留波数与里程碑，换图才归零。
      writeWorldMapKeepingProgress(extras.worldMaps, characterId, chaos.map);
      player.chaosActive = chaos.active;
      player.chaosIndex = chaos.index;
      player.chaosRetry = chaos.retry;
      player.timestamp = now;
      this.playerContext.markDirty(userId, characterId);
      this.playerContext.markAccountDirty(userId);
      await this.playerContext.flush(userId, characterId);

      const chaosReport: OfflineReportDto = {
        offlineMs: rawMs,
        cappedMs,
        // 混沌部分**只报真实模拟时长**，`extrapolatedMs` 恒为 0（预算耗尽停在当前钥石）。
        simulatedMs: chaos.simulatedMs,
        extrapolatedMs: 0,
        gainedExp: chaos.exp,
        gainedGold: chaos.gold,
        kills: chaos.kills,
        loots: chaos.loots,
        materials: chaos.materials,
        pausedByMaxOffline,
      };
      this.cached.set(this.keyOf(userId, characterId), chaosReport);
      return ok(chaosReport);
    }

    const sim = this.simulateOnMap({
      player,
      extras,
      map: currentMap,
      seed,
      budget: Math.min(cappedMs, SIM_BUDGET_MS),
      // W11：把已交付的里程碑带上，避免离线快进把第 10 波精英 / 第 20 波 BOSS 重复交付。
      bornState: this.bornStateOf(extras, characterId, currentMap),
    });

    // C2：对模拟预算之外的剩余时长做速率外推（稳定在战斗图时才允许）。
    const extrapolatedMs = offlineExtrapolationMs(
      this.tables.maps[currentMap],
      cappedMs,
      sim.simulatedMs,
    );
    const extrap = extrapolate(sim, extrapolatedMs);

    if (extrap.gold > 0) player.gold += extrap.gold;
    if (extrap.exp > 0) applyExpBounded(player, extrap.exp);
    for (const material of extrap.materials) {
      addMaterial(player, this.tables, material.key, material.count);
    }

    // 落库：位置（离线不换图，保持当前地图）。
    // ⚠️ W11 / C6：**唯一写入口**，且必须**保留波数与里程碑** —— 离线结算不推演波次，
    // 之前这里手拼 `{ map }` 把 `wave` 抹掉，导致每次登录波数归零（R0）。
    writeWorldMapKeepingProgress(extras.worldMaps, characterId, currentMap);
    player.timestamp = now;
    this.playerContext.markDirty(userId, characterId);
    this.playerContext.markAccountDirty(userId);
    await this.playerContext.flush(userId, characterId);

    const report: OfflineReportDto = {
      offlineMs: rawMs,
      cappedMs,
      simulatedMs: sim.simulatedMs,
      extrapolatedMs,
      gainedExp: sim.gainedExp + extrap.exp,
      gainedGold: sim.gainedGold + extrap.gold,
      kills: sim.kills + extrap.kills,
      loots: mergeLoots(sim.loots, extrap.loots),
      materials: mergeCounts(sim.materials, extrap.materials),
      pausedByMaxOffline,
    };
    this.cached.set(this.keyOf(userId, characterId), report);
    return ok(report);
  }

  /** 角色持久化当前地图（非法 / 缺失 → `home`）。 */
  private currentMapOf(extras: AccountExtras, characterId: string): string {
    const stored = extras.worldMaps[characterId]?.map;
    if (typeof stored !== 'string' || stored === '' || !this.tables.maps[stored]) {
      return 'home';
    }
    return stored;
  }

  /**
   * 本图**已交付**的里程碑（仅当侧车记录的就是这张图时才返回）。
   *
   * ⚠️ 必须比对 map：混沌仪一次 run 会连续推过多张 `chaos.tNN`，
   * 而侧车里只有「当前所在图」这一条记录 —— 直接把别的图的波数喂进去
   * 会让新图一开局就以为里程碑已交付（精英 / BOSS 再也不刷）。
   */
  private bornStateOf(
    extras: AccountExtras,
    characterId: string,
    map: string,
  ): WorldMapState | undefined {
    const stored = extras.worldMaps[characterId];
    return stored !== undefined && stored.map === map ? stored : undefined;
  }

  /**
   * 在当前图上做有界快进模拟（在线 tick 的离线镜像）。
   *
   * 全程 `VirtualClock`，无宿主定时器、无 await。
   */
  private simulateOnMap(params: {
    player: Player;
    extras: AccountExtras;
    map: string;
    seed: number;
    budget: number;
    /**
     * W11：本图已交付的里程碑（`wave` / `lastEliteWave` / `lastBossWave`）。
     *
     * 离线结算**不推演波次**（进度照留），但必须把已交付的里程碑喂给内核 ——
     * 否则每次离线快进都会从 `wave = 0` 重来，把第 10 波精英 / 第 20 波 BOSS
     * **重复交付**一遍。
     */
    bornState?: WorldMapState;
  }): MapSimResult {
    const { player, extras, map } = params;
    const clock = new VirtualClock();
    const collector = new BattleCollector();
    let world: ReturnType<typeof buildBattleWorld>['world'] | null = null;
    try {
      world = buildBattleWorld({
        tables: this.tables,
        player,
        map,
        seed: params.seed,
        sink: collector,
        clock,
        updateRate: 1,
        expRate: EXP_RATE,
        medicineLevel: (type) => extras.medicineLevel[type] ?? 0,
        ...(params.bornState !== undefined ? { enemyBornState: params.bornState } : {}),
      }).world;

      let remaining = params.budget;
      let calls = 0;
      while (remaining > 0 && calls < SIM_MAX_CALLS) {
        const left = clock.advanceBy(remaining, SIM_CALLBACK_BUDGET);
        calls += 1;
        const progressed = remaining - left;
        if (!(progressed > 0)) break;
        remaining = left;
        if (remaining <= 0) break;
        if (collector.snapshot().kills >= SIM_KILL_BUDGET) break;
      }

      const snapshot = collector.snapshot();
      return {
        simulatedMs: Math.max(0, params.budget - remaining),
        gainedExp: snapshot.gainedExp,
        gainedGold: snapshot.gainedGold,
        kills: snapshot.kills,
        loots: snapshot.loots
          .filter((loot) => loot.handled === 'pickup')
          .map((loot) => ({ key: loot.key, count: loot.count, quality: clampQuality(loot.quality) })),
        materials: snapshot.materials,
        chaosOutcome: world.chaosOutcome,
      };
    } catch (error) {
      this.logger.warn('离线快进模拟失败（按无收益处理）', {
        reason: error instanceof Error ? error.message : String(error),
        map,
      });
      return {
        simulatedMs: 0,
        gainedExp: 0,
        gainedGold: 0,
        kills: 0,
        loots: [],
        materials: [],
        chaosOutcome: null,
      };
    } finally {
      try {
        world?.dispose();
      } catch {
        // 忽略半初始化状态的 dispose 失败。
      }
      clock.dispose();
    }
  }

  private async seedOf(userId: number, characterId: string, extras: AccountExtras): Promise<number> {
    const stored = extras.worldSeeds[characterId];
    if (typeof stored === 'number' && Number.isFinite(stored) && stored !== 0) return stored;
    const seed = nextWorldSeed();
    extras.worldSeeds[characterId] = seed;
    this.playerContext.markAccountDirty(userId);
    return seed;
  }

  /**
   * 混沌仪离线推进（W6）：按钥石序列在同一 `VirtualClock` 预算内逐把模拟。
   *
   * - 每次 `simulateOnMap` 得到 `chaosOutcome` 后用 `chaos-ops` 的**同一状态机**决定下一步；
   * - 结算 `clear`/`death` → 消耗下一把钥石并切换混沌图继续（预算内）；
   * - `stop`（序列走完 / 缺钥石 / `normal` 中断）→ 回普通地图并清运行态；
   * - **预算耗尽 / run 未结算** → 停在当前钥石：保留 `active` 与当前下标，**不外推**。
   */
  private simulateChaosRun(
    player: Player,
    extras: AccountExtras,
    map: string,
    characterId: string,
    seed: number,
    budget: number,
  ): ChaosSimResult {
    const loots = new Map<string, { key: string; count: number; quality: Quality }>();
    const materials = new Map<string, number>();
    let exp = 0;
    let gold = 0;
    let kills = 0;
    let simulatedMs = 0;
    let remaining = budget;
    let currentMap = map;
    let index = player.chaosIndex;
    let retry = player.chaosRetry;
    let active = player.chaosActive;
    let guard = 0;

    while (guard < CHAOS_MAX_RUNS) {
      guard += 1;
      if (remaining <= 0) break;
      const sim = this.simulateOnMap({
        player,
        extras,
        map: currentMap,
        seed,
        budget: remaining,
        bornState: this.bornStateOf(extras, characterId, currentMap),
      });
      exp += sim.gainedExp;
      gold += sim.gainedGold;
      kills += sim.kills;
      simulatedMs += sim.simulatedMs;
      remaining -= sim.simulatedMs;
      for (const loot of sim.loots) {
        const key = `${loot.key}:${loot.quality}`;
        const existing = loots.get(key);
        if (existing) existing.count += loot.count;
        else loots.set(key, { ...loot });
      }
      for (const material of sim.materials) {
        materials.set(material.key, (materials.get(material.key) ?? 0) + material.count);
      }

      // run 未结算（预算耗尽 / 打不动也没死）→ 停在当前钥石，保留运行态。
      if (sim.chaosOutcome === null) break;

      const step = nextChaosStep(
        { sequence: player.chaosSequence, index, retry, failMode: player.chaosFailMode },
        sim.chaosOutcome,
        countsOf(player),
      );
      if (step.action === 'stop') {
        active = false;
        currentMap = HOME_MAP;
        index = 0;
        retry = 0;
        break;
      }
      if (player.costGood(step.keystone, 1) !== 0) {
        active = false;
        currentMap = HOME_MAP;
        index = 0;
        retry = 0;
        break;
      }
      index = step.index;
      retry = step.retry;
      const nextMap = chaosMapKeyOfTier(step.tier);
      if (nextMap === null || !this.tables.maps[nextMap]) {
        active = false;
        currentMap = HOME_MAP;
        index = 0;
        retry = 0;
        break;
      }
      currentMap = nextMap;
    }

    return {
      simulatedMs,
      exp,
      gold,
      kills,
      loots: [...loots.values()],
      materials: [...materials].map(([key, count]) => ({ key, count })),
      map: currentMap,
      active,
      index,
      retry,
    };
  }
}

// ────────────────────────────── 纯函数（可单测） ──────────────────────────────

interface Extrapolated {
  exp: number;
  gold: number;
  kills: number;
  loots: Array<{ key: string; count: number; quality: Quality }>;
  materials: Array<{ key: string; count: number }>;
}

/** `extrapolate` 的入参（只用到模拟产出的速率相关字段）。 */
interface ExtrapolateInput {
  simulatedMs: number;
  gainedExp: number;
  gainedGold: number;
  kills: number;
  loots: Array<{ key: string; count: number; quality: Quality }>;
  materials: Array<{ key: string; count: number }>;
}

/**
 * RD7：离线速率外推的可用时长。
 *
 * **只允许**当角色稳定在「战斗图」时外推；安全区、未知地图一律 `0`
 * （否则会把"打不过"直接推成"通关"）。
 */
export function offlineExtrapolationMs(
  finalMap: { monsters?: unknown } | null | undefined,
  cappedMs: number,
  simulatedMs: number,
): number {
  if (finalMap === null || finalMap === undefined) return 0;
  const monsters = finalMap.monsters;
  if (!Array.isArray(monsters) || monsters.length === 0) return 0;
  // 非法输入（NaN / Infinity）一律不外推：宁可少给，也不给出无依据的收益。
  if (!Number.isFinite(cappedMs) || !Number.isFinite(simulatedMs)) return 0;
  return Math.max(0, Math.max(0, cappedMs) - Math.max(0, simulatedMs));
}

/**
 * C2：按 C1 得到的速率线性外推。
 *
 * - `simulatedMs <= 0` 或 `extrapolatedMs <= 0` → 全部为 0（不做无依据的外推）；
 * - 击杀数四舍五入；掉落/材料按比例向下取整（避免给出比期望更多的资源）。
 */
export function extrapolate(sim: ExtrapolateInput, extrapolatedMs: number): Extrapolated {
  const none: Extrapolated = { exp: 0, gold: 0, kills: 0, loots: [], materials: [] };
  if (!(sim.simulatedMs > 0) || !(extrapolatedMs > 0)) return none;
  const factor = extrapolatedMs / sim.simulatedMs;
  if (!Number.isFinite(factor) || factor <= 0) return none;

  const loots = new Map<string, { key: string; count: number; quality: Quality }>();
  for (const loot of sim.loots) {
    const key = `${loot.key}:${loot.quality}`;
    const count = Math.floor(loot.count * factor);
    if (count <= 0) continue;
    const existing = loots.get(key);
    if (existing) existing.count += count;
    else loots.set(key, { key: loot.key, count, quality: loot.quality });
  }
  const materials = new Map<string, number>();
  for (const material of sim.materials) {
    const count = Math.floor(material.count * factor);
    if (count <= 0) continue;
    materials.set(material.key, (materials.get(material.key) ?? 0) + count);
  }

  return {
    exp: Math.floor(sim.gainedExp * factor),
    gold: Math.floor(sim.gainedGold * factor),
    kills: Math.round(sim.kills * factor),
    loots: [...loots.values()],
    materials: [...materials].map(([key, count]) => ({ key, count })),
  };
}

/** 外推经验落地：只对当前职业结算，升级循环有硬上限。 */
export function applyExpBounded(player: Player, exp: number): void {
  if (!Number.isFinite(exp) || exp <= 0) return;
  const career = player.careerInfo;
  if (!career) return;
  let rest = exp;
  let guard = 0;
  while (rest > 0 && guard < 10_000) {
    guard += 1;
    const maxExp = career.maxExp;
    if (!Number.isFinite(maxExp) || maxExp <= 0) break;
    if (career.exp + rest < maxExp) {
      career.exp += rest;
      return;
    }
    rest -= Math.max(0, maxExp - career.exp);
    career.exp = 0;
    if (career.level < career.maxLevel) {
      career.level += 1;
      player.currentCareerLevel = career.level;
    } else {
      // 满级：无巅峰，溢出经验直接丢弃（Q8）。
      break;
    }
  }
}

/** 材料落地（走 `Player.loot`，保持堆叠 / 清空语义一致）。 */
export function addMaterial(
  player: Player,
  tables: DataTables,
  key: string,
  count: number,
): void {
  if (!Number.isFinite(count) || count <= 0 || key === '') return;
  const slot = new InventorySlot(tables, 'build').fromJSON({ key, count: Math.floor(count) });
  player.loot(slot);
}

function mergeLoots(
  a: Array<{ key: string; count: number; quality: Quality }>,
  b: Array<{ key: string; count: number; quality: Quality }>,
): Array<{ key: string; count: number; quality: Quality }> {
  const out = new Map<string, { key: string; count: number; quality: Quality }>();
  for (const item of [...a, ...b]) {
    const key = `${item.key}:${item.quality}`;
    const existing = out.get(key);
    if (existing) existing.count += item.count;
    else out.set(key, { key: item.key, count: item.count, quality: item.quality });
  }
  return [...out.values()];
}

function mergeCounts(
  a: Array<{ key: string; count: number }>,
  b: Array<{ key: string; count: number }>,
): Array<{ key: string; count: number }> {
  const out = new Map<string, number>();
  for (const item of [...a, ...b]) out.set(item.key, (out.get(item.key) ?? 0) + item.count);
  return [...out].map(([key, count]) => ({ key, count }));
}

function emptyReport(offlineMs: number, cappedMs: number, paused: boolean): OfflineReportDto {
  return {
    offlineMs: Math.max(0, Number.isFinite(offlineMs) ? offlineMs : 0),
    cappedMs,
    simulatedMs: 0,
    extrapolatedMs: 0,
    gainedExp: 0,
    gainedGold: 0,
    kills: 0,
    loots: [],
    materials: [],
    pausedByMaxOffline: paused,
  };
}

function clampQuality(value: unknown): Quality {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  if (n < 0) return 0;
  if (n > 2) return 2;
  return n as Quality;
}
