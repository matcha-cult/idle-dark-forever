import { describe, expect, it } from 'vitest';

import type { Rng } from '../contracts/ports.js';
import { SeededRngFactory } from './factory.js';

describe('SeededRngFactory', () => {
  it('create(seed) 可重放', () => {
    const f = new SeededRngFactory();
    const a: Rng = f.create(777);
    const b: Rng = f.create(777);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('nextSeed 返回 uint32', () => {
    const f = new SeededRngFactory();
    for (let i = 0; i < 200; i++) {
      const seed = f.nextSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('nextSeed 产生不同种子（真随机入口）', () => {
    const f = new SeededRngFactory();
    const seeds = new Set<number>();
    for (let i = 0; i < 100; i++) {
      seeds.add(f.nextSeed());
    }
    expect(seeds.size).toBeGreaterThan(90);
  });

  it('seedFromText 确定性', () => {
    const f = new SeededRngFactory();
    expect(f.seedFromText('player-1')).toBe(f.seedFromText('player-1'));
    expect(f.seedFromText('player-1')).not.toBe(f.seedFromText('player-2'));
  });
});
