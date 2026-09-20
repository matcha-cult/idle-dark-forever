import { describe, expect, it } from 'vitest';

import { makeRng, createTestTables } from './fixtures.test.js';
import {
  BASE_QUALITY_RATE,
  MATERIAL_KEY,
  generateEquip,
  getDecomposeMatrials,
  getGoodOrder,
  getMaterialLevel,
  isValidAffix,
  randomAffixValue,
  randomAffixes,
  randomEquip,
  specialLegendRate,
} from './goods.js';
import { AffixInfo } from './inventory-slot.js';

const tables = createTestTables();

describe('isValidAffix', () => {
  it('按等级区间、可用职业、可用部位过滤', () => {
    expect(isValidAffix(tables, 'stickSword', 'atk', 10)).toBe(true);
    expect(isValidAffix(tables, 'stickSword', 'str', 10)).toBe(true);
    // minLevel 5：低于 5 不合法
    expect(isValidAffix(tables, 'stickSword', 'str', 4)).toBe(false);
    // maxLevel 10：高于 10 不合法
    expect(isValidAffix(tables, 'stickSword', 'cap', 10)).toBe(true);
    expect(isValidAffix(tables, 'stickSword', 'cap', 11)).toBe(false);
    // validClasses ['sword']：杖不合法
    expect(isValidAffix(tables, 'stickWand', 'str', 10)).toBe(false);
    // validPositions ['gaiter']
    expect(isValidAffix(tables, 'boneShinGuard', 'gaiterOnly', 60)).toBe(true);
    expect(isValidAffix(tables, 'dress', 'gaiterOnly', 60)).toBe(false);
  });

  it('maxLevel/minLevel 为 0 时视为「无限制」（原版假值语义）', () => {
    const custom = createTestTables();
    custom.affixes.zeroBound = {
      key: 'zeroBound',
      display: () => '',
      weight: 1,
      minLevel: 0,
      maxLevel: 0,
      generate: () => 1,
    };
    expect(isValidAffix(custom, 'stickSword', 'zeroBound', 0)).toBe(true);
    expect(isValidAffix(custom, 'stickSword', 'zeroBound', 999)).toBe(true);
  });

  it('物品或词缀不存在时返回 false（原版会 TypeError）', () => {
    expect(isValidAffix(tables, 'no-such-good', 'atk', 1)).toBe(false);
    expect(isValidAffix(tables, 'stickSword', 'no-such-affix', 1)).toBe(false);
  });
});

describe('randomAffixValue', () => {
  it('同种子可重放，且保留 key 与 rebuilded', () => {
    const old = new AffixInfo(tables).fromJSON({ key: 'atk', value: 1, rebuilded: true });
    const a = randomAffixValue(tables, old, 10, makeRng(1));
    const b = randomAffixValue(tables, old, 10, makeRng(1));
    expect(a.toJSON()).toEqual(b.toJSON());
    expect(a.key).toBe('atk');
    expect(a.rebuilded).toBe(true);
    expect(a.value).toBeGreaterThanOrEqual(10);
  });

  it('词缀数据缺失时保留旧值（不抛错）', () => {
    const missing = new AffixInfo(tables).fromJSON({ key: 'no-such-affix', value: 7 });
    const result = randomAffixValue(tables, missing, 10, makeRng(1));
    expect(result.value).toBe(7);
    expect(result.key).toBe('no-such-affix');
  });
});

describe('randomAffixes', () => {
  const pool = ['atk', 'str', 'gaiterOnly', 'noWeight'];

  it('同种子抽到同一词缀，且黑名单被写入', () => {
    const blacklist: Record<string, boolean> = {};
    const affix = randomAffixes(tables, pool, 10, blacklist, makeRng(42));
    expect(affix.key).not.toBeNull();
    expect(blacklist[affix.key!]).toBe(true);

    const blacklist2: Record<string, boolean> = {};
    const affix2 = randomAffixes(tables, pool, 10, blacklist2, makeRng(42));
    expect(affix2.toJSON()).toEqual(affix.toJSON());
  });

  it('已进入黑名单的词缀不再被抽到（抽满整池）', () => {
    const blacklist: Record<string, boolean> = {};
    const picked = randomAffixes(tables, pool, 10, blacklist, makeRng(7));
    const seen = new Set<string>([picked.key!]);
    for (let i = 0; i < 3; i++) {
      const next = randomAffixes(tables, pool, 10, blacklist, makeRng(i + 1));
      expect(seen.has(next.key!)).toBe(false);
      seen.add(next.key!);
      blacklist[next.key!] = true;
    }
    // 4 个词缀全部被抽过一遍
    expect([...seen].sort()).toEqual([...pool].sort());
  });

  it('weight 为 0 时按 1 计权（原版 `|| 1`）', () => {
    // 池里只剩 weight=0 的词缀时仍能抽中
    const affix = randomAffixes(tables, ['noWeight'], 10, {}, makeRng(3));
    expect(affix.key).toBe('noWeight');
  });

  it('空池抛出具名错误（原版会 TypeError）', () => {
    expect(() => randomAffixes(tables, [], 10, {}, makeRng(1))).toThrow(/no affix selected/);
    expect(() => randomAffixes(tables, ['atk'], 10, { atk: true }, makeRng(1))).toThrow(
      /no affix selected/,
    );
  });

  it('总权重为 0（全负数）时抛错而不是死循环', () => {
    const custom = createTestTables();
    custom.affixes.negative = {
      key: 'negative',
      display: () => '',
      weight: -5,
      generate: () => 1,
    };
    expect(() => randomAffixes(custom, ['negative'], 1, {}, makeRng(1))).toThrow(/no affix selected/);
  });
});

describe('generateEquip', () => {
  it('普通装备词缀条数 = quality', () => {
    for (const quality of [0, 1, 2, 3]) {
      const item = generateEquip(tables, 'stickSword', 50, quality, null, makeRng(10));
      expect(item.quality).toBe(quality);
      expect(item.affixes).toHaveLength(quality);
      expect(item.key).toBe('stickSword');
      expect(item.count).toBe(1);
      expect(item.position).toBe('loot');
      expect(item.legendType).toBeNull();
      const keys = item.affixes.map((affix) => affix.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('传奇装备词缀条数 = quality - 1 普通 + 1 传奇，且传奇在最后', () => {
    const item = generateEquip(tables, 'stickSword', 50, 4, 'flame', makeRng(11));
    expect(item.affixes).toHaveLength(4);
    expect(item.legendType).toBe('flame');
    expect(item.affixes[3]!.key).toBe('flame');
    expect(item.affixes[3]!.isLegend).toBe(true);
    expect(item.originName).toBe('木剑');
  });

  it('只抽合法词缀（高等级时 str/cap 才可用）', () => {
    const low = generateEquip(tables, 'stickWand', 1, 3, null, makeRng(5));
    for (const affix of low.affixes) {
      expect(isValidAffix(tables, 'stickWand', affix.key!, 1)).toBe(true);
    }
  });

  it('同种子产出同一件装备', () => {
    const a = generateEquip(tables, 'dress', 30, 3, null, makeRng(99));
    const b = generateEquip(tables, 'dress', 30, 3, null, makeRng(99));
    expect(a.toJSON()).toEqual(b.toJSON());
  });

  it('词缀池为空时抛错（不会产出残缺装备）', () => {
    const custom = createTestTables();
    custom.affixes = {};
    expect(() => generateEquip(custom, 'stickSword', 10, 2, null, makeRng(1))).toThrow(
      /no affix selected/,
    );
  });

  it('quality 为负数时不产出词缀', () => {
    const item = generateEquip(tables, 'stickSword', 10, -1, null, makeRng(1));
    expect(item.affixes).toEqual([]);
  });
});

describe('randomEquip', () => {
  it('同种子产出同一件装备', () => {
    const a = randomEquip(tables, 30, 1, undefined, makeRng(2024));
    const b = randomEquip(tables, 30, 1, undefined, makeRng(2024));
    expect(a.toJSON()).toEqual(b.toJSON());
  });

  it('mfRate 极大时必出传奇品质（quality=2）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const item = randomEquip(tables, 50, 1e9, undefined, makeRng(seed));
      expect(item.quality).toBe(2);
    }
  });

  it('品质骰严格遵循 baseQualityRate 阈值（mfRate=1 时 dice = 首个随机数）', () => {
    expect(BASE_QUALITY_RATE).toEqual([1, 0.5, 0.005, 0]);
    for (let seed = 1; seed <= 50; seed++) {
      const dice = makeRng(seed).next();
      const expected = Math.max(0, BASE_QUALITY_RATE.findIndex((value) => value < dice) - 1);
      expect(randomEquip(tables, 50, 1, undefined, makeRng(seed)).quality).toBe(expected);
    }
  });

  it('mfRate 越大品质不降（dice 单调性）', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const low = randomEquip(tables, 50, 1, undefined, makeRng(seed)).quality;
      const high = randomEquip(tables, 50, 100, undefined, makeRng(seed)).quality;
      expect(high).toBeGreaterThanOrEqual(low);
    }
    expect(randomEquip(tables, 50, 1e9, undefined, makeRng(3)).quality).toBe(2);
  });

  it('position 过滤只产出该部位的装备', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const item = randomEquip(tables, 60, 1e6, 'plastron', makeRng(seed));
      expect(item.goodData?.position).toBe('plastron');
    }
  });

  it('传说品质下可能挂上传奇词缀（specialLegendRate = 1%）', () => {
    // 遍历固定种子，至少命中一次传奇
    let legends = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const item = randomEquip(tables, 50, 1e9, undefined, makeRng(seed));
      if (item.legendType) {
        legends += 1;
        expect(item.legendData?.special).toBeFalsy();
      }
    }
    expect(legends).toBeGreaterThan(0);
    expect(specialLegendRate(tables)).toBeCloseTo(0.01, 10);
  });

  it('没有可用基底时抛错（原版会 TypeError）', () => {
    expect(() => randomEquip(tables, 10, 1, 'nonexistent-position', makeRng(1))).toThrow(
      /no valid equip base/,
    );
  });

  it('mfRate 为 0/NaN 时不抛错（dice 为 Infinity/NaN）', () => {
    expect(() => randomEquip(tables, 10, 0, undefined, makeRng(1))).not.toThrow();
    expect(() => randomEquip(tables, 10, Number.NaN, undefined, makeRng(1))).not.toThrow();
  });
});

describe('getMaterialLevel', () => {
  it('分段边界', () => {
    expect(getMaterialLevel(0)).toBe(0);
    expect(getMaterialLevel(30)).toBe(0);
    expect(getMaterialLevel(31)).toBe(1);
    expect(getMaterialLevel(50)).toBe(1);
    expect(getMaterialLevel(51)).toBe(2);
    expect(getMaterialLevel(75)).toBe(2);
    expect(getMaterialLevel(76)).toBe(3);
    expect(getMaterialLevel(115)).toBe(3);
    expect(getMaterialLevel(116)).toBe(4);
    expect(getMaterialLevel(140)).toBe(4);
    expect(getMaterialLevel(141)).toBe(5);
    expect(getMaterialLevel(99999)).toBe(5);
    expect(getMaterialLevel(-5)).toBe(0);
  });
});

describe('getDecomposeMatrials', () => {
  it('quality 0 不给任何材料（原版 materialKey[0] 为空表）', () => {
    expect(getDecomposeMatrials({ level: 20, quality: 0 })).toEqual({});
  });

  it('quality 1 给尘；quality 2 追加碎片 + 神力', () => {
    expect(getDecomposeMatrials({ level: 20, quality: 1 })).toEqual({ dust1: 1 });
    expect(getDecomposeMatrials({ level: 20, quality: 2 })).toEqual({
      dust1: 1,
      piece1: 1,
      diamonds: 4, // ceil(3 + 0.2 * 2^0)
    });
  });

  it('quality 2（传奇档）追加神力，且按品质指数放大', () => {
    expect(getDecomposeMatrials({ level: 100, quality: 2 })).toEqual({
      dust4: 1,
      piece4: 1,
      diamonds: 4, // ceil(3 + 1 * 2^0)
    });
    // 防御性边界：越界 quality（老数据）仍不抛错，指数按 (quality - 2) 放大。
    expect(getDecomposeMatrials({ level: 100, quality: 4 })).toEqual({
      dust4: 1,
      piece4: 1,
      diamonds: 7, // ceil(3 + 1 * (1 << 2))
    });
  });

  it('高等级材料档位映射正确', () => {
    expect(getDecomposeMatrials({ level: 200, quality: 2 })).toEqual({
      dust6: 1,
      piece6: 1,
      diamonds: 5, // ceil(3 + 2 * 2^0)
    });
    expect(MATERIAL_KEY[1]).toHaveLength(6);
    expect(MATERIAL_KEY[2]).toHaveLength(6);
  });

  it('NaN / Infinity 等级不抛错', () => {
    expect(() => getDecomposeMatrials({ level: Number.NaN, quality: 3 })).not.toThrow();
    expect(() => getDecomposeMatrials({ level: Number.POSITIVE_INFINITY, quality: 3 })).not.toThrow();
  });
});

describe('getGoodOrder', () => {
  it('按 goods 表的键顺序编号，且同一张表结果被缓存', () => {
    const order = getGoodOrder(tables);
    const keys = Object.keys(tables.goods);
    keys.forEach((key, index) => expect(order[key]).toBe(index));
    expect(getGoodOrder(tables)).toBe(order);
  });

  it('不同表得到各自的序号', () => {
    const other = createTestTables();
    delete other.goods.stickSword;
    const order = getGoodOrder(other);
    const remaining = Object.keys(other.goods);
    expect(order.stickSword).toBeUndefined();
    expect(order[remaining[0]!]).toBe(0);
    expect(order[remaining[1]!]).toBe(1);
  });
});
