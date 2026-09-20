/**
 * 数据表组装入口。
 *
 * ⚠️ 与原版的唯一结构性差异：**没有模块级副作用**。
 * 原版 `data/index.js` 靠 `require('./packages/nightmare')` / `require('./packages/year2018')`
 * 在 import 期原地改写全局注册表（注册顺序即行为）；这里改成显式的
 * `registerNightmare(tables)` → `registerYear2018(tables)` 调用，顺序与原版 require 顺序一致：
 *
 *   基础表（data/base.js 的各表） → nightmare → year2018
 *
 * `year2018/redbag.js` 会给「当时已存在的」所有 `enemies` / `maps` 追加红包掉落，
 * 因此这个顺序是**语义的一部分**（原版注释也强调「活动副本不掉落红包，所以这个顺序很重要」）。
 */

import type { DataTables, MutableDataTables } from '../contracts/data.js';
import { cloneTables } from './_util.js';

import { affixes } from './affixes.js';
import { announcement } from './announcement.js';
import { buffs } from './buffs.js';
import { careers } from './careers.js';
import { enemyAffixes } from './enemy-affixes.js';
import { enemies } from './enemies.js';
import { enhances } from './enhances.js';
import { goods } from './goods.js';
import { legends } from './legends.js';
import { maps } from './maps.js';
import { medicines } from './medicines.js';
import { passives } from './passives.js';
import { roles } from './roles.js';
import { skills } from './skills.js';
import { stories } from './stories.js';
import { upgrades } from './upgrades.js';

import { registerNightmare } from './packages/nightmare.js';
import { registerYear2018 } from './packages/year2018.js';

export { registerNightmare, registerYear2018 };
/**
 * 基础表（未叠加 `data/packages/*`）。
 *
 * 类型收口说明：`_shapes.ts` 里的条目类型比冻结契约「更宽」——契约把 hook 的
 * `this` / `world` / `self` 一律标成 `unknown`，而 183 个数据文件里的近千个函数必须能对它们
 * 做鸭子类型调用。两者描述的其实是同一批对象，这里做**一次**显式边界转换，
 * 换取 `src/data/**` 内部全程 `strict` + `noUncheckedIndexedAccess`。
 */
const baseTables = {
  careers,
  roles,
  maps,
  enemies,
  skills,
  goods,
  passives,
  enhances,
  buffs,
  affixes,
  enemyAffixes,
  stories,
  legends,
  medicines,
  upgrades,
  announcement,
} as unknown as DataTables;

export { baseTables };

/**
 * 构造一套可独立使用的数据表。
 *
 * 每次调用都返回**全新的表对象**（条目与 `loots` 数组均拷贝），
 * 因此 `registerYear2018` 追加红包掉落不会污染模块级常量，也不会在多次调用间累加。
 */
export function createDefaultTables(): DataTables {
  const tables: MutableDataTables = cloneTables(baseTables);
  registerNightmare(tables);
  registerYear2018(tables);
  registerCraftDrops(tables);
  return tables;
}

/**
 * 工艺通货掉落速率（**敌人每击杀**；地图通关 = ×{@link MAP_DROP_MULTIPLIER}）。
 *
 * 顺序 = 稀有度**递增**（越靠后越稀有）。用户口径：
 * - `mirror`（映道镜）**极稀有**：用极低概率控制持有量；
 * - `divine`（神圣石）/ `fracture`（破溃宝珠）掉落高于映道镜，是**大额交易通货**（类比百元钞）；
 * - 其余按稀有度顺序排列。数值可随时调整（纯数据）。
 *
 * ⚠️ 修仙原表 13 种里 **不含 `vaal`**（瓦尔宝珠，用户指定不实装）。
 */
export const CRAFT_DROP_RATES: Readonly<Record<string, number>> = {
  'currency.transmute': 0.12,
  'currency.alchemy': 0.08,
  'currency.chaos': 0.05,
  'currency.scour': 0.03,
  'currency.annul': 0.02,
  'currency.blessed': 0.012,
  'currency.exalt': 0.008,
  'currency.ember': 0.005,
  'currency.wisp': 0.005,
  'currency.divine': 0.0025,
  'currency.fracture': 0.0018,
  'currency.mirror': 0.0001,
};

/** 精华掉落速率（本期实装 6 种，统一 2%；具体分布下期）。 */
export const ESSENCE_DROP_RATES: Readonly<Record<string, number>> = {
  'essence.atk': 0.02,
  'essence.spirit': 0.02,
  'essence.def': 0.02,
  'essence.hp': 0.02,
  'essence.regen': 0.02,
  'essence.insight': 0.02,
};

/** 地图通关掉落相对敌人的倍率。 */
export const MAP_DROP_MULTIPLIER = 5;

/**
 * P8/P10：把**实装的工艺通货 + 精华**接入掉落池（`{ key, count:[n,n], rate }` 形态）。
 *
 * ⚠️ `battle-world.loots` 对 `count` **只认数组**：写标量会算出 0（§3.2 陷阱），故一律 `[n,n]`。
 * `essence.07..12`（空位）**不在**速率表里 → 不参与掉落。
 */
export function registerCraftDrops(tables: MutableDataTables): void {
  const drops = { ...CRAFT_DROP_RATES, ...ESSENCE_DROP_RATES };
  for (const enemy of Object.values(tables.enemies)) {
    if (!enemy.loots) continue;
    for (const [key, rate] of Object.entries(drops)) {
      enemy.loots.push({ key, count: [1, 1], rate });
    }
  }
  for (const map of Object.values(tables.maps)) {
    if (!map.loots) continue;
    for (const [key, rate] of Object.entries(drops)) {
      map.loots.push({ key, count: [1, 1], rate: rate * MAP_DROP_MULTIPLIER });
    }
  }
}
