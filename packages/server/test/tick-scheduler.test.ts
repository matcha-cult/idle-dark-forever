/**
 * 预算驱动 tick 调度纯函数单测（07 T-A2）
 *
 * 边界全覆盖：空集合 / cursor 越界·负数·NaN / 时钟回拨 / carry NaN·负数 /
 * 硬上限非法回落 / warn 阈值恰好相等 / 预算 0·负数·NaN 回落（不整轮 0 处理）。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEBT_SHED_MS,
  DEFAULT_GLOBAL_CALLBACK_BUDGET,
  DEFAULT_MAX_ROUND_CPU_MS,
  nextCursor,
  planAdvance,
  planRound,
  shouldStopRound,
} from '../src/modules/logic/world/internal/tick-scheduler.js';

describe('planRound', () => {
  it('空集合 → 空顺序、游标 0', () => {
    expect(planRound([], 3)).toEqual({ order: [], startCursor: 0 });
  });

  it('从游标处绕一圈（顺序长度 = 集合大小，不截断）', () => {
    expect(planRound(['a', 'b', 'c'], 0).order).toEqual(['a', 'b', 'c']);
    expect(planRound(['a', 'b', 'c'], 1).order).toEqual(['b', 'c', 'a']);
    expect(planRound(['a', 'b', 'c'], 2).order).toEqual(['c', 'a', 'b']);
  });

  it('cursor 越界 → 环绕；负数 → 反向环绕；NaN / Infinity → 归一化到 0', () => {
    expect(planRound(['a', 'b'], 99).startCursor).toBe(1); // 99 mod 2
    expect(planRound(['a', 'b'], -1).startCursor).toBe(1); // -1 mod 2 = 1（负向回绕）
    expect(planRound(['a', 'b'], Number.NaN).startCursor).toBe(0);
    expect(planRound(['a', 'b'], Number.POSITIVE_INFINITY).startCursor).toBe(0);
  });
});

describe('nextCursor', () => {
  it('环绕与边界', () => {
    expect(nextCursor(0, 3, 3)).toBe(0);
    expect(nextCursor(1, 1, 3)).toBe(2);
    expect(nextCursor(2, 2, 3)).toBe(1);
    expect(nextCursor(0, 0, 0)).toBe(0);
    expect(nextCursor(0, 5, -1)).toBe(0);
    expect(nextCursor(0, Number.NaN, 3)).toBe(0);
  });
});

describe('planAdvance', () => {
  const base = { debtWarnMs: 2_000, debtShedMs: 5_000 };

  it('正常：elapsed + carry，全量推进、不截断、不告警', () => {
    const plan = planAdvance({ ...base, now: 1_200, lastTickAt: 1_000, carryMs: 100 });
    expect(plan.elapsedMs).toBe(200);
    expect(plan.requestedMs).toBe(300);
    expect(plan.advanceMs).toBe(300);
    expect(plan.shedMs).toBe(0);
    expect(plan.warn).toBe(false);
  });

  it('时钟回拨（now < lastTickAt）→ elapsed 0（不产生负数）', () => {
    const plan = planAdvance({ ...base, now: 900, lastTickAt: 1_000, carryMs: 0 });
    expect(plan.elapsedMs).toBe(0);
    expect(plan.advanceMs).toBe(0);
    expect(plan.shedMs).toBe(0);
  });

  it('NaN / Infinity 时间输入 → 不产生 NaN', () => {
    const a = planAdvance({ ...base, now: Number.NaN, lastTickAt: 1_000, carryMs: 0 });
    expect(Number.isNaN(a.advanceMs)).toBe(false);
    expect(a.elapsedMs).toBe(0);
    const b = planAdvance({ ...base, now: 1_000, lastTickAt: Number.NaN, carryMs: 0 });
    expect(b.elapsedMs).toBe(0);
    const c = planAdvance({ ...base, now: Number.POSITIVE_INFINITY, lastTickAt: 0, carryMs: 0 });
    // Infinity 被视为非法 → now 回落 0 → elapsed 0
    expect(Number.isFinite(c.advanceMs)).toBe(true);
  });

  it('carry 为 NaN / 负数 → 按 0 计', () => {
    expect(planAdvance({ ...base, now: 1_100, lastTickAt: 1_000, carryMs: Number.NaN }).requestedMs).toBe(100);
    expect(planAdvance({ ...base, now: 1_100, lastTickAt: 1_000, carryMs: -50 }).requestedMs).toBe(100);
  });

  it('超过硬上限 → 显式截断（shedMs 精确、advanceMs = 上限）', () => {
    const plan = planAdvance({ ...base, now: 100_000, lastTickAt: 0, carryMs: 0 });
    expect(plan.requestedMs).toBe(100_000);
    expect(plan.advanceMs).toBe(5_000);
    expect(plan.shedMs).toBe(95_000);
    expect(plan.warn).toBe(true);
  });

  it('硬上限非法（0 / 负数 / NaN）→ 回落缺省，绝不静默丢弃', () => {
    for (const debtShedMs of [0, -1, Number.NaN]) {
      const plan = planAdvance({ now: 100_000, lastTickAt: 0, carryMs: 0, debtWarnMs: 0, debtShedMs });
      expect(plan.advanceMs).toBe(DEFAULT_DEBT_SHED_MS);
      expect(plan.shedMs).toBe(100_000 - DEFAULT_DEBT_SHED_MS);
    }
  });

  it('warn 阈值恰好相等 → 不告警（严格大于）', () => {
    const plan = planAdvance({ now: 2_000, lastTickAt: 0, carryMs: 0, debtWarnMs: 2_000, debtShedMs: 5_000 });
    expect(plan.requestedMs).toBe(2_000);
    expect(plan.warn).toBe(false);
    const over = planAdvance({ now: 2_001, lastTickAt: 0, carryMs: 0, debtWarnMs: 2_000, debtShedMs: 5_000 });
    expect(over.warn).toBe(true);
  });
});

describe('shouldStopRound', () => {
  it('未达任何预算 → 继续', () => {
    expect(
      shouldStopRound({ callbacksUsed: 10, callbackBudget: 100, elapsedCpuMs: 1, cpuBudgetMs: 40 }),
    ).toBe(false);
  });

  it('回调预算或 CPU 预算任一打满 → 停（含恰好等于）', () => {
    expect(
      shouldStopRound({ callbacksUsed: 100, callbackBudget: 100, elapsedCpuMs: 0, cpuBudgetMs: 40 }),
    ).toBe(true);
    expect(
      shouldStopRound({ callbacksUsed: 0, callbackBudget: 100, elapsedCpuMs: 40, cpuBudgetMs: 40 }),
    ).toBe(true);
  });

  it('预算 0 / 负数 / NaN → 回落缺省，绝不整轮 0 处理', () => {
    for (const bad of [0, -5, Number.NaN]) {
      expect(
        shouldStopRound({ callbacksUsed: 0, callbackBudget: bad, elapsedCpuMs: 0, cpuBudgetMs: bad }),
      ).toBe(false);
      expect(DEFAULT_GLOBAL_CALLBACK_BUDGET).toBeGreaterThan(0);
      expect(DEFAULT_MAX_ROUND_CPU_MS).toBeGreaterThan(0);
    }
  });

  it('callbacksUsed / elapsedCpuMs 非法 → 按 0 计（不误停）', () => {
    expect(
      shouldStopRound({
        callbacksUsed: Number.NaN,
        callbackBudget: 100,
        elapsedCpuMs: Number.POSITIVE_INFINITY,
        cpuBudgetMs: 40,
      }),
    ).toBe(false); // Infinity 视为非法 → 回落 0，不因脏输入误停
    expect(
      shouldStopRound({
        callbacksUsed: Number.NaN,
        callbackBudget: 100,
        elapsedCpuMs: 0,
        cpuBudgetMs: 40,
      }),
    ).toBe(false);
  });
});
