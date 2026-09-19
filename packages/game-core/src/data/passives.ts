/**
 * ⚠️ 由原版 `data/passives/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 随机一律走注入的 `Rng` 端口，本文件**零** `Math.random()`：
 *    词缀 / 传奇的 `generate` 用形参 `rng`；技能 / buff / 强化 hook 用 `world.rng.skill`（标签 `'skill'`）。
 */

import type { AttackLike, BuffStateLike, ComboLike, HookAbilityEntry, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/passives/base.js ──
const __passives_0 = ((): HookAbilityEntry[] => {
/**
 * Created by tdzl2003 on 2/2/17.
 */

return  [
];

})();

// ── 原 data/passives/warrior.js ──
const __passives_1 = ((): HookAbilityEntry[] => {
/**
 * Created by tdzl2003 on 2/2/17.
 */

return  [
  {
    key: 'atkByStr',
    name: '强力攻击',
    description: '用力攻击你的敌人。每点力量增加1%的攻击力。',
    hooks: {
      atkMul(world, value) {
        return value * (this.str / 100 + 1);
      },
    },
  },
  {
    key: 'rage',
    name: '怒气',
    description: '增加100点怒气上限。每次攻击增加5点怒气，每次受到攻击增加1点怒气。',
    hooks: {
      maxRp(world, value)  {
        return value + 100;
      },
      rpOnAttack(world, value) {
        return value + 5;
      },
      rpOnAttacked(world, value) {
        return value + 1;
      },
    },
  },
];

})();

// ── 原 data/passives/sorceress.js ──
const __passives_2 = ((): HookAbilityEntry[] => {
/**
 * Created by tdzl2003 on 2/2/17.
 */

return  [
  {
    key: 'magic',
    name: '法力',
    description: '增加20点法力值，每角色等级额外增加4点法力值。每5秒回复1点法力值，每角色等级额外回复0.2法力值',
    hooks: {
      maxMp(world, value) {
        return value + 50 + this.level * 10;
      },
      mpRecovery(world, value)  {
        return value + 0.2 + this.level * 0.04;
      },
    },
  },
];

})();

// ── 原 data/passives/assassin.js ──
const __passives_3 = ((): HookAbilityEntry[] => {
/**
 * Created by tdzl2003 on 2/2/17.
 */

return  [
  {
    key: 'atkByDex',
    name: '强力攻击',
    description: '攻击你的敌人的弱点。每点敏捷增加1%的攻击力。',
    hooks: {
      atkAdd(world, value) {
        return value + this.dex / 100;
      },
    },
  },
  {
    key: 'energy',
    name: '能量',
    description: '增加100点能量上限。增加10点能量恢复速度。',
    hooks: {
      maxEp(world, value) {
        return value + 100;
      },
      epRecovery(world, value) {
        return value + 5;
      },
    },
  },
];

})();

export const passives: Record<string, HookAbilityEntry> = arrayToMap([
  ...__passives_0,
  ...__passives_1,
  ...__passives_2,
  ...__passives_3,
]);
