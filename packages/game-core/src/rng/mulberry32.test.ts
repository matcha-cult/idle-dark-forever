import { describe, expect, it } from 'vitest';

import { Mulberry32Rng, hashLabel, mixSeed } from './mulberry32.js';

/** 取前 n 个值，便于断言序列。 */
function take(rng: Mulberry32Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(rng.next());
  }
  return out;
}

describe('Mulberry32Rng', () => {
  it('同种子产生完全相同的序列', () => {
    const a = take(new Mulberry32Rng(12345), 32);
    const b = take(new Mulberry32Rng(12345), 32);
    expect(a).toEqual(b);
  });

  it('不同种子产生不同序列', () => {
    const a = take(new Mulberry32Rng(1), 16);
    const b = take(new Mulberry32Rng(2), 16);
    expect(a).not.toEqual(b);
  });

  it('数值落在 [0, 1) 且不是常数', () => {
    const rng = new Mulberry32Rng(0);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seen.add(v);
    }
    expect(seen.size).toBe(1000);
  });

  it('种子 0 / 负数 / NaN 都被规整为确定状态', () => {
    expect(new Mulberry32Rng(0).getSeed()).toBe(0);
    expect(new Mulberry32Rng(-1).getSeed()).toBe(0xffffffff);
    expect(new Mulberry32Rng(Number.NaN).getSeed()).toBe(0);
    // NaN 与 0 等价（都可重放，不退化为随机）
    expect(take(new Mulberry32Rng(Number.NaN), 4)).toEqual(take(new Mulberry32Rng(0), 4));
  });

  it('range 落在 [min, max)', () => {
    const rng = new Mulberry32Rng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng.range(-3, 9);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(9);
    }
  });

  it('int(n) 落在 [0, n) 且能覆盖全部取值', () => {
    const rng = new Mulberry32Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('int(n<=0) 与无效入参返回 0，不产生 NaN', () => {
    const rng = new Mulberry32Rng(1);
    expect(rng.int(0)).toBe(0);
    expect(rng.int(-5)).toBe(0);
    expect(rng.int(Number.NaN)).toBe(0);
  });

  it('getSeed 反映状态推进', () => {
    const rng = new Mulberry32Rng(42);
    const before = rng.getSeed();
    rng.next();
    expect(rng.getSeed()).not.toBe(before);
  });
});

describe('Mulberry32Rng.fork', () => {
  it('同 (种子, 标签) 派生同序列', () => {
    const a = take(new Mulberry32Rng(2024).fork('loot') as Mulberry32Rng, 16);
    const b = take(new Mulberry32Rng(2024).fork('loot') as Mulberry32Rng, 16);
    expect(a).toEqual(b);
  });

  it('不同标签派生不同序列', () => {
    const a = take(new Mulberry32Rng(2024).fork('loot') as Mulberry32Rng, 16);
    const b = take(new Mulberry32Rng(2024).fork('affix') as Mulberry32Rng, 16);
    expect(a).not.toEqual(b);
  });

  it('fork 不推进父状态（可重复派生同一子序列）', () => {
    const parent = new Mulberry32Rng(5);
    const seedBefore = parent.getSeed();
    const child1 = parent.fork('x');
    const seedAfter = parent.getSeed();
    const child2 = parent.fork('x');
    expect(seedAfter).toBe(seedBefore);
    expect(take(child1 as Mulberry32Rng, 8)).toEqual(take(child2 as Mulberry32Rng, 8));
    // 父序列本身不受 fork 影响
    const p1 = take(new Mulberry32Rng(5), 8);
    const p2 = take(parent, 8);
    expect(p2).toEqual(p1);
  });

  it('标签哈希稳定且 32 位无符号', () => {
    expect(hashLabel('loot')).toBe(hashLabel('loot'));
    expect(hashLabel('loot')).not.toBe(hashLabel('loots'));
    expect(hashLabel('')).toBe(0x811c9dc5);
    expect(hashLabel('中文标签 ⚔')).toBeGreaterThanOrEqual(0);
    expect(hashLabel('中文标签 ⚔')).toBeLessThanOrEqual(0xffffffff);
  });

  it('mixSeed 输出 32 位无符号且对输入敏感', () => {
    expect(mixSeed(0, 0)).toBeGreaterThanOrEqual(0);
    expect(mixSeed(0, 0)).toBeLessThanOrEqual(0xffffffff);
    expect(mixSeed(0, 1)).not.toBe(mixSeed(0, 2));
    expect(mixSeed(1, 1)).not.toBe(mixSeed(2, 1));
  });
});
