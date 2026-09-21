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
  EnemyUnit,
  WORLD_BOSS_WAVE_INTERVAL,
  chaosTierOfMapKey,
  isChaosMap,
  type Clock,
  type DataTables,
  type InventorySlot,
  type Player,
} from '@idle-dark/game-core';
import {
  type ActionResult,
  BusinessErrorCode,
  type LootDto,
  type OfflineReportDto,
  type UnitPatchOpDto,
  type UnitStateDto,
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
  worldWaveOf,
  writeWorldMapState,
} from '../shared/index.js';
import { PanelCharacterService } from '../shared/panel-character.service.js';
import { BattleCollector } from '../shared/battle-collector.js';
import { buildBattleWorld, nextWorldSeed } from '../shared/headless.js';
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
import {
  diffUnitStates,
  frameByteLength,
  unitStateIndexOf,
  worldFrameOf,
} from './internal/unit-state-diff.js';
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
  /**
   * **上次成功发出的**单位状态快照（`id → UnitStateDto`），净差分的基线。
   *
   * 单位数上界 = 同屏上限 + 召唤物（实测 5 个），内存约 264B × N/会话。
   * 只有**入队成功**才推进它；入队被丢时保持不动，下一窗口自动重发。
   */
  lastSentUnits: Map<string, UnitStateDto>;
  /** 上次成功发出的波数（波数推进本身也算一次变化）。 */
  lastSentWave: number;
  /** 上次成功发出的「守关 BOSS 是否还会出现」（击杀会翻转它，也是一次变化）。 */
  lastSentBossPending: boolean;
  /** 本会话已发出的帧序号（单调递增）。 */
  frameSeq: number;
  /** 需要发一帧 `reset`（会话首帧 / 客户端明确要求重建基线）。 */
  needsReset: boolean;
  /** 上次读到的 `world.refusedUnits`（用于换算成进程级累计量）。 */
  refusedSeen: number;
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
  // ── P2 推送实际量（I3/I5：推送量、静默跳过、丢帧都必须可见） ──
  /** 实际入队成功的 `(world, tick)` 帧数。 */
  readonly pushFrames: number;
  /** 「完全无变化、整帧未入队」的窗口数（**不是**丢弃，是设计行为）。 */
  readonly pushQuietSkips: number;
  /** 入队失败（batcher 路由超限丢弃）的帧数；>0 即缺陷信号。 */
  readonly pushDropped: number;
  /** 补丁操作总数（add/chg/del/reset 合计）。 */
  readonly pushPatchOps: number;
  readonly pushFrameBytes: number;
  readonly pushFrameBytesMax: number;
  /** 因超过单图单位硬顶（`MAX_UNITS_PER_WORLD`）被拒绝注册的敌人累计数。 */
  readonly refusedUnits: number;
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
  // ── P2 推送实际量（全部为真实发送量，不再是影子） ──
  private pushFrames = 0;
  private pushQuietSkips = 0;
  private pushDropped = 0;
  private pushPatchOps = 0;
  private pushFrameBytes = 0;
  private pushFrameBytesMax = 0;
  /** 因超过单图单位硬顶被拒绝注册的敌人累计数（I2/I3；> 0 即缺陷/病态信号）。 */
  private refusedUnitsTotal = 0;
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
    /** 跨服事件总线（08 §2.3）：订阅 `CombatHooksDirty`。 */
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

    // W11 / 决策 4：本 tick 内野外阵亡 ⇒ **先重开本图 run，再出帧**，
    // 这样清场 + 「进入地图」日志能与同一帧一起下发，而不是延后 200ms。
    this.handleOpenWorldDeath(session);

    this.emitTick(session, now);
    this.publishChaosOutcome(session);

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

  /**
   * 推一帧 `(world, tick)`。**P2 起：状态走净差分、日志与掉落并帧、无变化则不推。**
   *
   * 规则（与 `ai-docs/16` 一致）：
   * - 200ms 是一个**累计窗口**：窗口内所有产出合并成一帧，因此每 200ms 至多 1 条消息；
   * - 用 `diffUnitStates` 与 `lastSentUnits` 求**净差分**（不需要 pending 变更队列）；
   * - `patch` / `log` / `loot` / `exp` / `gold` / `wave` **全部为空 ⇒ 整帧不入队**；
   * - **入队失败（被 batcher 丢弃）⇒ 不前进任何基线、不清累计器** —— 下一个窗口会重新
   *    把它们算进差分，客户端自动追平（不需要额外重同步信令）。
   */
  private emitTick(session: WorldSession, now: number): void {
    // I2/I3：单图单位硬顶的拒绝次数换算成进程级累计量（世界实例会随会话销毁）。
    const refused = session.world.refusedUnits;
    if (refused > session.refusedSeen) {
      this.refusedUnitsTotal += refused - session.refusedSeen;
      session.refusedSeen = refused;
      this.logger.warn(
        `[OVERLOAD] 单位数达硬顶，拒绝注册敌人 userId=${session.userId} characterId=${session.characterId} total=${this.refusedUnitsTotal}`,
      );
    }
    // ⚠️ 用 `snapshot()` 而不是 `drain()`：静默窗口**不能**清累计器，否则日志/经验会永久丢失。
    const collected = session.collector.snapshot();
    const units = session.world.units.map((unit) => unitStateDtoOf(unit, session.world.playerUnit));
    const wave = session.world.enemyBorn?.wave ?? 0;
    const bossPending = session.world.bossPending;
    const loot = session.pendingLoot;

    const patch: UnitPatchOpDto[] = session.needsReset
      ? [{ op: 'reset', units }]
      : diffUnitStates(session.lastSentUnits, units);

    // 「本窗口要不要发」的**唯一判据**在 `worldFrameOf`（含单测），这里只负责接线。
    const frame = worldFrameOf({
      patch,
      log: collected.events,
      loot,
      gainedExp: collected.gainedExp,
      gainedGold: collected.gainedGold,
      wave,
      prevWave: session.lastSentWave,
      bossPending,
      prevBossPending: session.lastSentBossPending,
    });

    if (frame === null) {
      // 无变化 → 不产生任何消息（这就是「无变化不推送」）。累计器**不清**，留给下一窗口。
      this.pushQuietSkips += 1;
      return;
    }

    const payload: WorldTickDto = {
      serverTime: now,
      // P2：以下两个字段**停止填充**，保留仅为不破坏冻结契约（见 dto.ts 的 @deprecated）。
      units: [],
      events: [],
      gainedExp: frame.gainedExp,
      gainedGold: frame.gainedGold,
      wave: frame.wave,
      bossEvery: WORLD_BOSS_WAVE_INTERVAL,
      bossPending: frame.bossPending,
      seq: session.frameSeq + 1,
      patch: frame.patch,
      log: frame.log,
      loot: frame.loot,
    };

    const queued = this.batcher.enqueue(session.userId, {
      cmd: WORLD_CMD.cmd,
      subCmd: WORLD_CMD.tick,
      data: payload,
    });
    if (!queued) {
      // 被 batcher 丢弃（路由数超限）：**不前进基线**，下一窗口重发，客户端自动追平。
      this.pushDropped += 1;
      return;
    }

    session.frameSeq += 1;
    session.lastSentUnits = unitStateIndexOf(units);
    session.lastSentWave = wave;
    session.lastSentBossPending = bossPending;
    session.needsReset = false;
    session.collector.drain();
    loot.length = 0;

    const bytes = frameByteLength(payload);
    this.pushFrames += 1;
    this.pushPatchOps += patch.length;
    this.pushFrameBytes += bytes;
    this.pushFrameBytesMax = Math.max(this.pushFrameBytesMax, bytes);
  }

  /**
   * 混沌仪 run 结算上报（W6）：内核置位 `chaosOutcome` 后，本 tick 发一次
   * `ChaosRunEnded`（进程内同步事件）并清位；非混沌图 / 无结果 → no-op。
   *
   * battle **只报告事实**，失败分支（重试 / 跳过 / 中断）由 `chaos` 域决定。
   */
  private publishChaosOutcome(session: WorldSession): void {
    const outcome = session.world.chaosOutcome;
    if (outcome === null) return;
    // `clear` 时先等守关 BOSS 尸体清理（掉落 / 钥石结算在 `clean()`）：本 tick 立刻换图会
    // `dispose()` 掉 clean 计时器，导致 BOSS 掉落被静默吞掉。最多延后一个清尸周期（3s）。
    if (
      outcome === 'clear' &&
      session.world.units.some((unit) => unit instanceof EnemyUnit && unit.worldBoss)
    ) {
      return;
    }
    session.world.chaosOutcome = null;
    const tier = chaosTierOfMapKey(session.world.map);
    if (tier === null) return;
    this.events.emit({
      type: 'ChaosRunEnded',
      userId: session.userId,
      characterId: session.characterId,
      tier,
      outcome,
    });
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
      pushFrames: this.pushFrames,
      pushQuietSkips: this.pushQuietSkips,
      pushDropped: this.pushDropped,
      pushPatchOps: this.pushPatchOps,
      pushFrameBytes: this.pushFrameBytes,
      pushFrameBytesMax: this.pushFrameBytesMax,
      refusedUnits: this.refusedUnitsTotal,
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

  positionOf(userId: number, characterId: string): { map: string } | undefined {
    const session = this.sessions.get(this.keyOf(userId, characterId));
    if (!session) return undefined;
    return { map: session.world.map };
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
    const storedPosition = extras.worldMaps[characterId];
    const position = resolveWorldPosition(this.tables, storedPosition);
    // W4/W11：会话重启（刷新 / 断线重连 / 空闲回收）时恢复本图**已完成的波数 + 里程碑**。
    // 存档漂移（未知 mapKey → `home`）视为换图，进度归 0；各字段只在 > 0 时携带。
    const sameMap = storedPosition !== undefined && storedPosition.map === position.map;
    const restoredWave = sameMap ? worldWaveOf(storedPosition?.wave) : 0;
    const restoredEliteWave = sameMap ? worldWaveOf(storedPosition?.lastEliteWave) : 0;
    const restoredBossWave = sameMap ? worldWaveOf(storedPosition?.lastBossWave) : 0;
    // 持久化位置是「当前地图」的**唯一权威**（08 §2.3 / 09 §4.3）。
    // 会话启动即写入，保证从未进过图的角色也有位置。
    // ⚠️ 走**唯一写入口**（C6）：离线结算曾在这里之外另拼一份对象字面量、少写 `wave`，
    // 导致每次登录波数归零。
    writeWorldMapState(extras.worldMaps, characterId, {
      map: position.map,
      wave: restoredWave,
      lastEliteWave: restoredEliteWave,
      lastBossWave: restoredBossWave,
    });
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
      lastSentUnits: new Map<string, UnitStateDto>(),
      lastSentWave: 0,
      // 会话首帧就是 `reset`，因此初值取 `false`（首帧一定发得出去，不依赖它触发）。
      lastSentBossPending: false,
      frameSeq: 0,
      needsReset: true,
      refusedSeen: 0,
    };

    const built = buildBattleWorld({
      tables: this.tables,
      player,
      map: position.map,
      seed,
      sink: collector,
      clock,
      updateRate: 1,
      expRate: EXP_RATE,
      medicineLevel: (type) => extras.medicineLevel[type] ?? 0,
      ...(restoredWave > 0
        ? {
            enemyBornState: {
              wave: restoredWave,
              lastEliteWave: restoredEliteWave,
              lastBossWave: restoredBossWave,
            },
          }
        : {}),
      lootRecorder: {
        record: (slot, handled) => {
          session.pendingLoot.push(toLootDto(slot, handled));
        },
      },
    });
    session.world = built.world;

    // W11 / R3：会话恢复后**立刻补齐**当前波窗口的里程碑。
    // 「已刷出但未入档」的守关 BOSS / 精英会在这里当波补刷，而不再等到下一个 20 / 10 波窗口
    // —— 旧实现用 `wave % 20 === 0` 当闸门，恢复到第 20 波时首次再出要等到第 40 波。
    session.world.enemyBorn?.ensureMilestones();

    clock.pause();
    player.timestamp = now;
    this.playerContext.markDirty(userId, characterId);

    this.sessions.set(key, session);
    this.activeByUser.set(userId, characterId);
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

  /** 命令端口（`BATTLE_COMMAND`）：启动 / 获取会话；`true` = 会话就绪。 */
  async startSession(userId: number, characterId: string): Promise<boolean> {
    return (await this.start(userId, characterId)) !== null;
  }

  /** 命令端口（`BATTLE_COMMAND`）：停会话并落库。 */
  async stopSession(userId: number, characterId: string): Promise<void> {
    await this.stop(userId, characterId);
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

  /**
   * W11 / 决策 4：野外战斗图阵亡 ⇒ **重开本图 run**（波数归 0、里程碑复位、清场重刷）。
   *
   * 产品口径（用户原话）：*"连续死肯定是玩家问题，正常人应该是回去提升装备，或者回到上一个
   * 能打过的图，系统不为玩家做选择"* —— 所以这里**不加任何护栏**：不做「连续死亡 N 次停手」、
   * 不自动退回上一张图、不弹确认。
   *
   * 实现上**有意不销毁 / 不重建会话**（那会牵进离线时间锚点 `player.timestamp`、`opId` 幂等、
   * 跨服命令与会话回收竞态），而是复用「重复进入当前地图 = 重置本图」的同一条路径
   * （`BattleWorld.resetOpenWorldRun` → `onMapChanged`），可观测效果一致：波次归零、怪物重刷、
   * 且会发一条 `mapEnter` 日志。
   *
   * 幂等：`resetOpenWorldRun()` 会把标志清零，因此每次阵亡只重开一次；
   * 未置位时本函数是 no-op（安全）。
   */
  private handleOpenWorldDeath(session: WorldSession): void {
    if (!session.world.openWorldDeath) return;
    const map = session.world.map;
    session.world.resetOpenWorldRun();
    this.logger.log(
      `[W11] 野外阵亡 → 重开本图 run userId=${session.userId} characterId=${session.characterId} map=${map}`,
    );
    // 立刻把「波数 0 / 里程碑复位」落进侧车：否则紧接着的刷新会读回旧波数。
    void this.persistPosition(session).catch((error: unknown) => {
      this.logger.warn(`阵亡重开后落库失败：${session.characterId}`, {
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async persistPosition(session: WorldSession): Promise<void> {
    const extras = await this.playerContext.extrasOf(session.userId);
    // W4/W11：连同波数与里程碑一起落库（世界侧车状态；`0` 一律不落，由 `writeWorldMapState` 归一）。
    // ⚠️ **唯一写入口** —— 曾经离线结算（`IdleLogicService.settle`）在这里之外另拼一份
    // `{ map }`，把 `wave` 抹掉，于是每次登录波数都归零。
    writeWorldMapState(extras.worldMaps, session.characterId, {
      map: session.world.map,
      wave: session.world.enemyBorn?.wave ?? 0,
      lastEliteWave: session.world.enemyBorn?.lastEliteWave ?? 0,
      lastBossWave: session.world.enemyBorn?.lastBossWave ?? 0,
    });
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
    options?: { readonly allowChaos?: boolean },
  ): Promise<ActionResult<WorldSnapshotDto>> {
    const session = await this.start(userId, characterId);
    if (!session) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    const map = this.tables.maps[mapKey];
    if (!map) return fail(BusinessErrorCode.MAP_LOCKED, '地图不存在');
    // W6：混沌图只能由混沌仪（`allowChaos`）进入；普通进图入口一律拒绝。
    if (isChaosMap(map) && options?.allowChaos !== true) {
      return fail(BusinessErrorCode.MAP_LOCKED, '混沌图只能通过混沌仪进入');
    }
    // 重复进入当前地图 = 「重置本图」（原版重新进入地图会重置刷怪与战斗），
    // 不报 ALREADY_IN_MAP —— 这样前端 select 后直接 enterMap 永远可用。
    if (session.world.map === mapKey) {
      session.world.onMapChanged();
      // W4：重置本图 → `onMapChanged()` 重建 `EnemyBorn`（波数归 0），这里把 0 落库，
      // 避免旧波数残留在 `AccountExtras` 里、下次重进读出错误进度。
      await this.persistPosition(session);
      return ok(await this.snapshotOf(session));
    }

    // 带 `opId` 的切换必须幂等：同 opId 重放不重复切换。
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

      // 解锁判定唯一入口（shared/map-dto）：map 控制器与 battle 会话宿主共用同一实现。
      const unlocked = evaluateMapUnlock(map.requirement, player, session.world.map);
      if (!unlocked) {
        this.opIds.abort(userId, opId ?? '');
        return fail(BusinessErrorCode.MAP_LOCKED);
      }

      session.world.map = mapKey;
      await this.persistPosition(session);
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
    const units = session.world.units.map((unit) => unitStateDtoOf(unit, session.world.playerUnit));
    // P2：客户端拿到全量快照即等于拿到了差分基线 —— 同步推进服务端基线并撤销 reset，
    // 避免紧接着又推一帧内容重复的 `reset`。
    session.lastSentUnits = unitStateIndexOf(units);
    session.lastSentWave = session.world.enemyBorn?.wave ?? 0;
    session.lastSentBossPending = session.world.bossPending;
    session.needsReset = false;
    return {
      map: session.world.map,
      units,
      maps: player ? mapListDtoOf(this.tables, player, session.world.map) : [],
      updateRate: session.world.updateRate,
      paused: session.clock.isPaused(),
      wave: session.lastSentWave,
      bossEvery: WORLD_BOSS_WAVE_INTERVAL,
      bossPending: session.world.bossPending,
    };
  }
}

// ────────────────────────────── 模块级纯函数 ──────────────────────────────

/**
 * `world.tick` 合并器（P2）：**有序拼接补丁** + 累积日志/掉落/经验金币 + 取最新波数。
 *
 * 为什么 `patch` 是**简单拼接**而不是「按 id 合并」：`patch` 是**有序操作流**，
 * 客户端按序应用；两个窗口的操作拼起来就等于「先应用 A 再应用 B」，
 * 语义天然正确（含 `add` 后 `del` 这类抵消）。
 */
export function mergeWorldTick(prev: unknown, next: unknown): WorldTickDto {
  const a = asTick(prev);
  const b = asTick(next);
  if (!a) {
    return (
      b ?? {
        serverTime: 0,
        units: [],
        events: [],
        gainedExp: 0,
        gainedGold: 0,
        wave: 0,
        bossEvery: WORLD_BOSS_WAVE_INTERVAL,
        seq: 0,
        patch: [],
        log: [],
        loot: [],
      }
    );
  }
  if (!b) return a;
  // BOSS 可刷状态取**最新**帧（`b`）：击杀后不得被同批旧帧翻回 `true`。
  const bossPending = b.bossPending ?? a.bossPending;
  return {
    serverTime: Math.max(a.serverTime, b.serverTime),
    // P2：停止填充，固定为空数组（冻结契约保留字段）。
    units: [],
    events: [],
    gainedExp: a.gainedExp + b.gainedExp,
    gainedGold: a.gainedGold + b.gainedGold,
    // 波次取**最新**帧（`b`）：同一批次内的旧帧不得把波数回退。
    wave: b.wave ?? a.wave ?? 0,
    bossEvery: b.bossEvery ?? a.bossEvery ?? WORLD_BOSS_WAVE_INTERVAL,
    // 同理，BOSS 可刷状态也取最新帧：击杀后**不得**被同批旧帧翻回 `true`。
    ...(bossPending === undefined ? {} : { bossPending }),
    seq: Math.max(finiteOr0(a.seq), finiteOr0(b.seq)),
    patch: [...(a.patch ?? []), ...(b.patch ?? [])],
    log: [...(a.log ?? []), ...(b.log ?? [])],
    loot: mergeLoot(a.loot, b.loot),
  };
}

function finiteOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asTick(value: unknown): WorldTickDto | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Partial<WorldTickDto>;
  if (!Array.isArray(record.units)) return null;
  const tick: WorldTickDto = {
    serverTime: typeof record.serverTime === 'number' ? record.serverTime : 0,
    units: record.units,
    events: Array.isArray(record.events) ? record.events : [],
    gainedExp: typeof record.gainedExp === 'number' ? record.gainedExp : 0,
    gainedGold: typeof record.gainedGold === 'number' ? record.gainedGold : 0,
  };
  if (typeof record.wave === 'number' && Number.isFinite(record.wave)) tick.wave = record.wave;
  if (typeof record.bossEvery === 'number' && Number.isFinite(record.bossEvery)) {
    tick.bossEvery = record.bossEvery;
  }
  if (typeof record.bossPending === 'boolean') tick.bossPending = record.bossPending;
  if (typeof record.seq === 'number' && Number.isFinite(record.seq)) tick.seq = record.seq;
  if (Array.isArray(record.patch)) tick.patch = record.patch;
  if (Array.isArray(record.log)) tick.log = record.log;
  if (Array.isArray(record.loot)) tick.loot = record.loot;
  return tick;
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
    handled === 'sell' || handled === 'decompose' || handled === 'lost' ? handled : 'pickup';
  const dto: LootDto = { slot: slotDtoOf(slot, 0), handled: action };
  if (action === 'sell' && slot.key === 'gold') dto.gold = slot.count ?? 0;
  return dto;
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
