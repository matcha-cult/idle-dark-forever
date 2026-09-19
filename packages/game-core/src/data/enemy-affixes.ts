/**
 * ⚠️ 由原版 `data/enemyAffixes/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 词缀 / 传奇的 `generate(level)` 改为 `generate(level, rng)`，内部 `Math.random()` → `rng()`。
 */

import type { AttackLike, BuffStateLike, ComboLike, EnemyAffixEntry, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/enemyAffixes/base.js ──
const __enemy_affixes_0 = ((): EnemyAffixEntry[] => {
/**
 * Created by tdzl2003 on 2/3/17.
 */

return  [
  {
    key: 'stronger',
    name: '强壮的',
    hooks: {
      maxHpMul: (world, value) => value * 1.5,
      atkMul: (world, value) => value * 1.5,
    },
  },
  {
    key: 'faster',
    name: '快速的',
    hooks: {
      atkSpeedMul: (world, value) => value * 2,
    },
  },
  {
    key: 'recover',
    name: '自愈的',
    hooks: {
      hpRecovery(world, value) {
        return value + this.maxHp * 0.005;
      },
    },
  },
];

})();

export const enemyAffixes: Record<string, EnemyAffixEntry> = arrayToMap([
  ...__enemy_affixes_0,
]);
