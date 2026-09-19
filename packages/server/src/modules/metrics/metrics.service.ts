/**
 * 指标快照服务（07 T-A1）
 *
 * 用途：把「容量限定」暴露成**可观测**数字（不变式 I5）——没有这些数字，"撑多少人"只能是猜。
 *
 * 约定：
 * - 全部为**进程内累计/瞬时**值；无数据时不得出现 `NaN / Infinity / 负数`（统一 `safe*` 归一）；
 * - `world_time_ratio` 是**反静默半速**的核心指标（I1）：无样本时定义为 **1**；
 * - 只读，不触发任何 DB / 网络 IO。
 */
import { Inject, Injectable } from '@nestjs/common';
import { GAME_CLOCK, PlayerContextService, type NowSource } from '../logic/shared/index.js';
import { WorldService, type WorldStats } from '../logic/world/world.service.js';

/** 非有限数字 → 0；负数 → 0（计数器语义；07 §2.1「不得输出 NaN/Infinity/负数」）。 */
function safeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** 非有限数字 → 1（比值指标：无样本时"正常"）。 */
function safeRatio(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

export interface ProcessMetrics {
  readonly pid: number;
  readonly node: string;
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly heapTotalBytes: number;
}

export interface MetricsSnapshot {
  readonly service: 'idle-dark-forever';
  readonly timestamp: string;
  readonly uptimeSeconds: number;
  readonly process: ProcessMetrics;
  /** 07 §2.1 的指标表（`snake_case`）。 */
  readonly metrics: Record<string, number>;
}

@Injectable()
export class MetricsService {
  constructor(
    private readonly world: WorldService,
    private readonly contexts: PlayerContextService,
    @Inject(GAME_CLOCK) private readonly now: NowSource,
  ) {}

  snapshot(): MetricsSnapshot {
    const world: WorldStats = this.world.stats;
    const ctx = this.contexts.stats;
    const mem = process.memoryUsage();
    return {
      service: 'idle-dark-forever',
      timestamp: new Date(this.now()).toISOString(),
      uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
      process: {
        pid: safeInt(process.pid),
        node: process.version,
        rssBytes: safeInt(mem.rss),
        heapUsedBytes: safeInt(mem.heapUsed),
        heapTotalBytes: safeInt(mem.heapTotal),
      },
      metrics: {
        // P5 / 调度
        world_tick_round_duration_ms: safeInt(world.roundCpuMs),
        world_tick_round_chars_processed: safeInt(world.roundCharsProcessed),
        world_callback_used_per_round: safeInt(world.roundCallbacksUsed),
        world_callback_budget: safeInt(world.callbackBudgetPerRound),
        world_round_cpu_budget_ms: safeInt(world.maxRoundCpuMs),
        world_rounds_total: safeInt(world.roundsTotal),
        world_rounds_cut_off_total: safeInt(world.roundsCutOff),
        // P1 / 会话
        world_online_characters: safeInt(world.onlineCharacters),
        world_sessions_total: safeInt(world.sessionsTotal),
        // I1（世界时间 = 真实时间）
        world_time_ratio: safeRatio(world.worldTimeRatio),
        world_time_ratio_min: safeRatio(world.worldTimeRatioMin),
        world_time_ratio_p50: safeRatio(world.worldTimeRatioP50),
        // I2/I3（截断必须恒为 0；>0 即缺陷信号）
        world_truncated_ms_total: safeInt(world.truncatedMsTotal),
        world_debt_warn_total: safeInt(world.debtWarnTotal),
        // L3（空闲回收）
        session_reaped_total: safeInt(world.sessionReapedTotal),
        session_idle_reap_ms: safeInt(world.sessionIdleReapMs),
        // 上下文缓存
        context_loaded: safeInt(ctx.loaded),
        context_dirty: safeInt(ctx.dirty),
        context_accounts: safeInt(ctx.accounts),
      },
    };
  }
}
