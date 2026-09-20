/**
 * 混沌仪纯状态机单测（W6）—— 穷举 `clear` × `death` × `normal` × `continue` 与 3 连败跳过。
 */
import { describe, expect, it } from 'vitest';
import { CHAOS_MAX_RETRY, CHAOS_MAX_SEQUENCE } from '@idle-dark/game-core';
import {
  countsOf,
  firstChaosStep,
  isChaosSequenceValid,
  isChaosUnlocked,
  nextChaosStep,
  normalizeChaosSequence,
  type ChaosRunState,
} from '../../../src/modules/logic/chaos/internal/chaos-ops.js';

const T1 = 'keystone.t01';
const T2 = 'keystone.t02';
const T3 = 'keystone.t03';

function state(partial: Partial<ChaosRunState> = {}): ChaosRunState {
  return { sequence: [T1], index: 0, retry: 0, failMode: 'normal', ...partial };
}

describe('chaos-ops · 序列校验', () => {
  it('空数组合法；≤16 合法；重复合法；非法 key / 非数组 / 超长 → false', () => {
    expect(isChaosSequenceValid([])).toBe(true);
    expect(isChaosSequenceValid([T1, T1, T2])).toBe(true);
    expect(isChaosSequenceValid(Array.from({ length: CHAOS_MAX_SEQUENCE }, () => T1))).toBe(true);
    expect(isChaosSequenceValid(Array.from({ length: CHAOS_MAX_SEQUENCE + 1 }, () => T1))).toBe(false);
    expect(isChaosSequenceValid(['keystone.t00'])).toBe(false);
    expect(isChaosSequenceValid(['keystone.t17'])).toBe(false);
    expect(isChaosSequenceValid([1, 2])).toBe(false);
    expect(isChaosSequenceValid('keystone.t01')).toBe(false);
    expect(isChaosSequenceValid(null)).toBe(false);
    expect(isChaosSequenceValid(undefined)).toBe(false);
  });

  it('normalize：丢弃非法项、截断到 16、非数组 → 空', () => {
    const long = ['bogus', ...Array.from({ length: 20 }, () => T3), 5];
    const out = normalizeChaosSequence(long);
    expect(out).toHaveLength(CHAOS_MAX_SEQUENCE);
    expect(out.every((key) => key === T3)).toBe(true);
    expect(normalizeChaosSequence('x')).toEqual([]);
    expect(normalizeChaosSequence(null)).toEqual([]);
  });
});

describe('chaos-ops · 解锁判据', () => {
  const required = ['world.1', 'world.2', 'world.3'];
  it('全部命中才解锁；空要求 fail-closed', () => {
    expect(isChaosUnlocked([], required)).toBe(false);
    expect(isChaosUnlocked(['world.1', 'world.2'], required)).toBe(false);
    expect(isChaosUnlocked(new Set(required), required)).toBe(true);
    expect(isChaosUnlocked(['world.1', 'world.2', 'world.3', 'extra'], required)).toBe(true);
    expect(isChaosUnlocked(required, [])).toBe(false);
  });
});

describe('chaos-ops · firstChaosStep', () => {
  it('空序列 → stop(sequence-exhausted)', () => {
    expect(firstChaosStep(state({ sequence: [] }), {})).toEqual({
      action: 'stop',
      reason: 'sequence-exhausted',
    });
  });

  it('有序列但全部缺钥石 → stop(keystone-missing)', () => {
    expect(firstChaosStep(state({ sequence: [T1, T2] }), {})).toEqual({
      action: 'stop',
      reason: 'keystone-missing',
    });
  });

  it('跳过开头缺钥石的条目，进入第一把可用钥石（retry 归零）', () => {
    const step = firstChaosStep(state({ sequence: [T1, T2, T3] }), { [T2]: 2 });
    expect(step).toEqual({ action: 'enter', index: 1, retry: 0, tier: 2, keystone: T2 });
  });
});

describe('chaos-ops · nextChaosStep 转移矩阵', () => {
  it('clear × normal → 前进到下一把', () => {
    const step = nextChaosStep(state({ sequence: [T1, T2] }), 'clear', { [T2]: 1 });
    expect(step).toEqual({ action: 'enter', index: 1, retry: 0, tier: 2, keystone: T2 });
  });

  it('clear × 已是最后一把 → stop(sequence-exhausted)', () => {
    expect(nextChaosStep(state(), 'clear', { [T1]: 9 })).toEqual({
      action: 'stop',
      reason: 'sequence-exhausted',
    });
  });

  it('clear 但下一把钥石缺失 → stop(keystone-missing)（不跳读后续）', () => {
    expect(nextChaosStep(state({ sequence: [T1, T2, T3] }), 'clear', { [T1]: 9 })).toEqual({
      action: 'stop',
      reason: 'keystone-missing',
    });
  });

  it('death × normal → stop(aborted)，无论是否仍持有钥石', () => {
    expect(nextChaosStep(state({ failMode: 'normal' }), 'death', { [T1]: 9 })).toEqual({
      action: 'stop',
      reason: 'aborted',
    });
  });

  it('death × continue：连败 1/2 次重试当前把，第 3 次跳下一把', () => {
    const seq = [T1, T2];
    const counts = { [T1]: 9, [T2]: 9 };
    expect(nextChaosStep(state({ sequence: seq, retry: 0, failMode: 'continue' }), 'death', counts)).toEqual({
      action: 'enter',
      index: 0,
      retry: 1,
      tier: 1,
      keystone: T1,
    });
    expect(nextChaosStep(state({ sequence: seq, retry: 1, failMode: 'continue' }), 'death', counts)).toEqual({
      action: 'enter',
      index: 0,
      retry: 2,
      tier: 1,
      keystone: T1,
    });
    // retry=2 → +1 = 3 = CHAOS_MAX_RETRY → 跳到下一把（retry 归零）
    expect(nextChaosStep(state({ sequence: seq, retry: 2, failMode: 'continue' }), 'death', counts)).toEqual({
      action: 'enter',
      index: 1,
      retry: 0,
      tier: 2,
      keystone: T2,
    });
    expect(CHAOS_MAX_RETRY).toBe(3);
  });

  it('death × continue 但当前钥石已耗尽 → stop(keystone-missing)', () => {
    expect(nextChaosStep(state({ failMode: 'continue' }), 'death', {})).toEqual({
      action: 'stop',
      reason: 'keystone-missing',
    });
  });

  it('death × continue 跳下一把但下一把缺失 → stop(keystone-missing)', () => {
    expect(
      nextChaosStep(state({ sequence: [T1, T2], index: 0, retry: 2, failMode: 'continue' }), 'death', {
        [T1]: 9,
      }),
    ).toEqual({ action: 'stop', reason: 'keystone-missing' });
  });

  it('负数下标（脏存档）→ 前进后回到 0，仍然可用；超长下标 → stop', () => {
    expect(nextChaosStep(state({ index: 5 }), 'clear', { [T1]: 9 })).toEqual({
      action: 'stop',
      reason: 'sequence-exhausted',
    });
    // -1 + 1 = 0：防御式恢复到第一把，而不是越界崩溃
    expect(nextChaosStep(state({ index: -1 }), 'clear', { [T1]: 9 })).toEqual({
      action: 'enter',
      index: 0,
      retry: 0,
      tier: 1,
      keystone: T1,
    });
  });
});

describe('chaos-ops · countsOf', () => {
  it('读取背包各阶钥石数量（无 → 0）', () => {
    const player = {
      countGood: (key: string) => (key === T1 ? 3 : 0),
    } as never;
    const counts = countsOf(player);
    expect(counts[T1]).toBe(3);
    expect(counts[T2]).toBe(0);
    expect(Object.keys(counts)).toHaveLength(16);
  });
});
