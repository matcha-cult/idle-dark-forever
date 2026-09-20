/**
 * ⚠️ 由原版 `data/roles/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 随机一律走注入的 `Rng` 端口，本文件**零** `Math.random()`：
 *    词缀 / 传奇的 `generate` 用形参 `rng`；技能 / buff / 强化 hook 用 `world.rng.skill`（标签 `'skill'`）。
 */

import type { AttackLike, BuffStateLike, ComboLike, RoleEntry, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/roles/eyer.js ──
const __roles_0 = ((): RoleEntry => {
/**
 * Created by tdzl2003 on 1/31/17.
 */

return  {
  key: 'Eyer',
  name: '艾尔',
  description: '边境之村的一名普通少年，熟读数百本勇者传，头发染成了勇者专用的金色。',
  defaultCareer: 'warrior',
  atk: 1,
  atkSpeed: 0.5,

  attrBase: {
    str: 10,
    dex: 8,
    int: 4,
  },
};

})();

// ── 原 data/roles/aleanor.js ──
const __roles_1 = ((): RoleEntry => {
/**
 * Created by tdzl2003 on 1/31/17.
 */

return  {
  key: 'Aleanor',
  name: '亚莲娜',
  description: '艾尔的童年好友，一名蓝发的少女。似乎有些不同寻常的地方……',
  defaultCareer: 'sorceress',
  atk: 0.5,
  atkSpeed: 1,
  requirement: {
  },

  attrBase: {
    str: 4,
    dex: 8,
    int: 12,
  },
};

})();

export const roles: Record<string, RoleEntry> = arrayToMap([
  __roles_0,
  __roles_1,
]);
