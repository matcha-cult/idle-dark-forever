/**
 * ⚠️ 占位实现 —— 由「数据表 TS 化」任务替换为真实的 183 个数据文件移植。
 *
 * 该文件存在的唯一目的：在数据表尚未移植完成时，让 `src/index.ts` 的导出面保持可编译。
 * 真实实现必须：显式组装（禁止模块级副作用）、保留函数型规则、随机函数注入 `Rng`。
 */

import type { DataTables } from '../contracts/data.js';

export function createDefaultTables(): DataTables {
  return {
    careers: {},
    roles: {},
    maps: {},
    enemies: {},
    skills: {},
    goods: {},
    passives: {},
    enhances: {},
    buffs: {},
    affixes: {},
    enemyAffixes: {},
    stories: {},
    legends: {},
    medicines: {},
    upgrades: { bankByDiamonds: [], inventoryByDiamonds: [], inventory: [] },
    announcement: { version: '0.0.0' },
  };
}
