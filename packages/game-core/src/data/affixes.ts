/**
 * ⚠️ 由原版 `data/affixes/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 随机一律走注入的 `Rng` 端口，本文件**零** `Math.random()`：
 *    词缀 / 传奇的 `generate` 用形参 `rng`；技能 / buff / 强化 hook 用 `world.rng.skill`（标签 `'skill'`）。
 */

import type { AffixEntry, AttackLike, BuffStateLike, ComboLike, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/affixes/base.js ──
const __affixes_0 = ((): AffixEntry[] => {
/**
 * Created by tdzl2003 on 2/3/17.
 */

return  [
  {
    key: 'maxHp',
    affixType: 'prefix',
    tag: 'life',
    display: effect => `生命值 +${Math.round(effect)}`,
    validPositions: ['plastron', 'gaiter'],
    generate(level, rng) {
      // 1 + 每装备等级1-3点生命
      return (rng.next() * 2 + 1) * level + 1;
    },
    range(level) {
      return `${level + 1}~${3 * level + 1}`
    },
    hooks: {
      maxHp: (effect, value) => value + effect,
    },
  },
  {
    key: 'maxMp',
    affixType: 'prefix',
    tag: 'mana',
    display: effect => `法力值 +${Math.round(effect)}`,
    validClasses: ['cloth', 'ornament'],
    generate(level, rng) {
      // 1 + 每装备等级1-2点法力
      return (rng.next() * 1 + 1) * level + 1;
    },
    range(level) {
      return `${level + 1}~${2 * level + 1}`
    },
    hooks: {
      maxMp: (effect, value) => value + effect,
    },
  },
  {
    key: 'hpRecovery',
    affixType: 'prefix',
    tag: 'life',
    display: effect => `5秒回血${Math.round(effect*5)}点`,
    validPositions: ['plastron', 'gaiter', 'ornament'],
    generate(level, rng) {
      // (0.5+每装备等级0.125-0.375点生命回复)*(1+每装备等级*0.1)
      return ((rng.next() * 0.05 + 0.025) * level + 0.1) * (1+level*0.2);
    },
    range(level) {
      return `${Math.round((0.025*level + 0.1)*(1+level*0.2) * 5)}~${Math.round((0.075*level + 0.1)*(1+level*0.2) * 5)}`
    },
    hooks: {
      hpRecovery: (effect, value) => value + effect,
    },
  },
  {
    key: 'mpRecovery',
    affixType: 'prefix',
    tag: 'mana',
    display: effect => `5秒回蓝${Math.round(effect*5)}点`,
    validClasses: ['cloth', 'wand', 'ornament'],
    generate(level, rng) {
      // 2+每装备等级0-0.2点法力回复
      return (rng.next() * 0.15) * level + 1;
    },
    range(level) {
      return `${Math.round(1*5)}~${Math.round((0.15*level+1)*5)}`
    },
    hooks: {
      mpRecovery: (effect, value) => value + effect,
    },
  },
  {
    key: 'atk',
    affixType: 'prefix',
    tag: 'attack',
    display: effect => `攻击力 +${Math.round(effect)}`,
    weight: 2,
    validClasses: ['sword', 'dagger'],
    generate(level, rng) {
      // 0.5+每装备等级0.125-0.375点攻击力
      return (rng.next() * 0.25 + 0.125) * level + 0.5;
    },
    range(level) {
      return `${Math.round(0.125*level+0.5)}~${Math.round((0.375*level + 0.5))}`;
    },
    hooks: {
      atk: (effect, value) => value + effect,
    },
  },
  {
    key: 'critRate',
    affixType: 'suffix',
    tag: 'crit',
    display: effect => `暴击几率 +${Math.round(effect*100)}%`,
    weight: 0.6,
    minLevel: 20,
    generate(level, rng) {
      // 1%+每装备等级0.125%-0.375%暴击几率
      return (rng.next() * 0.00125 + 0.00125) * level + 0.01;
    },
    range(level) {
      return `${Math.round(0.125*level+1)}%~${Math.round((0.25*level + 1))}%`;
    },
    hooks: {
      critRate: (effect, value) => value + effect,
    },
  },
  {
    key: 'critBonus',
    affixType: 'suffix',
    tag: 'crit',
    display: effect => `暴击伤害 +${Math.round(effect*100)}%`,
    weight: 0.6,
    minLevel: 20,
    generate(level, rng) {
      // 5%+每装备等级0.5%-1.0%暴击伤害
      return (rng.next() * 0.005 + 0.005) * level + 0.05;
    },
    range(level) {
      return `${Math.round(0.5*level + 5)}%~${Math.round((1*level + 5))}%`;
    },
    hooks: {
      critBonus: (effect, value) => value + effect,
    },
  },
  {
    key: 'leech',
    affixType: 'suffix',
    tag: 'leech',
    display: effect => `吸血 +${Math.round(effect)}`,
    validClasses: ['sword', 'dagger', 'ornament'],
    generate(level, rng) {
      // 1+每装备等级0.2-0.6击回
      return ((rng.next() * 0.1 + 0.05) * level + 0.2) * (1+level*0.2);
    },
    range(level) {
      return `${Math.round((0.05*level+0.2)*(1+level*0.2))}~${Math.round((0.15*level+0.2)*(1+level*0.2))}`;
    },
    hooks: {
      leech: (effect, value) => value + effect,
    },
  },
  {
    key: 'atkMul',
    affixType: 'prefix',
    tag: 'attack',
    display: effect => `攻击力 +${Math.round(effect*100)}%`,
    validClasses: ['sword', 'dagger'],
    weight: 0.4,
    generate(level, rng) {
      // 3%+每级0.15-0.25%攻击力
      return (rng.next() * 0.0025 + 0.0025) * level + 0.03;
    },
    range(level) {
      return `${Math.round(0.25*level + 3)}%~${Math.round((0.5*level + 3))}%`;
    },
    hooks: {
      atkMulAttr: (effect, value) => value * (1 + effect),
    },
  },
  {
    key: 'atkSpeedAdd',
    affixType: 'suffix',
    tag: 'speed',
    display: effect => `攻击速度 +${Math.round(effect*100)}%`,
    validClasses: ['sword', 'dagger'],
    generate(level, rng) {
      // 5%+每装备等级0.15%-0.25%攻击速度
      return (rng.next() * 0.0015 + 0.0015) * level + 0.05;
    },
    range(level) {
      return `${Math.round(0.15*level + 5)}%~${Math.round((0.3*level + 5))}%`;
    },
    hooks: {
      atkSpeedAdd: (effect, value) => value + effect,
    },
  },
  {
    key: 'def',
    affixType: 'prefix',
    tag: 'defense',
    display: effect => `护甲 +${Math.round(effect)}`,
    validPositions: ['plastron', 'gaiter'],
    generate(level, rng) {
      // 3 + 每装备等级0.5-1.5属性
      return (rng.next() * 1 + 0.5) * level + 3;
    },
    range(level) {
      return `${Math.round(0.5*level + 3)}~${Math.round((1.5*level + 3))}`;
    },
    hooks: {
      def: (effect, value) => value + effect,
    },
  },
  {
    key: 'str',
    affixType: 'prefix',
    tag: 'attribute',
    display: effect => `力量 +${Math.round(effect)}`,
    generate(level, rng) {
      // 1 + 每装备等级0.5-1.5属性
      return (rng.next() * 1 + 0.5) * level + 1;
    },
    range(level) {
      return `${Math.round(0.5*level + 1)}~${Math.round((1.5*level + 1))}`;
    },
    hooks: {
      str: (effect, value) => value + effect,
    },
  },
  {
    key: 'dex',
    affixType: 'prefix',
    tag: 'attribute',
    display: effect => `敏捷 +${Math.round(effect)}`,
    generate(level, rng) {
      // 1 + 每装备等级0.5-1.5属性
      return (rng.next() * 1 + 0.5) * level + 1;
    },
    range(level) {
      return `${Math.round(0.5*level + 1)}~${Math.round((1.5*level + 1))}`;
    },
    hooks: {
      dex: (effect, value) => value + effect,
    },
  },
  {
    key: 'int',
    affixType: 'prefix',
    tag: 'attribute',
    display: effect => `智力 +${Math.round(effect)}`,
    generate(level, rng) {
      // 1 + 每装备等级0.5-1.5属性
      return (rng.next() * 1 + 0.5) * level + 1;
    },
    range(level) {
      return `${Math.round(0.5*level + 1)}~${Math.round((1.5*level + 1))}`;
    },
    hooks: {
      int: (effect, value) => value + effect,
    },
  },
];

})();

// ── 原 data/affixes/level2.js ──
const __affixes_1 = ((): AffixEntry[] => {
/**
 * Created by tdzl2003 on 2/3/17.
 */

/*
抗性和吸收规则：
首先计算吸收百分比，剩余伤害计算抗性减乘，最后减去吸收数值，为剩余伤害。
例如：100点火焰伤害，吸收20%， 抗性100
那么计算吸收20点生命，受到80/(100+100)*100 = 40点伤害，最后总计受到20点伤害。
*/


return  [
  {
    key: 'fireResist',
    affixType: 'suffix',
    tag: 'resist',
    display: effect => `火焰抗性 +${Math.round(effect)}`,
    minLevel: 40,
    maxLevel: 180,
    validPositions: ['plastron', 'gaiter'],
    generate(level, rng) {
      // 1 + 每装备等级1-2点抗性
      return (rng.next() * 1 + 1) * level + 1;
    },
    range(level) {
      return `${Math.round(1*level + 1)}~${Math.round((2*level + 1))}`;
    },
    hooks: {
      fireResist: (effect, value) => value + effect,
    },
  },
  {
    key: 'fireAbsorb',
    affixType: 'suffix',
    tag: 'absorb',
    display: effect => `火焰吸收 +${Math.round(effect*100)}%`,
    minLevel: 40,
    weight: 0.2,
    validPositions: ['plastron', 'gaiter', 'ornament'],
    generate(level, rng) {
      // 0.5% + 每装备等级0.1-0.2% 吸收
      return (rng.next() * 0.001 + 0.001) * level + 0.005;
    },
    range(level) {
      return `${Math.round(0.1*level + 0.5)}%~${Math.round(0.2*level + 0.5)}%`;
    },
    hooks: {
      fireAbsorb: (effect, value) => value + effect,
    },
  },
  {
    key: 'darkResist',
    affixType: 'suffix',
    tag: 'resist',
    display: effect => `暗影抗性 +${Math.round(effect)}`,
    minLevel: 40,
    maxLevel: 180,
    validPositions: ['plastron', 'gaiter'],
    generate(level, rng) {
      // 1 + 每装备等级1-2点抗性
      return (rng.next() * 1 + 1) * level + 1;
    },
    range(level) {
      return `${Math.round(1*level + 1)}~${Math.round((2*level + 1))}`;
    },
    hooks: {
      darkResist: (effect, value) => value + effect,
    },
  },
  {
    key: 'darkAbsorb',
    affixType: 'suffix',
    tag: 'absorb',
    display: effect => `暗影吸收 +${Math.round(effect*100)}%`,
    minLevel: 40,
    weight: 0.2,
    validPositions: ['plastron', 'gaiter', 'ornament'],
    generate(level, rng) {
      // 0.5% + 每装备等级0.1-0.2% 吸收
      return (rng.next() * 0.001 + 0.001) * level + 0.005;
    },
    range(level) {
      return `${Math.round(0.1*level + 0.5)}%~${Math.round(0.2*level + 0.5)}%`;
    },
    hooks: {
      darkAbsorb: (effect, value) => value + effect,
    },
  },
  {
    key: 'coldResist',
    affixType: 'suffix',
    tag: 'resist',
    display: effect => `寒冷抗性 +${Math.round(effect)}`,
    minLevel: 40,
    maxLevel: 180,
    validPositions: ['plastron', 'gaiter'],
    generate(level, rng) {
      // 1 + 每装备等级1-2点抗性
      return (rng.next() * 1 + 1) * level + 1;
    },
    range(level) {
      return `${Math.round(1*level + 1)}~${Math.round((2*level + 1))}`;
    },
    hooks: {
      coldResist: (effect, value) => value + effect,
    },
  },
  {
    key: 'coldAbsorb',
    affixType: 'suffix',
    tag: 'absorb',
    display: effect => `寒冷吸收 +${Math.round(effect*100)}%`,
    minLevel: 40,
    weight: 0.2,
    validPositions: ['plastron', 'gaiter', 'ornament'],
    generate(level, rng) {
      // 0.5% + 每装备等级0.1-0.2% 吸收
      return (rng.next() * 0.001 + 0.001) * level + 0.005;
    },
    range(level) {
      return `${Math.round(0.1*level + 0.5)}%~${Math.round(0.2*level + 0.5)}%`;
    },
    hooks: {
      coldAbsorb: (effect, value) => value + effect,
    },
  },
  {
    key: 'lightningResist',
    affixType: 'suffix',
    tag: 'resist',
    display: effect => `闪电抗性 +${Math.round(effect)}`,
    minLevel: 40,
    maxLevel: 180,
    validPositions: ['plastron', 'gaiter'],
    generate(level, rng) {
      // 1 + 每装备等级1-2点抗性
      return (rng.next() * 1 + 1) * level + 1;
    },
    range(level) {
      return `${Math.round(1*level + 1)}~${Math.round((2*level + 1))}`;
    },
    hooks: {
      lightningResist: (effect, value) => value + effect,
    },
  },
  {
    key: 'lightningAbsorb',
    affixType: 'suffix',
    tag: 'absorb',
    display: effect => `闪电吸收 +${Math.round(effect*100)}%`,
    minLevel: 40,
    weight: 0.2,
    validPositions: ['plastron', 'gaiter', 'ornament'],
    generate(level, rng) {
      // 0.5% + 每装备等级0.1-0.2% 吸收
      return (rng.next() * 0.001 + 0.001) * level + 0.005;
    },
    range(level) {
      return `${Math.round(0.1*level + 0.5)}%~${Math.round(0.2*level + 0.5)}%`;
    },
    hooks: {
      lightningAbsorb: (effect, value) => value + effect,
    },
  },

  {
    key: 'allResist',
    affixType: 'suffix',
    tag: 'resist',
    display: effect => `所有抗性 +${Math.round(effect)}`,
    minLevel: 40,
    validPositions: ['plastron', 'gaiter'],
    generate(level, rng) {
      // 1 + 每装备等级1-2点抗性
      return (rng.next() * 0.5 + 0.75) * level + 1;
    },
    range(level) {
      return `${Math.round(0.75*level + 1)}~${Math.round((1.25*level + 1))}`;
    },
    hooks: {
      allResist: (effect, value) => value + effect,
    },
  },
  {
    key: 'hpFromKill',
    affixType: 'suffix',
    tag: 'lifeOnKill',
    display: effect => `击杀回血 ${Math.round(effect)}`,
    minLevel: 40,
    validPositions: ['weapon'],
    generate(level, rng) {
      return ((rng.next() * 0.2 + 0.1) * level + 0.5) * (1 + level * 0.2);
    },
    range(level) {
      return `${Math.round((0.1*level+0.5)*(1+level*0.2))}~${Math.round((0.3*level+0.5)*(1+level*0.2))}`;
    },
    hooks: {
      hpFromKill: (effect, value) => value + effect,
    },
  },
  {
    key: 'mpFromKill',
    affixType: 'suffix',
    tag: 'manaOnKill',
    display: effect => `击杀回蓝 ${Math.round(effect)}`,
    minLevel: 40,
    validClasses: ['wand'],
    generate(level, rng) {
      return ((rng.next() * 0.75) * level + 5) ;
    },
    range(level) {
      return `${Math.round(5)}~${Math.round((0.75*level+5))}`;
    },
    hooks: {
      mpFromKill: (effect, value) => value + effect,
    },
  },
  {
    key: 'lucky',
    affixType: 'suffix',
    tag: 'luck',
    display: effect => `运气 +${effect | 0}`,
    minLevel: 60,
    weight: 0.1,
    validPositions: ['plastron', 'gaiter', 'ornament'],
    generate(level, rng) {
      return (rng.next() * 0.5 + 0.25) * level + 1;
    },
    range(level) {
      return `${Math.round(0.25 * level + 1)}~${Math.round((0.75 * level+1))}`;
    },
    hooks: {
      mf: (effect, value) => value + effect / 100,
      gf: (effect, value) => value + effect / 100,
    },
  },
];

})();

export const affixes: Record<string, AffixEntry> = arrayToMap([
  ...__affixes_0,
  ...__affixes_1,
]);
