/**
 * 混沌钥石（W5）阶位 / 掉落掷骰 / 白图数据边界单测。
 *
 * 覆盖门禁 §5.2：`0 / 84 / 85 / 86 / 100 / 101 / 999 / NaN / Infinity / 负数`。
 * 关键约定：85+ 才掉；怪最多掉「自身阶 + 1」；固定种子可重放；非法输入 fail-closed = `null`。
 */
import { describe, expect, it } from 'vitest';

import { createDefaultTables } from '../data/index.js';
import { SeededRngFactory } from '../rng/index.js';
import { InventorySlot } from './inventory-slot.js';
import { Player } from './player.js';
import {
  KEYSTONE_CAP_BIAS,
  KEYSTONE_TIER_OFFSET,
  MAX_KEYSTONE_TIER,
  MIN_KEYSTONE_LEVEL,
  keystoneKeyOfTier,
  keystoneTierOfKey,
  keystoneTierOfLevel,
  maxKeystoneDropTier,
  pickKeystoneTier,
} from './keystone.js';

const factory = new SeededRngFactory();

describe('keystoneTierOfLevel：等级 → 阶（85 → T1 … 100 → T16）', () => {
  it('边界：0 / 84 → null；85 → 1；86 → 2；100 → 16；101 / 999 → 16', () => {
    expect(keystoneTierOfLevel(0)).toBeNull();
    expect(keystoneTierOfLevel(84)).toBeNull();
    expect(keystoneTierOfLevel(85)).toBe(1);
    expect(keystoneTierOfLevel(86)).toBe(2);
    expect(keystoneTierOfLevel(100)).toBe(16);
    expect(keystoneTierOfLevel(101)).toBe(16);
    expect(keystoneTierOfLevel(999)).toBe(16);
  });

  it('非法输入：NaN / ±Infinity / 负数 / -0 → null', () => {
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      -84,
      Number.MIN_SAFE_INTEGER,
    ]) {
      expect(keystoneTierOfLevel(bad), String(bad)).toBeNull();
    }
  });

  it('小数向下取整：84.9 → null；85.9 → 1；100.9 → 16', () => {
    expect(keystoneTierOfLevel(84.9)).toBeNull();
    expect(keystoneTierOfLevel(85.9)).toBe(1);
    expect(keystoneTierOfLevel(100.9)).toBe(16);
  });

  it('偏移常量自洽：91 → 7（KEYSTONE_TIER_OFFSET / MIN_KEYSTONE_LEVEL 对照）', () => {
    expect(KEYSTONE_TIER_OFFSET).toBe(84);
    expect(MIN_KEYSTONE_LEVEL).toBe(85);
    expect(MAX_KEYSTONE_TIER).toBe(16);
    expect(keystoneTierOfLevel(KEYSTONE_TIER_OFFSET + 7)).toBe(7);
  });
});

describe('keystoneKeyOfTier / keystoneTierOfKey：key 解析与校验', () => {
  it('T1..T16 的 key 往返一致，且两位补零', () => {
    expect(keystoneKeyOfTier(1)).toBe('keystone.t01');
    expect(keystoneKeyOfTier(9)).toBe('keystone.t09');
    expect(keystoneKeyOfTier(10)).toBe('keystone.t10');
    expect(keystoneKeyOfTier(16)).toBe('keystone.t16');
    for (let tier = 1; tier <= MAX_KEYSTONE_TIER; tier += 1) {
      const key = keystoneKeyOfTier(tier);
      expect(key).not.toBeNull();
      expect(keystoneTierOfKey(key!)).toBe(tier);
    }
  });

  it('非法阶 / key fail-closed 为 null', () => {
    for (const bad of [0, -1, 17, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(keystoneKeyOfTier(bad), String(bad)).toBeNull();
    }
    for (const bad of [
      '',
      'keystone',
      'keystone.t',
      'keystone.t00',
      'keystone.t17',
      'keystone.t99',
      'keystone.t0001',
      'keystone.t1x',
      'keystone.t01 ',
      ' keystone.t01',
      'KEystone.t01',
      'currency.chaos',
    ]) {
      expect(keystoneTierOfKey(bad), bad).toBeNull();
    }
  });
});

describe('maxKeystoneDropTier：怪阶 → 最高掉阶（min(16, 怪阶 + 1)）', () => {
  it('怪阶 1..16：最高阶 = min(16, 怪阶 + 1)', () => {
    for (let tier = 1; tier <= MAX_KEYSTONE_TIER; tier += 1) {
      expect(maxKeystoneDropTier(tier)).toBe(Math.min(MAX_KEYSTONE_TIER, tier + 1));
    }
    expect(maxKeystoneDropTier(16)).toBe(16);
    expect(maxKeystoneDropTier(20)).toBe(16);
  });

  it('非法怪阶 → 0（无可用阶）', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(maxKeystoneDropTier(bad), String(bad)).toBe(0);
    }
  });
});

describe('pickKeystoneTier：掷阶（确定性 + 偏向阶上限 + fail-closed）', () => {
  it('怪阶 1..16：所有结果落在 1..min(16, 怪阶 + 1)', () => {
    const rng = factory.create(20240607);
    for (let tier = 1; tier <= MAX_KEYSTONE_TIER; tier += 1) {
      const cap = maxKeystoneDropTier(tier);
      for (let i = 0; i < 500; i += 1) {
        const got = pickKeystoneTier(tier, rng);
        expect(got, `tier=${tier} i=${i}`).not.toBeNull();
        expect(got!).toBeGreaterThanOrEqual(1);
        expect(got!).toBeLessThanOrEqual(cap);
        expect(got!).toBeLessThanOrEqual(MAX_KEYSTONE_TIER);
      }
    }
  });

  it('固定种子序列可复现（同种子 → 同序列，不同种子不同）', () => {
    const a = factory.create(7);
    const b = factory.create(7);
    const c = factory.create(8);
    const seqA: Array<number | null> = [];
    const seqB: Array<number | null> = [];
    const seqC: Array<number | null> = [];
    for (let i = 0; i < 64; i += 1) {
      seqA.push(pickKeystoneTier(16, a));
      seqB.push(pickKeystoneTier(16, b));
      seqC.push(pickKeystoneTier(16, c));
    }
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('分布偏向阶上限：cap > 1 时约 KEYSTONE_CAP_BIAS 直接落 cap，其余为低阶', () => {
    const rng = factory.create(99);
    const N = 20000;
    let capHits = 0;
    let lowerHits = 0;
    for (let i = 0; i < N; i += 1) {
      const got = pickKeystoneTier(16, rng);
      expect(got).not.toBeNull();
      if (got === 16) {
        capHits += 1;
      } else {
        lowerHits += 1;
        expect(got!).toBeGreaterThanOrEqual(1);
        expect(got!).toBeLessThanOrEqual(15);
      }
    }
    expect(lowerHits).toBeGreaterThan(0);
    expect(capHits / N).toBeGreaterThan(KEYSTONE_CAP_BIAS - 0.03);
    expect(capHits / N).toBeLessThan(KEYSTONE_CAP_BIAS + 0.03);
  });

  it('怪阶 1（cap = min(16, 2) = 2）：结果恒在 {1, 2}，且偏向 2', () => {
    const rng = factory.create(5);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const got = pickKeystoneTier(1, rng);
      expect(got === 1 || got === 2).toBe(true);
      seen.add(got!);
    }
    // 偏向阶上限 ⇒ 必须见过 cap=2，低阶也会偶尔出现。
    expect(seen.has(2)).toBe(true);
    expect(seen.has(1)).toBe(true);
  });

  it('非法怪阶 → null（非有限 / 非整数 / <= 0 / > 16），且不消耗随机数', () => {
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
      1.5,
      17,
      999,
    ]) {
      const rng = factory.create(3);
      const before = rng.getSeed();
      expect(pickKeystoneTier(bad, rng), String(bad)).toBeNull();
      expect(rng.getSeed(), `seed unchanged for ${bad}`).toBe(before);
    }
  });
});

describe('白图数据：16 种混沌钥石为背包物品、无词缀、可堆叠、稳定排序', () => {
  const tables = createDefaultTables();
  const keys = Object.keys(tables.goods).filter((key) => key.startsWith('keystone.'));

  it('恰好 16 种 keystone.t01..t16', () => {
    expect(keys).toHaveLength(16);
    for (let tier = 1; tier <= 16; tier += 1) {
      const key = `keystone.t${String(tier).padStart(2, '0')}`;
      expect(tables.goods[key], key).toBeDefined();
    }
  });

  it('全部是 material + stack，且**不是**钱包物品（wallet 缺省）、无任何词缀字段', () => {
    for (const key of keys) {
      const good = tables.goods[key]!;
      expect(good.type, key).toBe('material');
      expect(good.stack, key).toBe(9999);
      expect(good.wallet, key).toBeUndefined();
      // 白图守卫：不得挂词缀池 / 装备位 / 装备类别。
      expect(good.affixGroup, key).toBeUndefined();
      expect(good.position, key).toBeUndefined();
      expect(good.equipCategory, key).toBeUndefined();
      expect(good.class, key).toBeUndefined();
      expect(good.minLevel, key).toBeUndefined();
      expect(good.maxLevel, key).toBeUndefined();
      expect(good.name, key).toContain('混沌钥石');
      expect(good.description, key).toContain('本期无词缀白图');
      expect(good.price, key).toBeGreaterThan(0);
      // `LootEntry` 之类的掉落表字段也不应出现在物品本体上。
      expect((good as { loots?: unknown }).loots, key).toBeUndefined();
    }
  });

  it('goodOrder 稳定且 T1..T16 递增（同阶只按阶排序）', () => {
    const orders = keys
      .map((key) => ({ key, order: tables.goods[key]!.goodOrder ?? 0, tier: keystoneTierOfKey(key)! }))
      .sort((a, b) => a.order - b.order);
    expect(orders.map((item) => item.tier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    // 全部 goodOrder 互不相同，排序无歧义。
    expect(new Set(orders.map((item) => item.order)).size).toBe(16);
  });

  it('sortInventory：打乱放入后钥石成组且按 T1..T16 升序', () => {
    const player = new Player(tables, 'p1', () => 0);
    const tiers = [5, 1, 16, 3, 10, 2, 8, 4, 15, 6, 12, 7, 14, 9, 13, 11];
    for (let i = 0; i < tiers.length; i += 1) {
      player.inventory.push(new InventorySlot(tables, 'inventory'));
    }
    for (const tier of tiers) {
      const key = `keystone.t${String(tier).padStart(2, '0')}`;
      player.inventory[player.emptySlot(player.inventory)]!.fromJSON({ key, count: 1 });
    }
    player.sortInventory();
    const sorted = player.inventory
      .filter((slot) => (slot.key ?? '').startsWith('keystone.'))
      .map((slot) => keystoneTierOfKey(slot.key ?? '')!);
    expect(sorted).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
});
