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
  DungeonState,
  InventorySlot,
  VirtualClock,
  consumeDungeonStack,
  decideChallengeEntry,
  isCombatArea,
  planDungeonCooldown,
  ticketKeyOf,
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
  pickOpenWorldMap,
  type AccountExtras,
  type ChallengeEntry,
  type DungeonCooldownEntry,
  type DungeonRunEntry,
  type NowSource,
} from '../shared/index.js';
import { BattleCollector } from '../shared/battle-collector.js';
import { buildBattleWorld, nextWorldSeed } from '../shared/headless.js';
import { EXP_RATE, OFFLINE_MAX_MS, OFFLINE_PAUSE_AFTER_MS } from '../shared/index.js';

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
/** 单次离线结算最多处理的条目数（当前位置 + 挑战队列；防无界循环）。 */
export const MAX_OFFLINE_ENTRIES = 8;

/** 离线模拟计划中的一条（当前位置或挑战队列条目）。 */
interface OfflineEntry {
  key: string;
  endlessLevel: number;
  isDungeon: boolean;
  /** 是否来自挑战队列（队列条目会被消费；当前位置不会）。 */
  fromQueue: boolean;
}

/** 单条目的模拟产出。 */
interface MapSimResult {
  simulatedMs: number;
  gainedExp: number;
  gainedGold: number;
  kills: number;
  loots: Array<{ key: string; count: number; quality: Quality }>;
  materials: Array<{ key: string; count: number }>;
  /** 秘境：run 是否已结束（通关 / 阵亡）。开放世界恒 `false`。 */
  runEnded: boolean;
  /** run 结束后转出的地图（`outside`）。 */
  outside: string | undefined;
  /** 未结束的秘境：可落库的刷怪器相位（M7）。 */
  enemyBorn: unknown;
}

/** 队列顺序模拟的汇总。 */
interface OfflineWalk {
  simulatedMs: number;
  gainedExp: number;
  gainedGold: number;
  kills: number;
  loots: Array<{ key: string; count: number; quality: Quality }>;
  materials: Array<{ key: string; count: number }>;
  finalMap: string;
  finalEndlessLevel: number;
  /** 已消费后剩余的挑战队列。 */
  finalQueue: ChallengeEntry[];
  /** 预算耗尽停在当前秘境条目时的进行中 run（否则 `null`）。 */
  activeRun: DungeonRunEntry | null;
}

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
  /** 离线生成 runId 的序号（`characterId#offline#now#seq`）。 */
  private offlineRunSeq = 0;
  /** 因无票 / 冷却未就绪而跳过的秘境条目数（RD5 观测）。 */
  private skippedOffline = 0;

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
    const position = resolvePosition(this.tables, extras.worldMaps[characterId]);
    const queue = [...(extras.challengeQueue[characterId] ?? [])];
    const entries = this.planOfflineEntries(position, queue);

    // RD1：既不在战斗区域、也没有队列条目 → 零收益（时间锚点照常推进）。
    if (entries.length === 0) {
      player.timestamp = now;
      this.playerContext.markDirty(userId, characterId);
      await this.playerContext.flush(userId, characterId);
      return ok(emptyReport(rawMs, 0, pausedByMaxOffline));
    }

    const seed = await this.seedOf(userId, characterId, extras);
    // RD3：按「当前位置 + 挑战队列」顺序、在共享预算内逐条目模拟。
    const walk = this.walkEntries(userId, characterId, player, extras, entries, queue, seed, cappedMs);

    // C2：只对**最终稳定在非秘境战斗图**的剩余时长做速率外推（RD7）。
    const extrapolatedMs = offlineExtrapolationMs(
      this.tables.maps[walk.finalMap],
      cappedMs,
      walk.simulatedMs,
    );
    const extrap = extrapolate(
      {
        simulatedMs: walk.simulatedMs,
        gainedExp: walk.gainedExp,
        gainedGold: walk.gainedGold,
        kills: walk.kills,
        loots: walk.loots,
        materials: walk.materials,
      },
      extrapolatedMs,
    );

    if (extrap.gold > 0) player.gold += extrap.gold;
    if (extrap.exp > 0) applyExpBounded(player, extrap.exp);
    for (const material of extrap.materials) {
      addMaterial(player, this.tables, material.key, material.count);
    }

    // 落库：位置 / 挑战队列 / run 档（M7）/ 冷却与票（RC2/RC3）。
    extras.worldMaps[characterId] = { map: walk.finalMap, endlessLevel: walk.finalEndlessLevel };
    extras.challengeQueue[characterId] = walk.finalQueue;
    if (walk.activeRun !== null) extras.dungeonRuns[characterId] = walk.activeRun;
    else delete extras.dungeonRuns[characterId];
    player.timestamp = now;
    this.playerContext.markDirty(userId, characterId);
    this.playerContext.markAccountDirty(userId);
    await this.playerContext.flush(userId, characterId);

    const report: OfflineReportDto = {
      offlineMs: rawMs,
      cappedMs,
      simulatedMs: walk.simulatedMs,
      extrapolatedMs,
      gainedExp: walk.gainedExp + extrap.exp,
      gainedGold: walk.gainedGold + extrap.gold,
      kills: walk.kills + extrap.kills,
      loots: mergeLoots(walk.loots, extrap.loots),
      materials: mergeCounts(walk.materials, extrap.materials),
      pausedByMaxOffline,
    };
    this.cached.set(this.keyOf(userId, characterId), report);
    return ok(report);
  }

  /**
   * 离线模拟计划：当前所在地图（若是战斗区域）+ 挑战队列条目（按顺序，最多 `MAX_OFFLINE_ENTRIES`）。
   *
   * 安全区当前位置不入计划（RD1）；未知地图条目跳过。
   */
  private planOfflineEntries(
    position: { map: string; endlessLevel: number },
    queue: readonly ChallengeEntry[],
  ): OfflineEntry[] {
    const out: OfflineEntry[] = [];
    const current = this.tables.maps[position.map];
    if (isCombatArea(current)) {
      out.push({
        key: position.map,
        endlessLevel: position.endlessLevel,
        isDungeon: current?.isDungeon === true,
        fromQueue: false,
      });
    }
    for (const entry of queue) {
      if (out.length >= MAX_OFFLINE_ENTRIES) break;
      const map = this.tables.maps[entry.key];
      if (!map) continue;
      out.push({
        key: entry.key,
        endlessLevel: entry.endlessLevel,
        isDungeon: map.isDungeon === true,
        fromQueue: true,
      });
    }
    return out;
  }

  /**
   * 队列顺序模拟主循环（RD3/RD5/RD7）。
   *
   * - 秘境条目：命中已持久化 run → 续跑（不重复扣票）；否则走冷却/票判定，**无票或冷却未就绪跳过**（RD5 记数）；
   *   可打则扣票 + 消耗一层冷却；通关/阵亡 → 清 run 档并转 `outside`；**预算耗尽停在当前条目**（保存 run 相位）；
   * - 开放世界条目：消耗剩余预算（不会"完成"），位置落在该图；
   * - 队列消耗按顺序计数，`finalQueue` 为其剩余部分。
   */
  private walkEntries(
    userId: number,
    characterId: string,
    player: Player,
    extras: AccountExtras,
    entries: readonly OfflineEntry[],
    queue: readonly ChallengeEntry[],
    seed: number,
    cappedMs: number,
  ): OfflineWalk {
    let remaining = Math.min(cappedMs, SIM_BUDGET_MS);
    let simulatedMs = 0;
    let gainedExp = 0;
    let gainedGold = 0;
    let kills = 0;
    const loots: Array<{ key: string; count: number; quality: Quality }> = [];
    const materials: Array<{ key: string; count: number }> = [];
    let finalMap = entries[0]?.key ?? 'home';
    let finalEndlessLevel = entries[0]?.endlessLevel ?? 0;
    let consumed = 0;
    let activeRun: DungeonRunEntry | null = null;
    // `broke` = 因"预算耗尽停在当前条目 / 进入开放图"而中断；为 false 表示逐条目走完
    let broke = false;

    for (const entry of entries) {
      if (remaining <= 0) break;

      if (entry.isDungeon) {
        const existing = extras.dungeonRuns[characterId];
        const resumed =
          existing !== undefined &&
          existing.mapKey === entry.key &&
          existing.endlessLevel === entry.endlessLevel;
        let runId: string;
        let enemyBorn: unknown;
        if (resumed) {
          runId = existing.runId;
          enemyBorn = existing.enemyBorn;
        } else {
          const gate = this.gateOfflineDungeon(entry, player, extras, characterId);
          if (!gate.ok) {
            // RD5：无票 / 冷却未就绪 → 跳过该条并继续（不中断整个队列）
            if (entry.fromQueue) consumed += 1;
            this.skippedOffline += 1;
            this.logger.log(
              `[CHALLENGE] 离线跳过不可用秘境条目：${entry.key}（角色 ${characterId}）`,
            );
            continue;
          }
          runId = gate.runId;
          enemyBorn = undefined;
        }

        const sim = this.simulateOnMap({
          player,
          extras,
          entry,
          seed,
          budget: remaining,
          paid: true,
          isDungeon: true,
          ...(enemyBorn === undefined ? {} : { enemyBornState: enemyBorn }),
        });
        simulatedMs += sim.simulatedMs;
        gainedExp += sim.gainedExp;
        gainedGold += sim.gainedGold;
        kills += sim.kills;
        loots.push(...sim.loots);
        materials.push(...sim.materials);
        remaining -= sim.simulatedMs;

        if (sim.runEnded) {
          if (entry.fromQueue) consumed += 1;
          finalMap = pickOpenWorldMap(this.tables, sim.outside, finalMap);
          finalEndlessLevel = 0;
          activeRun = null;
        } else {
          // 预算耗尽停在当前条目：条目**保留**在队列里，run 相位落库（下次续跑）
          finalMap = entry.key;
          finalEndlessLevel = entry.endlessLevel;
          activeRun = {
            runId,
            mapKey: entry.key,
            endlessLevel: entry.endlessLevel,
            ...(sim.enemyBorn === undefined ? {} : { enemyBorn: sim.enemyBorn }),
          };
          broke = true;
          break;
        }
        continue;
      }

      // 开放世界：消耗剩余预算，位置落在该图
      const sim = this.simulateOnMap({
        player,
        extras,
        entry,
        seed,
        budget: remaining,
        paid: false,
        isDungeon: false,
      });
      simulatedMs += sim.simulatedMs;
      gainedExp += sim.gainedExp;
      gainedGold += sim.gainedGold;
      kills += sim.kills;
      loots.push(...sim.loots);
      materials.push(...sim.materials);
      remaining -= sim.simulatedMs;
      if (entry.fromQueue) consumed += 1;
      finalMap = entry.key;
      finalEndlessLevel = entry.endlessLevel;
      activeRun = null;
      broke = true;
      break;
    }

    // RD3：队列耗尽（或秘境全部打完）后仍有预算 → 在最终的非秘境战斗图继续模拟，
    // 让"全部秘境完成后自动打非秘境地图"在离线同样成立。
    if (!broke && remaining > 0 && activeRun === null) {
      const tailMap = this.tables.maps[finalMap];
      if (isCombatArea(tailMap) && tailMap?.isDungeon !== true) {
        const tail = this.simulateOnMap({
          player,
          extras,
          entry: {
            key: finalMap,
            endlessLevel: finalEndlessLevel,
            isDungeon: false,
            fromQueue: false,
          },
          seed,
          budget: remaining,
          paid: false,
          isDungeon: false,
        });
        simulatedMs += tail.simulatedMs;
        gainedExp += tail.gainedExp;
        gainedGold += tail.gainedGold;
        kills += tail.kills;
        loots.push(...tail.loots);
        materials.push(...tail.materials);
        remaining -= tail.simulatedMs;
      }
    }

    return {
      simulatedMs,
      gainedExp,
      gainedGold,
      kills,
      loots,
      materials,
      finalMap,
      finalEndlessLevel,
      finalQueue: queue.slice(Math.min(consumed, queue.length)),
      activeRun,
    };
  }

  /**
   * 离线进入秘境的闸门（RC2/RC3/RD5）：命中则**扣票一次**并消耗一层冷却。
   *
   * 不命中（票不足 / 冷却未就绪 / 非秘境）返回 `ok:false`（调用方按 RD5 跳过）；
   * 无论命中与否都会把「已跨周期回满」的状态落进 `extras`。
   */
  private gateOfflineDungeon(
    entry: OfflineEntry,
    player: Player,
    extras: AccountExtras,
    characterId: string,
  ): { ok: true; runId: string } | { ok: false } {
    const map = this.tables.maps[entry.key];
    if (!map || map.isDungeon !== true) return { ok: false };
    const ticketKey = ticketKeyOf(entry.key, map, entry.endlessLevel);
    const plan = planDungeonCooldown(
      this.cooldownOf(extras, characterId, ticketKey),
      map,
      this.now(),
    );
    this.setCooldown(extras, characterId, ticketKey, plan.state);
    if (decideChallengeEntry(safeTicketCount(player, ticketKey), plan.available) === 'skip') {
      return { ok: false };
    }
    player.costTicket(ticketKey);
    this.setCooldown(extras, characterId, ticketKey, consumeDungeonStack(plan.state));
    return { ok: true, runId: this.nextOfflineRunId(characterId) };
  }

  /**
   * 在单张图上做有界快进模拟（在线 tick 的离线镜像）。
   *
   * - 秘境：`enemyBornState` 恢复相位、`paid` 置 `ticketPaid`（M5/M7）；
   *   `world.map` 一旦被内核切走即视为 run 结束；
   * - 开放世界：跑到预算耗尽；
   * - 全程 `VirtualClock`，无宿主定时器、无 await。
   */
  private simulateOnMap(params: {
    player: Player;
    extras: AccountExtras;
    entry: OfflineEntry;
    seed: number;
    budget: number;
    paid: boolean;
    isDungeon: boolean;
    enemyBornState?: unknown;
  }): MapSimResult {
    const { player, extras, entry } = params;
    const clock = new VirtualClock();
    const collector = new BattleCollector();
    let world: ReturnType<typeof buildBattleWorld>['world'] | null = null;
    try {
      world = buildBattleWorld({
        tables: this.tables,
        player,
        map: entry.key,
        endlessLevel: entry.endlessLevel,
        seed: params.seed,
        sink: collector,
        clock,
        updateRate: 1,
        expRate: EXP_RATE,
        medicineLevel: (type) => extras.medicineLevel[type] ?? 0,
        ...(params.enemyBornState === undefined ? {} : { enemyBornState: params.enemyBornState }),
      }).world;
      if (params.paid && world.enemyBorn instanceof DungeonState) {
        world.enemyBorn.ticketPaid = true;
      }

      let remaining = params.budget;
      let calls = 0;
      while (remaining > 0 && calls < SIM_MAX_CALLS) {
        const left = clock.advanceBy(remaining, SIM_CALLBACK_BUDGET);
        calls += 1;
        const progressed = remaining - left;
        if (!(progressed > 0)) break;
        remaining = left;
        if (remaining <= 0) break;
        if (params.isDungeon && world.map !== entry.key) break;
        if (collector.snapshot().kills >= SIM_KILL_BUDGET) break;
      }

      const snapshot = collector.snapshot();
      const runEnded = params.isDungeon && world.map !== entry.key;
      return {
        simulatedMs: Math.max(0, params.budget - remaining),
        gainedExp: snapshot.gainedExp,
        gainedGold: snapshot.gainedGold,
        kills: snapshot.kills,
        loots: snapshot.loots
          .filter((loot) => loot.handled === 'pickup')
          .map((loot) => ({ key: loot.key, count: loot.count, quality: clampQuality(loot.quality) })),
        materials: snapshot.materials,
        runEnded,
        outside: this.tables.maps[entry.key]?.outside,
        enemyBorn: runEnded ? undefined : world.enemyBorn?.dumpState(),
      };
    } catch (error) {
      this.logger.warn('离线快进模拟失败（该条目按无收益处理）', {
        reason: error instanceof Error ? error.message : String(error),
        map: entry.key,
      });
      return {
        simulatedMs: 0,
        gainedExp: 0,
        gainedGold: 0,
        kills: 0,
        loots: [],
        materials: [],
        runEnded: false,
        outside: this.tables.maps[entry.key]?.outside,
        enemyBorn: undefined,
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

  private cooldownOf(
    extras: AccountExtras,
    characterId: string,
    ticketKey: string,
  ): DungeonCooldownEntry | undefined {
    return extras.dungeonCooldowns[characterId]?.[ticketKey];
  }

  private setCooldown(
    extras: AccountExtras,
    characterId: string,
    ticketKey: string,
    state: DungeonCooldownEntry,
  ): void {
    const perChar = extras.dungeonCooldowns[characterId] ?? {};
    perChar[ticketKey] = {
      stacks: state.stacks,
      lastResetAt: state.lastResetAt,
      lastUsedAt: state.lastUsedAt,
    };
    extras.dungeonCooldowns[characterId] = perChar;
  }

  private nextOfflineRunId(characterId: string): string {
    this.offlineRunSeq = (this.offlineRunSeq + 1) % 1_000_000;
    return `${characterId}#offline#${this.now()}#${this.offlineRunSeq}`;
  }

  private async seedOf(userId: number, characterId: string, extras: AccountExtras): Promise<number> {
    const stored = extras.worldSeeds[characterId];
    if (typeof stored === 'number' && Number.isFinite(stored) && stored !== 0) return stored;
    const seed = nextWorldSeed();
    extras.worldSeeds[characterId] = seed;
    this.playerContext.markAccountDirty(userId);
    return seed;
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
 * **只允许**当最终稳定在「非秘境战斗图」时外推；秘境（含预算耗尽停在秘境）、
 * 安全区、未知地图一律 `0`（否则会把"打不过"直接推成"通关"）。
 */
export function offlineExtrapolationMs(
  finalMap: { isDungeon?: boolean; monsters?: unknown } | null | undefined,
  cappedMs: number,
  simulatedMs: number,
): number {
  if (finalMap === null || finalMap === undefined) return 0;
  if (finalMap.isDungeon === true) return 0;
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

function safeTicketCount(player: Player, ticketKey: string): number {
  try {
    const count = player.countTicket(ticketKey);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

function clampQuality(value: unknown): Quality {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  if (n < 0) return 0;
  if (n > 2) return 2;
  return n as Quality;
}

function resolvePosition(
  tables: DataTables,
  stored: { map: string; endlessLevel: number } | undefined,
): { map: string; endlessLevel: number } {
  if (!stored) return { map: 'home', endlessLevel: 0 };
  return { map: tables.maps[stored.map] ? stored.map : 'home', endlessLevel: stored.endlessLevel };
}
