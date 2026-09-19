/**
 * ⚠️ 由原版 `data/.` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 词缀 / 传奇的 `generate(level)` 改为 `generate(level, rng)`，内部 `Math.random()` → `rng()`。
 */

import type { AttackLike, BuffStateLike, ComboLike, MedicineEntry, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/medicines.js ──
const __medicines_0 = ((): MedicineEntry[] => {
/**
 * Created by tdzl2003 on 02/06/2017.
 */

return  [
  {
    key: 'mainPoint',
    name: '根骨药剂',
    description: level => `全部主属性增加${level * 5}点`,
    hooks: {
      str: (level, value) => value + level * 5,
      dex: (level, value) => value + level * 5,
      int: (level, value) => value + level * 5,
      sta: (level, value) => value + level * 5,
    },
  },
  {
    key: 'lucky',
    name: '幸运药剂',
    description: level => `运气增加${level * 5}点`,
    hooks: {
      gf: (level, value) => value + level * 0.05,
      mf: (level, value) => value + level * 0.05,
    },
  },
  {
    key: 'exp',
    name: '知识药剂',
    description: level => `经验获得增加${level * 5}%`,
    hooks: {
      expMul: (level, value) => value * (1 + level * 0.05),
    },
  },
  {
    key: 'skill',
    name: '训练药剂',
    description: level => `技能提升速度增加${level * 5}%`,
    hooks: {
      skillExpMul: (level, value) => value * (1 + level * 0.05),
    },
  },
  {
    key: 'recovery',
    name: '自愈药剂',
    description: level => `每5秒恢复${level}%生命值`,
    hooks: {
      hpRecovery(level, value) {
        return value + level * this.maxHp * 0.002;
      }
    }
  },
  {
    key: 'speed',
    name: '急速药剂',
    description: level => `行动速度提升${level}%`,
    hooks: {
      speedRateMul: (level, value) => value * (1 + level * 0.01),
    }
  },
];

})();

export const medicines: Record<string, MedicineEntry> = arrayToMap([
  ...__medicines_0,
]);
