/**
 * ⚠️ 由原版 `data/packages/year2018/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 词缀 / 传奇的 `generate(level)` 改为 `generate(level, rng)`，内部 `Math.random()` → `rng()`。
 */

import type { MutableDataTables } from '../../contracts/data.js';
import { define, extend } from '../_util.js';

/**
 * 原版 `data/packages/year2018/index.js` 的显式化：顺序 = require 顺序
 * （legends → redbag → dungeon），且注释明确「活动副本不掉落红包，所以顺序很重要」——
 * redbag 会给**当时已注册的**所有 enemies / maps 追加红包掉落，因此必须在 dungeon 之前。
 */
export function registerYear2018(tables: MutableDataTables): void {
// ── packages/year2018/legends.js ──

define(tables, 'buffs', 'year2018.yearBeastWeapon-1-Buff', {
  name: '蓄能',
  description: '蓄能3次后的下一次技能增加100%暴击几率和伤害',
});

define(tables, 'buffs', 'year2018.yearBeastWeapon-1-Buff2', {
  name: '充能完毕',
  description: '下一次技能增加100%暴击几率和伤害',
  hooks: {
    critRate: (val) => val + 1,
    critBonus: (val) => val + 1,
    postSkillEffect() {
      const { unit } = this;
      unit.removeBuff(this);
    },
  },
});

define(tables, 'legends', 'year2018.yearBeastWeapon-1', {
  type: 'boneWand',
  itemName: '年兽的小腿骨',
  itemDescription: '上面的肉去哪儿了？',
  special: true,
  minLevel: 1,
  display: (effect) =>
    '每释放三个技能，使你下一个技能的暴击几率和暴击伤害增加100%',
  generate(level) {
    return 1;
  },
  range(level) {
    return 1;
  },
  hooks: {
    postSkillEffect() {
      const buffs = this.buffs.filter(
        (v) => v.type === 'year2018.yearBeastWeapon-1-Buff'
      );
      if (buffs.length >= 2) {
        // 第三个技能
        for (const buff of buffs) {
          this.removeBuff(buff);
        }
        this.timeline.setTimeout(() => {
          this.addBuff('year2018.yearBeastWeapon-1-Buff2');
        }, 0);
      } else {
        this.addBuff('year2018.yearBeastWeapon-1-Buff');
      }
    },
  },
});

define(tables, 'legends', 'year2018.yearBeastWeapon-2', {
  type: 'boneDagger',
  itemName: '年兽的利齿',
  itemDescription: '闪着锋利的寒光',
  minLevel: 1,
  special: true,
  display: (effect) => '额外增加100%暴击率',
  generate(level) {
    return 1;
  },
  range(level) {
    return 1;
  },
  hooks: {
    critRate: (_, v) => v + 1,
  },
});

define(tables, 'legends', 'year2018.yearBeastWeapon-3', {
  type: 'wolfTeethMace',
  itemName: '年兽的大腿骨',
  itemDescription: '上面的肉去哪儿了？嗝儿……',
  minLevel: 1,
  display: (effect) => '每层暴击使你接下来5秒内伤害增加10%。',
  special: true,
  generate(level) {
    return 1;
  },
  range(level) {
    return 1;
  },
  hooks: {
    testCrit(_, v) {
      if (v > 0) {
        this.addBuff('swordSkill', 5000, 0.1 * v);
      }
      return v;
    },
  },
});

define(tables, 'legends', 'year2018.yearBeastPlastron-1', {
  type: 'leatherArmor',
  itemName: '年兽的厚皮',
  itemDescription: '散发着硝烟的气息。',
  minLevel: 1,
  display: (effect) => '所有法术吸收+30%。',
  special: true,
  generate(level) {
    return 1;
  },
  range(level) {
    return 1;
  },
  hooks: {
    fireAbsorb: (_, v) => v + 0.3,
    darkAbsorb: (_, v) => v + 0.3,
    coldAbsorb: (_, v) => v + 0.3,
    lightningAbsorb: (_, v) => v + 0.3,
  },
});

define(tables, 'legends', 'year2018.yearBeastTrousers-1', {
  type: 'leatherTrousers',
  itemName: '年兽的皮裤',
  itemDescription: '再胖的人都穿得上。',
  minLevel: 1,
  display: (effect) => '所有法术吸收+20%。',
  special: true,
  generate(level) {
    return 1;
  },
  range(level) {
    return 1;
  },
  hooks: {
    fireAbsorb: (_, v) => v + 0.2,
    darkAbsorb: (_, v) => v + 0.2,
    coldAbsorb: (_, v) => v + 0.2,
    lightningAbsorb: (_, v) => v + 0.2,
  },
});

define(tables, 'legends', 'year2018.yearBeastPlastron-2', {
  type: 'leatherDress',
  itemName: '年兽的毛衣',
  itemDescription: '散发着硝烟的气息。',
  minLevel: 1,
  display: (effect) => '物理伤害吸收+30%。',
  special: true,
  generate(level) {
    return 1;
  },
  range(level) {
    return 1;
  },
  hooks: {
    meleeAbsorb: (_, v) => v + 0.3,
  },
});

define(tables, 'legends', 'year2018.yearBeastTrousers-2', {
  type: 'leatherSkirt',
  itemName: '年兽的毛裤',
  itemDescription: '再胖的人都穿得上。',
  minLevel: 1,
  display: (effect) => '物理伤害吸收+20%。',
  special: true,
  generate(level) {
    return 1;
  },
  range(level) {
    return 1;
  },
  hooks: {
    meleeAbsorb: (_, v) => v + 0.2,
  },
});

define(tables, 'legends', 'year2018.yearBeastHeart', {
  type: 'zombieHeart',
  itemName: '年兽的心脏',
  itemDescription: '蕴含着时间的力量。',
  minLevel: 1,
  display: (effect) => '所有行动速度增加20%。',
  special: true,
  generate(level) {
    return 1;
  },
  range(level) {
    return 1;
  },
  hooks: {
    speedRateMul: (_, v) => v * 1.2,
  },
});

// ── packages/year2018/redbag.js ──

define(tables, 'goods', 'year2018.redbag', {
  type: 'package',
  name: '红包',
  description: '兔年吉祥，新年快乐！',
  stack: 999,
  price: 1,
  requireInventory: 2,
  backgroundColor: '#ff215b',
  nameColor: 'white',
  loots: [
    {
      key: 'diamonds',
      rate: 1,
      count: [1, 100],
    },
    {
      type: 'ticket',
      rate: 0.1,
      dungeons: {
        'year2018.dungeon': 1,
      },
    },
    {
      type: 'specialEquip',
      rate: 0.2,
      items: [
        'year2018.yearBeastWeapon-1',
        'year2018.yearBeastWeapon-2',
        'year2018.yearBeastWeapon-3',
        'year2018.yearBeastPlastron-1',
        'year2018.yearBeastPlastron-2',
        'year2018.yearBeastTrousers-1',
        'year2018.yearBeastTrousers-2',
        'year2018.yearBeastHeart',
      ],
    },
  ],
});

const enemies = tables.enemies;
const maps = tables.maps;

for (const key of Object.keys(enemies)) {
  const enemy = enemies[key];
  if (!enemy) continue;
  if (enemy.loots) {
    enemy.loots.push({
      key: 'year2018.redbag',
      count: [1, 1],
      rate: 0.0001,
    });
  }
}

for (const key of Object.keys(maps)) {
  const map = maps[key];
  if (!map) continue;
  if (map.loots) {
    map.loots.push({
      key: 'year2018.redbag',
      count: [1, 1],
      rate: 0.1,
    });
  }
}

// ── packages/year2018/dungeon.js ──

extend(tables, 'skills', 'year2018.heal', 'wolf.heal', {
  canUse(origin) {
    return function (world, self) {
      const { summoner } = self;
      if (!summoner) {
        return false;
      }
      if (summoner.hp > summoner.maxHp * 0.25) {
        return false;
      }
      return true;
    };
  },
  effect() {
    return function (world, self, level) {
      const target = this.summoner;
      if (!target) {
        return;
      }
      world.sendSkillUsage(self, [target], this);
      target.hp += 10000000;
    };
  },
});

define(tables, 'enemies', 'year2018.minimal.fire', {
  name: '火·年兽幼崽',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 25000000,
  exp: 3000,
  atk: 5000,
  level: 300,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'shaman.fireball',
      level: 3,
    },
    {
      key: 'year2018.heal',
      level: 0,
    },
  ],
});

define(tables, 'enemies', 'year2018.minimal.cold', {
  name: '冰·年兽幼崽',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 25000000,
  exp: 3000,
  atk: 5000,
  level: 300,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'shaman.iceball',
      level: 3,
    },
    {
      key: 'year2018.heal',
      level: 0,
    },
  ],
});

define(tables, 'enemies', 'year2018.minimal.lightning', {
  name: '电·年兽幼崽',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 25000000,
  exp: 3000,
  atk: 5000,
  level: 300,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'shaman.chainingLightning',
      level: 3,
    },
    {
      key: 'year2018.heal',
      level: 0,
    },
  ],
});

extend(tables, 'skills', 'year2018.shockWave', 'shockWave', {
  coolDown: 30000,
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 75) {
        return false;
      }
      if (self.hp < self.maxHp * 0.25) {
        return false;
      }
      return origin ? origin(world, self) : true;
    };
  },
});

const MINIMALS = [
  'year2018.minimal.fire',
  'year2018.minimal.cold',
  'year2018.minimal.lightning',
];

extend(tables, 'buffs', 'year2018.summonMinimal', 'murloc.thumpHead', {
  name: '呼唤幼崽',
  effect() {
    return function (world) {
      const enemy = MINIMALS[Math.floor(Math.random() * 3)];
      world.addEnemy(enemy, null, 0, this.unit);
    };
  },
});

extend(tables, 'skills', 'year2018.summonMinimal', 'murloc.thumpHead', {
  name: '呼唤幼崽',
  castTime: 0,
  antiBreak: 0.9,
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 50) {
        return false;
      }
      return origin ? origin(world, self) : true;
    };
  },
  effect() {
    return function (world, self, level) {
      self.startRead('year2018.summonMinimal', 5001, null, this);
    };
  },
});

define(tables, 'enemies', 'year2018.boss', {
  name: '三头年兽',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 800000000,
  def: 120,
  allResist: 75,
  exp: 3200,
  atk: 20000,
  level: 300,
  atkSpeed: 0.8,
  stunResist: 40000,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'wolf.worry',
      level: 0,
    },
    {
      key: 'year2018.summonMinimal',
      level: 0,
    },
    {
      key: 'year2018.shockWave',
      level: 10,
    },
    {
      key: 'bossState',
      level: 75,
    },
    {
      key: 'bossState',
      level: 50,
    },
  ],
  hooks: {
    onSummonDeath() {
      this.addBuff('swordSkill', undefined, 0.01);
    },
    atkSpeedMul(world, value) {
      if (this.hp < this.maxHp * 0.25) {
        return value * 0.25;
      }
      return value;
    },
  },
});

define(tables, 'maps', 'year2018.dungeon', {
  name: '年兽巢穴',
  isDungeon: true,
  outside: 'home',
  requirement: {
    atLeastMaxLevel: 70,
  },
  phases: [
    {
      description: '沿着阴森的小路前进，寻找年兽的踪迹。',
      monsters: [
        {
          types: {
            'year2018.minimal.fire': 1,
            'year2018.minimal.cold': 1,
            'year2018.minimal.lightning': 1,
          },
          warmup: 1000,
          delay: 6000,
          max: 4,
          total: 10,
        },
      ],
    },
    {
      description: '击败洞穴中的三头巨兽。',
      monsters: [
        {
          type: 'year2018.boss',
          delay: 1e9,
          total: 1,
        },
      ],
    },
  ],
  level: 300,
  exp: 15000000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [300000, 600000],
    },
    {
      type: 'specialEquip',
      rate: 1,
      items: [
        'year2018.yearBeastWeapon-1',
        'year2018.yearBeastWeapon-2',
        'year2018.yearBeastWeapon-3',
        'year2018.yearBeastPlastron-1',
        'year2018.yearBeastPlastron-2',
        'year2018.yearBeastTrousers-1',
        'year2018.yearBeastTrousers-2',
        'year2018.yearBeastHeart',
      ],
    },
    {
      type: 'equip',
      rate: 1,
      mfRate: 200,
    },
    {
      type: 'equip',
      rate: 1,
      mfRate: 300,
    },
    {
      type: 'equip',
      rate: 1,
      mfRate: 500,
    },
  ],
});

}
