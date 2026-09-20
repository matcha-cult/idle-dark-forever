/**
 * 掉落与词缀规则 —— 原版 `src/logics/goods.js`（175 行）的移植。
 *
 * ## 去随机的做法
 *
 * 原版内部共 5 处 `Math.random()`（`randomAffixes` 加权抽取、`randomEquip` 品质骰 / 传奇骰 /
 * 传奇挑选 / 基底挑选）。移植后**全部**改为从末尾传入 `rng: Rng`，**消费顺序与次数与原版一一对应**，
 * 这样同一个种子可以重放出同一件装备。
 *
 * ## 与原版的差异（详见交付报告）
 *
 * - `specialRate` 原版是 `__DEV__ ? 1 : 非特殊传奇数 / 100`（开发态 100% 传奇）；
 *   game-core 没有 `__DEV__`，**固定采用生产公式**。
 * - 原版在数据缺失 / 词缀池为空时会 TypeError；这里改为抛出具名错误，便于服务端定位数据问题。
 */

import type { AffixData, DataTables, GoodData, LegendData } from '../contracts/data.js';
import type { Rng } from '../contracts/ports.js';
import { AffixInfo, InventorySlot } from './inventory-slot.js';

/**
 * 品质骰阈值（从高到低）。
 *
 * P4：品质压成 3 档（0 普通 / 1 优秀 / 2 传奇），故阈值表压到 4 项。
 * 判定与长度绑定：`quality = max(0, findIndex(v => v < dice) - 1)`，长度 4 ⇒ 最大品质 2。
 * 取值沿用原档位边界：`dice ≥ 0.5` → 普通；`[0.005, 0.5)` → 优秀；
 * `dice < 0.005` → 传奇（≈ 原版「史诗 + 传说」合计 0.5% 的稀有度）。
 */
export const BASE_QUALITY_RATE: readonly number[] = [1, 0.5, 0.005, 0];

/** 原版 `materialKey`：下标 1 = 尘（dust），2 = 碎片（piece）。 */
export const MATERIAL_KEY: readonly (readonly string[])[] = [
  [],
  ['dust1', 'dust2', 'dust3', 'dust4', 'dust5', 'dust6'],
  ['piece1', 'piece2', 'piece3', 'piece4', 'piece5', 'piece6'],
];

/** 原版 `randomAffixValue(old, level)`：按当前等级重掷同一条词缀的数值。 */
export function randomAffixValue(
  tables: DataTables,
  old: AffixInfo,
  level: number,
  rng: Rng,
): AffixInfo {
  const data: AffixData | LegendData | undefined = old.affixData;
  // 原版在 `affixData` 缺失时 TypeError；这里保留旧数值，避免导入损坏存档时崩服务
  const value = data ? data.generate(level, rng) : old.value;
  return new AffixInfo(tables).fromJSON({
    key: old.key,
    value,
    rebuilded: old.rebuilded,
  });
}

/**
 * 原版 `randomAffixes(config, level, blacklist)`：按 `weight` 加权抽一条词缀。
 *
 * `blacklist` 会被**原地修改**（把抽中的 key 标记为已用），与原版一致。
 */
export function randomAffixes(
  tables: DataTables,
  config: readonly string[],
  level: number,
  blacklist: Record<string, boolean>,
  rng: Rng,
): AffixInfo {
  const keys = config.filter((key) => !blacklist[key]);
  const totalWeight = keys.reduce((sum, key) => sum + (tables.affixes[key]?.weight || 1), 0);
  let dice = rng.next() * totalWeight;
  const result = keys.find((key) => {
    const weight = tables.affixes[key]?.weight || 1;
    if (dice < weight) {
      return true;
    }
    dice -= weight;
    return false;
  });

  if (result === undefined) {
    // 原版会写出 `blacklist[undefined] = true` 然后在下一行 TypeError；
    // 这里显式失败（词缀池为空，或所有权重都是 0/负数）
    throw new Error('randomAffixes: no affix selected (empty pool or non-positive weights)');
  }

  blacklist[result] = true;

  const data = tables.affixes[result];
  return new AffixInfo(tables).fromJSON({
    key: result,
    value: data ? data.generate(level, rng) : 0,
  });
}

/**
 * 原版 `isValidAffix(key, affix, level)`：等级区间 + 可用职业 + 可用部位。
 *
 * 注意原版**不**检查物品自身的 `minLevel/maxLevel`（那是 `randomEquip` 的职责）。
 */
export function isValidAffix(tables: DataTables, key: string, affix: string, level: number): boolean {
  const goodData: GoodData | undefined = tables.goods[key];
  const affixData: AffixData | undefined = tables.affixes[affix];
  if (!goodData || !affixData) {
    // 原版会 TypeError；这里视为「非法词缀」
    return false;
  }

  if (affixData.maxLevel && level > affixData.maxLevel) {
    return false;
  }
  if (affixData.minLevel && level < affixData.minLevel) {
    return false;
  }
  if (affixData.validClasses && affixData.validClasses.indexOf(goodData.class ?? '') === -1) {
    return false;
  }
  if (affixData.validPositions && affixData.validPositions.indexOf(goodData.position ?? '') === -1) {
    return false;
  }

  return true;
}

/**
 * 原版 `specialRate`：质量档为传奇（P4 后 `quality === 2`）时「抽中传奇词缀」的概率。
 *
 * ⚠️ 原版是 `__DEV__ ? 1 : Object.keys(legends).filter(v => !legends[v].special).length / 100`。
 * game-core 无 `__DEV__`，**固定采用生产公式**；开发态 100% 传奇的行为不移植。
 */
export function specialLegendRate(tables: DataTables): number {
  return Object.keys(tables.legends).filter((key) => !tables.legends[key]?.special).length / 100;
}

/**
 * 原版 `generateEquip(key, level, quality, legendType)`。
 *
 * 普通词缀条数 = `legendType ? quality - 1 : quality`（传奇占一格）。
 */
export function generateEquip(
  tables: DataTables,
  key: string,
  level: number,
  quality: number,
  legendType: string | null,
  rng: Rng,
): InventorySlot {
  const validAffixes = Object.keys(tables.affixes).filter((affix) =>
    isValidAffix(tables, key, affix, level),
  );

  const generatedAffixes: AffixInfo[] = [];
  const blacklist: Record<string, boolean> = {};
  const count = legendType ? quality - 1 : quality;
  for (let i = 0; i < count; i++) {
    generatedAffixes.push(randomAffixes(tables, validAffixes, level || 0, blacklist, rng));
  }

  if (legendType) {
    const legend = tables.legends[legendType];
    generatedAffixes.push(
      new AffixInfo(tables).fromJSON({
        key: legendType,
        value: legend ? legend.generate(level, rng) : 0,
      }),
    );
  }

  return new InventorySlot(tables, 'loot').fromJSON({
    key,
    level,
    count: 1,
    affixes: generatedAffixes,
    quality,
    legendType,
  });
}

/**
 * 原版 `randomEquip(level, mfRate, position)`：先掷品质，再（传说时）掷传奇，最后挑基底。
 *
 * `rng` 消费顺序：品质骰 → [传奇骰 → 传奇挑选] → 基底挑选。
 */
export function randomEquip(
  tables: DataTables,
  level: number,
  mfRate: number,
  position: string | undefined,
  rng: Rng,
): InventorySlot {
  const dice = rng.next() / mfRate;
  const quality = Math.max(0, BASE_QUALITY_RATE.findIndex((value) => value < dice) - 1);

  let legendType: string | null = null;

  if (quality === 2) {
    if (rng.next() < specialLegendRate(tables)) {
      const validLegends = Object.keys(tables.legends).filter((legendKey) => {
        const legend = tables.legends[legendKey];
        if (!legend) {
          return false;
        }
        return (
          !legend.special &&
          (legend.minLevel || 0) <= level &&
          (legend.maxLevel || level) >= level &&
          (!position || tables.goods[legend.type]?.position === position)
        );
      });
      legendType = validLegends[rng.int(validLegends.length)] ?? null;
    }
  }

  if (legendType) {
    const legend = tables.legends[legendType];
    if (legend) {
      return generateEquip(tables, legend.type, level, quality, legendType, rng);
    }
  }

  const equips = Object.keys(tables.goods).filter((goodKey) => tables.goods[goodKey]?.type === 'equip');
  const validEquips = equips.filter((goodKey) => {
    const good = tables.goods[goodKey];
    if (!good) {
      return false;
    }
    return (
      (good.minLevel || 0) <= level &&
      (good.maxLevel || level) >= level &&
      (!position || good.position === position)
    );
  });
  const key = validEquips[rng.int(validEquips.length)];
  if (key === undefined) {
    // 原版会拿 undefined 去 `isValidAffix` 然后 TypeError
    throw new Error('randomEquip: no valid equip base for the given level/position');
  }
  return generateEquip(tables, key, level, quality, null, rng);
}

/** 原版 `getMaterialLevel(level)`：装备等级 → 材料档位 0..5。 */
export function getMaterialLevel(level: number): number {
  if (level <= 30) {
    return 0;
  } else if (level <= 50) {
    return 1;
  } else if (level <= 75) {
    return 2;
  } else if (level <= 115) {
    return 3;
  } else if (level <= 140) {
    return 4;
  } else {
    return 5;
  }
}

/** 原版 `getDecomposeMatrials({level, quality})`：分解产出。 */
export function getDecomposeMatrials(input: { level: number; quality: number }): Record<string, number> {
  const ret: Record<string, number> = {};
  for (let i = 0; i <= input.quality && i < 3; i++) {
    const key = MATERIAL_KEY[i]?.[getMaterialLevel(input.level)];
    if (key) {
      ret[key] = 1;
    }
  }

  if (input.quality >= 2) {
    // 分解出神力（P4：传奇档 = quality 2；指数从该档起算）。
    ret.diamonds = Math.ceil(3 + (input.level / 100) * (1 << (input.quality - 2)));
  }
  return ret;
}

const goodOrderCache = new WeakMap<object, Record<string, number>>();

/**
 * 原版模块级的 `goodOrder`（`Object.keys(goods).forEach((v, i) => goodOrder[v] = i)`）。
 *
 * 因为数据表改为注入，这里按 `tables.goods` 对象缓存（同一个表只算一次）。
 */
export function getGoodOrder(tables: DataTables): Record<string, number> {
  const cached = goodOrderCache.get(tables.goods);
  if (cached) {
    return cached;
  }
  const order: Record<string, number> = {};
  Object.keys(tables.goods).forEach((key, index) => {
    order[key] = index;
  });
  goodOrderCache.set(tables.goods, order);
  return order;
}
