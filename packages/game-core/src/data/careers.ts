/**
 * ⚠️ 由原版 `data/careers/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 词缀 / 传奇的 `generate(level)` 改为 `generate(level, rng)`，内部 `Math.random()` → `rng()`。
 */

import type { AttackLike, BuffStateLike, CareerEntry, ComboLike, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/careers/warrior.js ──
const __careers_0 = ((): CareerEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'warrior',
  name: '战士',
  description: '好用的炮灰(?)职业，用肌肉来解决问题。',
  requirement: {
    role: 'Eyer',
  },
  equipments: {
    weapon: 'stickSword',
  },
  expFormula: [2, 10, -4, 2, 0.3],
  attrGrow: {
    str: 1.5,
    dex: 1,
    int: 0,
    sta: 1.5,
  },
  skills: {
    melee: 1,
    thump: 2,
    meleeForRage: 4,
    cleave: 6,
    thumpHead: 8,
    shout: 10,
    cleaveBlast: 12,
    whirlwind: 14,
    swordSkill: 16,
    shoutShake: 18,
    mortalStrike: 20,
    whirlwindBlood: 22,
    commandShout: 24,
    shockWave: 26,
    'warrior.kick': 28,
  },
  passives: {
    atkByStr: 1,
    rage: 2,
  },
  enhances: {
    weaponMastery: 10,
    rageForHp: 10,
    ragingAttack: 15,
    ironBody: 15,
    rageFromHeart: 20,
    strengthBelieve: 20,
    keepingRage: 25,
    phoenixHeart: 25,
    pugnacity: 30,
  },
  availableClasses: {
    base: true,
    sword: true, // 剑
    cloth: true, // 布甲
    armor: true,
    ornament: true,
  },
};

})();

// ── 原 data/careers/sorceress.js ──
const __careers_1 = ((): CareerEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'sorceress',
  name: '魔法少女',
  description: '与精灵签订契约就职魔法少女，掌握超自然的力量以击败魔族。',
  requirement: {
    role: 'Aleanor',
  },
  equipments: {
    weapon: 'stickWand',
  },
  expFormula: [2, 10, -4, 2, 0.3],
  skills: {
    windBlade: 1,
    fireBall: 2,
    iceArrow: 4,
    magicShield: 6,
    flameStrike: 8,
    iceNova: 10,
    counterSpelling: 12,
    burning: 14,
    iceLance: 16,
    awaking: 18,
    fireShield: 20,
    iceShield: 22,
    transform: 24,
    dragonFlame: 26,
  },
  passives: {
    magic: 2,
  },
  enhances: {
    thinking: 10,
    coldWeaken: 10,
    fireFrenzy: 15,
    magicArtist: 15,
    soCold: 20,
    flaming: 20,
    manaExchange: 25,
    coldAir: 25,
    // fireRunner: 30,
    // lifeExchange: 30,
  },
  availableClasses: {
    base: true,
    wand: true, // 法杖
    cloth: true, // 布甲
    ornament: true,
  },
  attrGrow: {
    str: 0,
    dex: 1,
    int: 2.5,
    sta: 0.5,
  },
};

})();

// ── 原 data/careers/assassin.js ──
const __careers_2 = ((): CareerEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'assassin',
  name: '刺客',
  description: '擅长从阴影中伏击敌人。',
  requirement: {
    role: 'Eyer',
    stories: ['chapter3-5'],
  },
  equipments: {
    weapon: 'stickDagger',
  },
  expFormula: [2, 10, -4, 2, 0.3],
  attrGrow: {
    str: 1,
    dex: 1.5,
    int: 0,
    sta: 1.5,
  },
  skills: {
    'assassin.melee': 1, // 攻击
    'assassin.thump': 2, // 剔骨
    'assassin.blood': 4, // 血债血偿
    'assassin.kick': 6, // 刀扇
    'assassin.daggerFan': 8, // 刀扇
    'assassin.ambush': 10, // 伏击
    'assassin.cutting': 12, // 切割
    mortalStrike: 14, // 致死打击
    'assassin.coherentExtrapolated': 16, // 连贯意志
    'assassin.swordSkill': 18, // 狂热
    'assassin.summonPuppet': 20,
    'assassin.thumpHead': 22, // 击颅
    'assassin.dodge': 24, // 闪避
  },
  passives: {
    atkByDex: 1,
    energy: 4,
  },
  enhances: {
    // 机敏： +25%闪避
    // 迅捷： +25%能量恢复速度
    'assassin.sharp': 10,
    'assassin.speed': 10,
    weaponMastery: 15,
    'assassin.dexBeleive': 15,
    'assassin.protect': 20,
    'assassin.atkFromStr': 20,
    'assassin.prevertDeath': 30,
  },
  availableClasses: {
    base: true,
    sword: true, // 剑
    dagger: true,
    cloth: true, // 布甲
    armor: true,
    ornament: true,
  },
};

})();

// ── 原 data/careers/knight.js ──
const __careers_3 = ((): CareerEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'knight',
  name: '圣骑士',
  description: '圣光谦卑的仆从，谦卑，怜悯。',
  requirement: {
    role: 'Eyer',
    stories: ['chapter3-5'],
  },
  equipments: {
    weapon: 'stickSword',
  },
  expFormula: [2, 10, -4, 2, 0.3],
  attrGrow: {
    str: 1.5,
    dex: 1,
    int: 0,
    sta: 1.5,
  },
  skills: {
    'knight.melee': 1,
    'knight.thump': 2,
    'knight.glory': 4,
    'knight.cleave': 6,
    'knight.sacrifice': 8,
    'knight.holySign': 10,
    'knight.thumpHead': 12,
    'knight.whirlwind': 14,
    'knight.damageSign': 16,
    'knight.reflect': 18,
    'knight.holyShield': 20,
    'knight.pray': 22,
    'knight.melee1': 24,
    'knight.kick': 28,
    'knight.deserve': 40,
  },
  passives: {
    'atkByStr': 1,
  },
  enhances: {
    'knight.protectBelieve': 10,
    'knight.attackBelieve': 10,
    'weaponMastery': 15,
    'knight.spirit': 15,
    'knight.talking': 20,
    'knight.recharge': 20,
    'knight.absorb': 25,
    'knight.defense': 25,
  },
  availableClasses: {
    base: true,
    sword: true,    // 剑
    cloth: true,    // 布甲
    armor: true,
    ornament: true,
  },
};

})();

// ── 原 data/careers/elementSummoner.js ──
const __careers_4 = ((): CareerEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'elementSommoner',
  name: '元素召唤师',
  description: '与精灵签订契约就职魔法少女，掌握超自然的力量以击败魔族。',
  requirement: {
    role: 'Aleanor',
    stories: ['chapter3-5'],
  },
  equipments: {
    weapon: 'stickWand',
  },
  expFormula: [2, 10, -4, 2, 0.3],
  skills: {
    summonWindBlade: 1,
    summonFire: 2,
    summonWater: 4,
    explodeSummons: 6,
    burning: 8,
    summonEarth: 10,
    counterSpelling: 12,
    healthDrill: 14,
    iceLance: 16,
    awaking: 18,
    'summon.disappear': 20,
    summonLightning: 22,
    transform: 24,
    'summon.upgrade': 30,
  },
  passives: {
    magic: 2,
  },
  enhances: {
    thinking: 10,
    longLive: 10,
    summonCount: 15,
    // summonBack: 15,
    manaExchange: 25,
  },
  availableClasses: {
    base: true,
    wand: true,    // 法杖
    cloth: true,    // 布甲
    ornament: true,
  },
  attrGrow: {
    str: 0,
    dex: 1,
    int: 2,
    sta: 1,
  },
};

})();

export const careers: Record<string, CareerEntry> = arrayToMap([
  __careers_0,
  __careers_1,
  __careers_2,
  __careers_3,
  __careers_4,
]);
