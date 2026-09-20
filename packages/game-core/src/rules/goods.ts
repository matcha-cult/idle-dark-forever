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

/** 缺省词缀分组 key（`GoodData.affixGroup` 未标注时的归属）。 */
export const DEFAULT_AFFIX_GROUP = 'default';

/** 词缀前后缀归属。 */
export type AffixKind = 'prefix' | 'suffix';

/** 词缀归属；未标注 `affixType` 时按 `'prefix'`（历史数据兜底）。 */
export function affixKindOf(affix: AffixData | undefined): AffixKind {
  return affix?.affixType === 'suffix' ? 'suffix' : 'prefix';
}

/** `GoodData.affixGroup` → 分组 key；缺省落到 {@link DEFAULT_AFFIX_GROUP}。 */
export function affixGroupOf(goodData: GoodData | undefined): string {
  return goodData?.affixGroup ?? DEFAULT_AFFIX_GROUP;
}

/**
 * 底材 → 候选词缀池（P5 挂点）。
 *
 * 优先取 `tables.affixGroups[group]`；没有分组表 / 未命中该组时回落到**全池**
 * （本期所有底材共用一个默认池，具体分布下期）。
 */
export function affixPoolOf(tables: DataTables, goodData: GoodData | undefined): readonly string[] {
  const grouped = tables.affixGroups?.[affixGroupOf(goodData)];
  return grouped ?? Object.keys(tables.affixes);
}

/**
 * 品质 → 目标词缀条数（前缀 / 后缀分开，P4 + P5）。
 *
 * - 普通（0）：1 前缀 + 1 后缀；
 * - 优秀（1）：3 前缀 + 3 后缀；
 * - 传奇（2）：本期同 3+3，**特殊性由末尾追加的传奇词缀承载**（特殊词缀池下期，P5）。
 * - 负数 / 非有限数：0 条（防御性）。
 */
export function affixCountsOfQuality(quality: number): { prefix: number; suffix: number } {
  if (!Number.isFinite(quality) || quality < 0) {
    return { prefix: 0, suffix: 0 };
  }
  if (quality <= 0) {
    return { prefix: 1, suffix: 1 };
  }
  return { prefix: 3, suffix: 3 };
}

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
 * 从 `pool` 里按 `need` 抽词缀写入 `out`（同侧去重由 `blacklist` 保证）。
 *
 * 候选不足时**按可用数抽取**而不是抛错：低等级的某侧池可能为空（例如 1 级装备没有合法后缀），
 * 这属于正常的等级门槛，不是数据缺失。整池为空由 `generateEquip` 显式报错。
 */
function drawAffixes(
  tables: DataTables,
  pool: readonly string[],
  need: number,
  level: number,
  blacklist: Record<string, boolean>,
  rng: Rng,
  out: AffixInfo[],
): void {
  const target = Math.min(Math.max(0, Math.trunc(need)), pool.length);
  for (let i = 0; i < target; i++) {
    out.push(randomAffixes(tables, pool, level, blacklist, rng));
  }
}

/**
 * 原版 `generateEquip(key, level, quality, legendType)`。
 *
 * P5：词缀按**前缀 / 后缀分池**抽取（普通 1+1、优秀 3+3；传奇本期同 3+3，
 * 特殊性由末尾追加的传奇词缀承载 —— 传奇词缀**豁免**前后缀规则）。
 * 候选池来自 `GoodData.affixGroup` 解析出的底材词缀池（本期为全池默认组）。
 */
export function generateEquip(
  tables: DataTables,
  key: string,
  level: number,
  quality: number,
  legendType: string | null,
  rng: Rng,
): InventorySlot {
  const validAffixes = affixPoolOf(tables, tables.goods[key]).filter((affix) =>
    isValidAffix(tables, key, affix, level),
  );

  const needs = affixCountsOfQuality(quality);
  const generatedAffixes: AffixInfo[] = [];
  const blacklist: Record<string, boolean> = {};

  if (needs.prefix + needs.suffix > 0) {
    if (validAffixes.length === 0) {
      // 原版会拿 undefined 去 `isValidAffix` 然后 TypeError；这里显式失败便于定位数据问题。
      throw new Error('generateEquip: no affix selected (empty pool for this equip/level)');
    }
    const prefixes = validAffixes.filter((affix) => affixKindOf(tables.affixes[affix]) === 'prefix');
    const suffixes = validAffixes.filter((affix) => affixKindOf(tables.affixes[affix]) === 'suffix');
    drawAffixes(tables, prefixes, needs.prefix, level || 0, blacklist, rng, generatedAffixes);
    drawAffixes(tables, suffixes, needs.suffix, level || 0, blacklist, rng, generatedAffixes);
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
