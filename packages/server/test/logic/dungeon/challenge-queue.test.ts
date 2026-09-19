/**
 * 挑战队列规范化单测（RC4；DB 读与客户端写共用同一份校验）
 *
 * 边界：非数组 / null / 未知地图 / 非法 key / NaN·Infinity·负数 endlessLevel / 超长截断 / 越界删除。
 */
import { describe, expect, it } from 'vitest';
import { createDefaultTables } from '@idle-dark/game-core';
import {
  MAX_CHALLENGE_QUEUE,
  normalizeChallengeEntry,
  normalizeChallengeQueue,
  removeChallengeEntryAt,
} from '../../../src/modules/logic/shared/challenge-queue.js';

const tables = createDefaultTables();

describe('normalizeChallengeEntry', () => {
  it('合法条目：endlessLevel 缺失/非法 → 0，负数 → 0', () => {
    expect(normalizeChallengeEntry({ key: 'home' }, tables)).toEqual({ key: 'home', endlessLevel: 0 });
    expect(normalizeChallengeEntry({ key: 'home', endlessLevel: 3 }, tables)).toEqual({
      key: 'home',
      endlessLevel: 3,
    });
    expect(normalizeChallengeEntry({ key: 'home', endlessLevel: Number.NaN }, tables).endlessLevel).toBe(0);
    expect(normalizeChallengeEntry({ key: 'home', endlessLevel: Number.POSITIVE_INFINITY }, tables).endlessLevel).toBe(0);
    expect(normalizeChallengeEntry({ key: 'home', endlessLevel: -5 }, tables).endlessLevel).toBe(0);
    expect(normalizeChallengeEntry({ key: 'home', endlessLevel: 2.9 }, tables).endlessLevel).toBe(2);
  });

  it('非法条目 → null（未知地图 / 空 key / 非对象 / 数组）', () => {
    expect(normalizeChallengeEntry({ key: 'no.such.map' }, tables)).toBeNull();
    expect(normalizeChallengeEntry({ key: '' }, tables)).toBeNull();
    expect(normalizeChallengeEntry({}, tables)).toBeNull();
    expect(normalizeChallengeEntry(null, tables)).toBeNull();
    expect(normalizeChallengeEntry('home', tables)).toBeNull();
    expect(normalizeChallengeEntry([{ key: 'home' }], tables)).toBeNull();
  });
});

describe('normalizeChallengeQueue', () => {
  it('非数组 → 空队列（空数组才是合法落库状态）', () => {
    expect(normalizeChallengeQueue(null, tables)).toEqual([]);
    expect(normalizeChallengeQueue('x', tables)).toEqual([]);
    expect(normalizeChallengeQueue({ entries: [] }, tables)).toEqual([]);
  });

  it('逐条校验：坏的丢弃、好的保留、顺序不变', () => {
    const out = normalizeChallengeQueue(
      [{ key: 'home' }, { key: 'nope' }, { key: 'town.street', endlessLevel: 1 }, null, 42],
      tables,
    );
    expect(out).toEqual([
      { key: 'home', endlessLevel: 0 },
      { key: 'town.street', endlessLevel: 1 },
    ]);
  });

  it('长度上限截断（含非法 maxLen 回落常量）', () => {
    const many = Array.from({ length: 100 }, () => ({ key: 'home' }));
    expect(normalizeChallengeQueue(many, tables).length).toBe(MAX_CHALLENGE_QUEUE);
    expect(normalizeChallengeQueue(many, tables, 3).length).toBe(3);
    expect(normalizeChallengeQueue(many, tables, 0).length).toBe(MAX_CHALLENGE_QUEUE);
    expect(normalizeChallengeQueue(many, tables, Number.NaN).length).toBe(MAX_CHALLENGE_QUEUE);
  });
});

describe('removeChallengeEntryAt', () => {
  const entries = [
    { key: 'home', endlessLevel: 0 },
    { key: 'town.valley', endlessLevel: 0 },
  ];

  it('按下标删除；越界 / 非法下标返回原样副本', () => {
    expect(removeChallengeEntryAt(entries, 0)).toEqual([{ key: 'town.valley', endlessLevel: 0 }]);
    expect(removeChallengeEntryAt(entries, 5)).toEqual(entries);
    expect(removeChallengeEntryAt(entries, -1)).toEqual(entries);
    expect(removeChallengeEntryAt(entries, Number.NaN)).toEqual(entries);
  });

  it('返回的是新数组（不共享引用）', () => {
    const out = removeChallengeEntryAt(entries, 0);
    expect(out).not.toBe(entries);
    out.push({ key: 'home', endlessLevel: 0 });
    expect(entries).toHaveLength(2);
  });
});
