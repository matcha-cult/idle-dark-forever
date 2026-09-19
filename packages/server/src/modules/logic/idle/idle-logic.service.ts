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
 * **不占真实时间**：全程 `VirtualClock.advanceBy(ms, budget)`，无宿主定时器、无 await。
 * 超过 24h 的离线会置 `pausedByMaxOffline`（表示「已达最大离线暂停阈值」，字段语义见交付报告）。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  InventorySlot,
  VirtualClock,
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
import { BattleCollector } from '../world/internal/battle-collector.js';
import { buildBattleWorld, nextWorldSeed } from '../world/internal/headless.js';
import { OFFLINE_MAX_MS, OFFLINE_PAUSE_AFTER_MS } from '../world/world.config.js';

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

interface SimResult {
  simulatedMs: number;
  gainedExp: number;
  gainedGold: number;
  kills: number;
  loots: Array<{ key: string; count: number; quality: Quality }>;
  materials: Array<{ key: string; count: number }>;
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
    return this.settle(userId, characterId);
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
    const position = resolvePosition(this.tables, extras.worldMaps[characterId]);
    const seed = await this.seedOf(userId, characterId, extras);

    const simulated = Math.min(cappedMs, SIM_BUDGET_MS);
    const sim = this.runSimulation(player, extras, position, seed, simulated);

    // C2：按 C1 的速率外推剩余时长。
    const extrapolatedMs = Math.max(0, cappedMs - sim.simulatedMs);
    const extrap = extrapolate(sim, extrapolatedMs);

    // 落地 C2 的收益（C1 的收益已由 `Player.loot` / `addSkillExp` 在模拟中落地）。
    if (extrap.gold > 0) player.gold += extrap.gold;
    if (extrap.exp > 0) applyExpBounded(player, extrap.exp);
    for (const material of extrap.materials) {
      addMaterial(player, this.tables, material.key, material.count);
    }

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

  private async seedOf(userId: number, characterId: string, extras: AccountExtras): Promise<number> {
    const stored = extras.worldSeeds[characterId];
    if (typeof stored === 'number' && Number.isFinite(stored) && stored !== 0) return stored;
    const seed = nextWorldSeed();
    extras.worldSeeds[characterId] = seed;
    this.playerContext.markAccountDirty(userId);
    return seed;
  }

  /** C1：有界快进模拟（无 IO、无真实时间）。 */
  private runSimulation(
    player: Player,
    extras: AccountExtras,
    position: { map: string; endlessLevel: number },
    seed: number,
    simulated: number,
  ): SimResult {
    const clock = new VirtualClock();
    const collector = new BattleCollector();
    let world: ReturnType<typeof buildBattleWorld>['world'] | null = null;
    try {
      world = buildBattleWorld({
        tables: this.tables,
        player,
        map: position.map,
        endlessLevel: position.endlessLevel,
        seed,
        sink: collector,
        clock,
        updateRate: 1,
        medicineLevel: (type) => extras.medicineLevel[type] ?? 0,
        // 离线结算不推送掉落，也不需要 LootDto 记录。
      });

      let remaining = simulated;
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
        simulatedMs: Math.max(0, simulated - remaining),
        gainedExp: snapshot.gainedExp,
        gainedGold: snapshot.gainedGold,
        kills: snapshot.kills,
        loots: snapshot.loots
          .filter((loot) => loot.handled === 'pickup')
          .map((loot) => ({ key: loot.key, count: loot.count, quality: clampQuality(loot.quality) })),
        materials: snapshot.materials,
      };
    } catch (error) {
      this.logger.warn('离线快进模拟失败，回退为纯外推', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return { simulatedMs: 0, gainedExp: 0, gainedGold: 0, kills: 0, loots: [], materials: [] };
    } finally {
      try {
        world?.dispose();
      } catch {
        // 忽略半初始化状态的 dispose 失败。
      }
      clock.dispose();
    }
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

/**
 * C2：按 C1 得到的速率线性外推。
 *
 * - `simulatedMs <= 0` 或 `extrapolatedMs <= 0` → 全部为 0（不做无依据的外推）；
 * - 击杀数四舍五入；掉落/材料按比例向下取整（避免给出比期望更多的资源）。
 */
export function extrapolate(sim: SimResult, extrapolatedMs: number): Extrapolated {
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
    } else if (career.level >= 60 && career.peakLevel < Number.MAX_SAFE_INTEGER) {
      career.peakLevel += 1;
    } else {
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
  if (n > 6) return 6;
  return n as Quality;
}

function resolvePosition(
  tables: DataTables,
  stored: { map: string; endlessLevel: number } | undefined,
): { map: string; endlessLevel: number } {
  if (!stored) return { map: 'home', endlessLevel: 0 };
  return { map: tables.maps[stored.map] ? stored.map : 'home', endlessLevel: stored.endlessLevel };
}
