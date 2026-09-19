/**
 * 秘境规则内核单测（09 §5.3/§5.4）
 *
 * 边界全覆盖：undefined / null / NaN / Infinity / 负数 / 0 / 恰好等于周期边界 / 状态写坏防护。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DUNGEON_PERIOD_MS,
  DUNGEON_RESET_DISABLED,
  consumeDungeonStack,
  decideChallengeEntry,
  dungeonPeriodBoundary,
  dungeonPeriodMs,
  maxStacksOf,
  normalizeCooldownState,
  planChallengeAdvance,
  planDungeonCooldown,
  planDungeonPaidReset,
  ticketKeyOf,
} from './dungeon.js';

describe('ticketKeyOf', () => {
  it('无尽副本 → nightmare.<level>（非法 level 回落 1）', () => {
    expect(ticketKeyOf('nightmare.slime', { isEndless: true, group: 'nightmare.1' }, 3)).toBe('nightmare.3');
    expect(ticketKeyOf('nightmare.slime', { isEndless: true }, 0)).toBe('nightmare.1');
    expect(ticketKeyOf('nightmare.slime', { isEndless: true }, Number.NaN)).toBe('nightmare.1');
    expect(ticketKeyOf('nightmare.slime', {}, 2)).toBe('nightmare.2');
  });

  it('普通秘境 → group ?? mapKey；空 group 回落 mapKey', () => {
    expect(ticketKeyOf('town.cave2', { group: 'caveGroup' }, 0)).toBe('caveGroup');
    expect(ticketKeyOf('town.cave2', { group: '' }, 0)).toBe('town.cave2');
    expect(ticketKeyOf('town.cave2', undefined, 0)).toBe('town.cave2');
  });
});

describe('周期与层数配置', () => {
  it('coolDown 非法 → 默认 24h', () => {
    expect(dungeonPeriodMs(undefined)).toBe(DEFAULT_DUNGEON_PERIOD_MS);
    expect(dungeonPeriodMs({ coolDown: 0 })).toBe(DEFAULT_DUNGEON_PERIOD_MS);
    expect(dungeonPeriodMs({ coolDown: -5 })).toBe(DEFAULT_DUNGEON_PERIOD_MS);
    expect(dungeonPeriodMs({ coolDown: Number.NaN })).toBe(DEFAULT_DUNGEON_PERIOD_MS);
    expect(dungeonPeriodMs({ coolDown: 60_000 })).toBe(60_000);
  });

  it('maxStacksOf：缺失 / 0 / 负数 → 至少 1', () => {
    expect(maxStacksOf(undefined)).toBe(1);
    expect(maxStacksOf({ defaultTicketCount: 3 })).toBe(3);
    expect(maxStacksOf({ maxCoolDownStack: 5, defaultTicketCount: 2 })).toBe(5);
    expect(maxStacksOf({ maxCoolDownStack: 0, defaultTicketCount: 2 })).toBe(2);
    expect(maxStacksOf({ maxCoolDownStack: -1, defaultTicketCount: Number.NaN })).toBe(1);
  });

  it('normalizeCooldownState：NaN / 负数 / 超上限 → 夹取，绝不 NaN', () => {
    const config = { maxCoolDownStack: 2 };
    expect(normalizeCooldownState({ stacks: Number.NaN }, config).stacks).toBe(0);
    expect(normalizeCooldownState({ stacks: -3 }, config).stacks).toBe(0);
    expect(normalizeCooldownState({ stacks: 99 }, config).stacks).toBe(2);
    expect(normalizeCooldownState(null, config)).toEqual({ stacks: 0, lastResetAt: 0, lastUsedAt: 0 });
    for (const value of Object.values(normalizeCooldownState({ stacks: Number.POSITIVE_INFINITY }, config))) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('dungeonPeriodBoundary', () => {
  it('取 <= now 的最近边界', () => {
    expect(dungeonPeriodBoundary(2_500, 1_000, 0, 0)).toBe(2_000);
    expect(dungeonPeriodBoundary(2_000, 1_000, 0, 0)).toBe(2_000);
    expect(dungeonPeriodBoundary(1_999, 1_000, 0, 0)).toBe(1_000);
  });

  it('偏移与时区改变边界相位；负时间戳不崩', () => {
    expect(dungeonPeriodBoundary(2_500, 1_000, 500, 0)).toBe(2_500);
    expect(dungeonPeriodBoundary(2_500, 1_000, 0, 8 * 3600_000)).toBe(2_000);
    expect(Number.isFinite(dungeonPeriodBoundary(-1_500, 1_000, 0, 0))).toBe(true);
  });
});

describe('planDungeonCooldown', () => {
  const config = { coolDown: 1_000, maxCoolDownStack: 2, resetPrice: 30 };

  it('首次（lastResetAt=0）→ 回满且可用', () => {
    const plan = planDungeonCooldown({ stacks: 0, lastResetAt: 0 }, config, 2_500, 0);
    expect(plan.state.stacks).toBe(2);
    expect(plan.available).toBe(true);
    expect(plan.reason).toBe('ok');
    expect(plan.nextResetAt).toBe(3_000);
  });

  it('同周期内不重复回满（幂等）；耗尽 → cooldown', () => {
    const first = planDungeonCooldown({ stacks: 0, lastResetAt: 0 }, config, 2_500, 0);
    const second = planDungeonCooldown(first.state, config, 2_600, 0);
    expect(second.state).toEqual(first.state);
    const spent = consumeDungeonStack(consumeDungeonStack(second.state));
    expect(spent.stacks).toBe(0);
    const third = planDungeonCooldown(spent, config, 2_700, 0);
    expect(third.available).toBe(false);
    expect(third.reason).toBe('cooldown');
  });

  it('跨过周期边界 → 回满', () => {
    const spent = consumeDungeonStack(
      planDungeonCooldown({ stacks: 0, lastResetAt: 0 }, config, 2_500, 0).state,
    );
    const refilled = planDungeonCooldown(spent, config, 3_100, 0);
    expect(refilled.state.stacks).toBe(2);
    expect(refilled.available).toBe(true);
  });

  it('恰好落在边界上视为已回满（不重复重置）', () => {
    const at = planDungeonCooldown({ stacks: 1, lastResetAt: 2_000 }, config, 2_000, 0);
    expect(at.state.stacks).toBe(1);
    const before = planDungeonCooldown({ stacks: 1, lastResetAt: 1_999 }, config, 2_000, 0);
    expect(before.state.stacks).toBe(2);
  });
});

describe('consumeDungeonStack', () => {
  it('递减到 0 为止，不产生负数；非法 count 按 1 计', () => {
    const state = { stacks: 2, lastResetAt: 0, lastUsedAt: 0 };
    expect(consumeDungeonStack(state).stacks).toBe(1);
    expect(consumeDungeonStack(consumeDungeonStack(state)).stacks).toBe(0);
    expect(consumeDungeonStack(consumeDungeonStack(consumeDungeonStack(state))).stacks).toBe(0);
    expect(consumeDungeonStack({ ...state, stacks: 0 }).stacks).toBe(0);
    expect(consumeDungeonStack(state, Number.NaN).stacks).toBe(1);
    expect(consumeDungeonStack(state, -5).stacks).toBe(1);
  });
});

describe('planDungeonPaidReset', () => {
  it('-1 / 缺失 / NaN / 负价 → 不可重置', () => {
    expect(planDungeonPaidReset({ resetPrice: DUNGEON_RESET_DISABLED }, 9999)).toEqual({
      allowed: false,
      cost: 0,
      reason: 'not_resettable',
    });
    expect(planDungeonPaidReset({}, 9999).allowed).toBe(false);
    expect(planDungeonPaidReset({ resetPrice: Number.NaN }, 9999).allowed).toBe(false);
    expect(planDungeonPaidReset({ resetPrice: -5 }, 9999).allowed).toBe(false);
  });

  it('0 价合法；不足 / 恰好够', () => {
    expect(planDungeonPaidReset({ resetPrice: 0 }, 0)).toEqual({ allowed: true, cost: 0, reason: 'ok' });
    expect(planDungeonPaidReset({ resetPrice: 30 }, 29)).toEqual({
      allowed: false,
      cost: 30,
      reason: 'not_enough_diamonds',
    });
    expect(planDungeonPaidReset({ resetPrice: 30 }, 30).allowed).toBe(true);
    expect(planDungeonPaidReset({ resetPrice: 30 }, Number.NaN).allowed).toBe(false);
  });
});

describe('planChallengeAdvance（挑战队列推进）', () => {
  it('空队列 → 立即耗尽', () => {
    expect(planChallengeAdvance(0, 0, true)).toEqual({ nextIndex: 0, queueExhausted: true });
    expect(planChallengeAdvance(0, -1, false)).toEqual({ nextIndex: 0, queueExhausted: true });
  });

  it('未结束 → 下标不变；结束 → 推进；最后一条结束 → 耗尽', () => {
    expect(planChallengeAdvance(0, 3, false)).toEqual({ nextIndex: 0, queueExhausted: false });
    expect(planChallengeAdvance(0, 3, true)).toEqual({ nextIndex: 1, queueExhausted: false });
    expect(planChallengeAdvance(2, 3, true)).toEqual({ nextIndex: 3, queueExhausted: true });
  });

  it('下标越界 / NaN → 夹取到合法范围', () => {
    expect(planChallengeAdvance(99, 3, true)).toEqual({ nextIndex: 3, queueExhausted: true });
    expect(planChallengeAdvance(-5, 3, false)).toEqual({ nextIndex: 0, queueExhausted: false });
    expect(planChallengeAdvance(Number.NaN, 3, true)).toEqual({ nextIndex: 1, queueExhausted: false });
  });
});

describe('decideChallengeEntry（RD5：无票/冷却未就绪 → 跳过并继续）', () => {
  it('有票且冷却就绪 → enter', () => {
    expect(decideChallengeEntry(1, true)).toBe('enter');
    expect(decideChallengeEntry(99, true)).toBe('enter');
  });

  it('无票 / 负数 / NaN / 冷却未就绪 → skip', () => {
    expect(decideChallengeEntry(0, true)).toBe('skip');
    expect(decideChallengeEntry(-1, true)).toBe('skip');
    expect(decideChallengeEntry(Number.NaN, true)).toBe('skip');
    expect(decideChallengeEntry(5, false)).toBe('skip');
  });
});
