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

function makeService(
  worldStats: Partial<WorldStats>,
  ctxStats: { loaded: number; dirty: number; accounts: number } = {
    loaded: 1,
    dirty: 2,
    accounts: 3,
  },
): MetricsService {
  const world = { stats: worldStats } as unknown as WorldService;
  const contexts = { stats: ctxStats } as unknown as PlayerContextService;
  return new MetricsService(world, contexts, () => FIXED_NOW);
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
});
