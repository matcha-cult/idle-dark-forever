/**
 * 指标快照序列化边界单测（07 T-A1）
 *
 * 覆盖：正常快照 / NaN·Infinity·负数 归一 / 空上下文 / JSON 序列化不产生 null（NaN→null 是陷阱）。
 */
import { describe, expect, it } from 'vitest';
import { MetricsService } from '../src/modules/metrics/metrics.service.js';
import type { PlayerContextService } from '../src/modules/logic/shared/player-context.service.js';
import type { WorldService, WorldStats } from '../src/modules/logic/world/world.service.js';

const FIXED_NOW = 1_700_000_000_000;

interface PushStatsStub {
  stats: {
    flushed: number;
    dropped: number;
    resyncs: number;
    pendingUsers: number;
    pendingFrames: number;
    pendingOverflow: number;
  };
  limits: { flushIntervalMs: number; maxRoutesPerUser: number };
}

const ZERO_PUSH: PushStatsStub = {
  stats: { flushed: 0, dropped: 0, resyncs: 0, pendingUsers: 0, pendingFrames: 0, pendingOverflow: 0 },
  limits: { flushIntervalMs: 200, maxRoutesPerUser: 32 },
};

function makeService(
  worldStats: Partial<WorldStats>,
  ctxStats: { loaded: number; dirty: number; accounts: number } = {
    loaded: 1,
    dirty: 2,
    accounts: 3,
  },
  batcher: PushStatsStub = ZERO_PUSH,
): MetricsService {
  const world = { stats: worldStats } as unknown as WorldService;
  const contexts = { stats: ctxStats } as unknown as PlayerContextService;
  return new MetricsService(world, contexts, () => FIXED_NOW, batcher as never);
}

describe('MetricsService.snapshot', () => {
  it('正常快照：核心字段齐全且为有限数', () => {
    const snapshot = makeService({
      sessionsTotal: 5,
      onlineCharacters: 4,
      worldTimeRatio: 1.0,
      worldTimeRatioMin: 0.99,
      worldTimeRatioP50: 1.0,
      roundCharsProcessed: 5,
      roundCallbacksUsed: 123,
      roundCpuMs: 3,
      roundsTotal: 100,
      roundsCutOff: 0,
      truncatedMsTotal: 0,
      debtWarnTotal: 0,
      callbackBudgetPerRound: 50_000,
      maxRoundCpuMs: 40,
    }).snapshot();

    expect(snapshot.service).toBe('idle-dark-forever');
    expect(snapshot.timestamp).toBe(new Date(FIXED_NOW).toISOString());
    expect(snapshot.metrics.world_time_ratio).toBe(1);
    expect(snapshot.metrics.world_sessions_total).toBe(5);
    expect(snapshot.metrics.world_online_characters).toBe(4);
    expect(snapshot.metrics.world_callback_budget).toBe(50_000);
    expect(snapshot.metrics.context_accounts).toBe(3);
    for (const value of Object.values(snapshot.metrics)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('脏输入（NaN / Infinity / 负数）→ 归一：计数 0、比值 1（绝不写坏 JSON）', () => {
    const snapshot = makeService({
      sessionsTotal: Number.NaN,
      onlineCharacters: Number.POSITIVE_INFINITY,
      worldTimeRatio: Number.NaN,
      worldTimeRatioMin: Number.NEGATIVE_INFINITY,
      worldTimeRatioP50: Number.NaN,
      roundCharsProcessed: -5,
      roundCallbacksUsed: Number.NaN,
      roundCpuMs: Number.POSITIVE_INFINITY,
      roundsTotal: Number.NaN,
      roundsCutOff: -1,
      truncatedMsTotal: Number.NaN,
      debtWarnTotal: Number.POSITIVE_INFINITY,
      callbackBudgetPerRound: Number.NaN,
      maxRoundCpuMs: -40,
    }).snapshot();

    expect(snapshot.metrics.world_sessions_total).toBe(0);
    expect(snapshot.metrics.world_online_characters).toBe(0);
    expect(snapshot.metrics.world_time_ratio).toBe(1);
    expect(snapshot.metrics.world_time_ratio_min).toBe(1);
    expect(snapshot.metrics.world_time_ratio_p50).toBe(1);
    expect(snapshot.metrics.world_truncated_ms_total).toBe(0);
    expect(snapshot.metrics.world_rounds_cut_off_total).toBe(0);
    // JSON 序列化不得出现 null（NaN → null 会让监控把"无数据"误读成"掉到 0"）
    const wire = JSON.stringify(snapshot);
    expect(wire.includes('null')).toBe(false);
    const parsed = JSON.parse(wire) as { metrics: Record<string, number> };
    for (const value of Object.values(parsed.metrics)) {
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('空世界（无会话）→ ratio 定义为 1、各计数为 0', () => {
    const snapshot = makeService(
      {
        sessionsTotal: 0,
        onlineCharacters: 0,
        worldTimeRatio: 1,
        worldTimeRatioMin: 1,
        worldTimeRatioP50: 1,
        roundCharsProcessed: 0,
        roundCallbacksUsed: 0,
        roundCpuMs: 0,
        roundsTotal: 0,
        roundsCutOff: 0,
        truncatedMsTotal: 0,
        debtWarnTotal: 0,
        callbackBudgetPerRound: 50_000,
        maxRoundCpuMs: 40,
      },
      { loaded: 0, dirty: 0, accounts: 0 },
    ).snapshot();
    expect(snapshot.metrics.world_sessions_total).toBe(0);
    expect(snapshot.metrics.world_time_ratio).toBe(1);
    expect(snapshot.metrics.context_loaded).toBe(0);
  });

  it('推送防线指标可见（I5）：计数与**生效的**限额都出现在快照里', () => {
    const snapshot = makeService({}, undefined, {
      stats: { flushed: 1200, dropped: 3, resyncs: 2, pendingUsers: 7, pendingFrames: 9, pendingOverflow: 1 },
      limits: { flushIntervalMs: 200, maxRoutesPerUser: 32 },
    }).snapshot();
    expect(snapshot.metrics.push_flushed_total).toBe(1200);
    expect(snapshot.metrics.push_dropped_total).toBe(3);
    expect(snapshot.metrics.push_resync_total).toBe(2);
    expect(snapshot.metrics.push_pending_users).toBe(7);
    expect(snapshot.metrics.push_pending_frames).toBe(9);
    expect(snapshot.metrics.push_pending_overflow).toBe(1);
    expect(snapshot.metrics.push_max_routes_per_user).toBe(32);
    expect(snapshot.metrics.push_flush_interval_ms).toBe(200);
  });

  it('P2 推送实际量可见；未注入 batcher 时也不得抛错（缺省 0）', () => {
    const snapshot = makeService(
      {
        pushFrames: 1000,
        pushQuietSkips: 660,
        pushDropped: 0,
        pushPatchOps: 410,
        pushFrameBytes: 204_000,
        pushFrameBytesMax: 407,
      },
      undefined,
      // 显式传 `null`（不是 `undefined`）才能绕过默认参数，验证「未注入 batcher」的兜底
      null as never,
    ).snapshot();
    expect(snapshot.metrics.world_push_frames_total).toBe(1000);
    expect(snapshot.metrics.world_push_quiet_skips_total).toBe(660);
    expect(snapshot.metrics.world_push_dropped_total).toBe(0);
    expect(snapshot.metrics.world_push_patch_ops_total).toBe(410);
    expect(snapshot.metrics.world_push_frame_bytes_total).toBe(204_000);
    expect(snapshot.metrics.world_push_frame_bytes_max).toBe(407);
    // 未注入 batcher：所有 push_* 退化为 0，而不是 NaN/undefined
    expect(snapshot.metrics.push_flushed_total).toBe(0);
    expect(snapshot.metrics.push_max_routes_per_user).toBe(0);
  });

  it('推送实量脏输入同样归一（NaN / 负数 / Infinity → 0）', () => {
    const snapshot = makeService({
      pushFrames: Number.NaN,
      pushQuietSkips: -1,
      pushDropped: Number.POSITIVE_INFINITY,
      pushPatchOps: Number.NEGATIVE_INFINITY,
      pushFrameBytes: Number.NaN,
      pushFrameBytesMax: -5,
    }).snapshot();
    expect(snapshot.metrics.world_push_frames_total).toBe(0);
    expect(snapshot.metrics.world_push_quiet_skips_total).toBe(0);
    expect(snapshot.metrics.world_push_dropped_total).toBe(0);
    expect(snapshot.metrics.world_push_patch_ops_total).toBe(0);
    expect(snapshot.metrics.world_push_frame_bytes_total).toBe(0);
    expect(snapshot.metrics.world_push_frame_bytes_max).toBe(0);
  });
});
