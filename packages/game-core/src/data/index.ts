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
  registerPlaceholders(tables);
  return tables;
}

/**
 * E6/P8：把 **12 通货 + 12 精华**占位物品接入掉落池（`{ key, count:[n,n], rate }` 形态）。
 *
 * ⚠️ `battle-world.loots` 对 `count` **只认数组**：写标量会算出 0（§3.2 陷阱），故一律 `[n,n]`。
 * 本期只保证「可掉落 + 可堆叠」，具体分布下期（P5/P8）。
 */
export function registerPlaceholders(tables: MutableDataTables): void {
  const currencies = Object.keys(tables.goods).filter((key) => key.startsWith('currency.'));
  const essences = Object.keys(tables.goods).filter((key) => key.startsWith('essence.'));
  for (const enemy of Object.values(tables.enemies)) {
    if (!enemy.loots) continue;
    for (const key of currencies) enemy.loots.push({ key, count: [1, 1], rate: 0.05 });
    for (const key of essences) enemy.loots.push({ key, count: [1, 1], rate: 0.01 });
  }
  for (const map of Object.values(tables.maps)) {
    if (!map.loots) continue;
    for (const key of currencies) map.loots.push({ key, count: [1, 2], rate: 0.2 });
    for (const key of essences) map.loots.push({ key, count: [1, 1], rate: 0.05 });
  }
}
