/**
 * ⚠️ 由原版 `data/packages/nightmare/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 随机一律走注入的 `Rng` 端口，本文件**零** `Math.random()`：
 *    词缀 / 传奇的 `generate` 用形参 `rng`；技能 / buff / 强化 hook 用 `world.rng.skill`（标签 `'skill'`）。
 */

import type { MutableDataTables } from '../../contracts/data.js';
import { define, extend } from '../_util.js';

/**
 * 原版 `data/packages/nightmare/index.js` 的显式化：调用顺序 = require 顺序
 * （base → slime → wolf → kobold → undead → fire → knight）。
 *
 * 注意 `nightmare/knight.js` 里的 `for (i of 1..3)` 循环原样保留，
 * 其 `name` 表与模板字符串 key 都依赖循环变量。
 */
export function registerNightmare(tables: MutableDataTables): void {
// ── packages/nightmare/base.js ──
/**
 * Created by tdzl2003 on 27/08/2017.
 */


define(tables, 'buffs', 'bossState', {
  name: 'BOSS阶段',
  hidden: true,
  description: 'BOSS阶段',
  hooks: {
    bossState(value) {
      return this.arg;
    }
  },
});

define(tables, 'skills', 'bossState', {
  name: '转换阶段',
  group: 'boss',
  description: 'BOSS转换阶段',
  coolDown: 1,
  maxExp: (level) => 0,
  canUse(world, self, level) {
    if (self.runAttrHooks(100, 'bossState') <= level) {
      return false;
    }
    const cur = self.hp / self.maxHp * 100;
    return cur <= level;
  },
  effect(world, self, level) {
    self.addBuff('bossState', null, level, 'bossState');
  }
});

// ── packages/nightmare/slime.js ──
/**
 * Created by tdzl2003 on 27/08/2017.
 */



define(tables, 'buffs', 'nightmare.slime.queen.debuff.1', {
  name: '粘液',
  description: '所有行动减缓20%。',
  hooks: {
    speedRateMul: (val) => val * 0.8,
  },
});

extend(tables, 'buffs', 'nightmare.slime.queen.buff.1', 'manaShield', {
  name: '黏性外壳',
  hooks: {
    hasShield() {
      return function (val) {
        return true;
      };
    },
  },
});

define(tables, 'skills', 'nightmare.slime.queue.1', {
  name: '粘液',
  coolDown: 10000,
  castTime: 300,
  canUse(world, self) {
    return true;
  },
  effect(world, self, level) {
    for (const target of world.units.filter((v) => self.willAttack(v))) {
      world.sendDamage('melee', self, target, this, 5000, true);
      target.addBuff('nightmare.slime.queen.debuff.1', 5000);
    }
  },
});

define(tables, 'buffs', 'nightmare.slime.queue.2', {
  name: '组合',
  hooks: {},
  willRemove(world) {
    let value = 1000000;
    for (const unit of world.units) {
      if (unit.type === 'nightmare.slime.minium') {
        unit.kill();
        value += 1500000;
      }
    }
    this.unit.addBuff('nightmare.slime.queen.buff.1', null, value);
  },
});

define(tables, 'skills', 'nightmare.slime.queue.2', {
  name: '分裂',
  castTime: 300,
  notBreakable: true,
  canUse(world, self) {
    return !self.runAttrHooks(false, 'hasShield');
  },
  effect(world, self, level) {
    for (let i = 0; i < 10; i++) {
      world.addEnemy('nightmare.slime.minium', null, 0, self);
    }
    self.startRead('nightmare.slime.queue.2', 15000);
  },
});

define(tables, 'skills', 'nightmare.slime.queue.3', {
  name: '召唤组合体',
  castTime: 300,
  coolDown: 15000,
  notBreakable: true,
  canUse(world, self) {
    return self.runAttrHooks(100, 'bossState') <= 50;
  },
  effect(world, self, level) {
    world.addEnemy('nightmare.slime.minium1', null, 0, self);
  },
});

define(tables, 'skills', 'nightmare.slime.queue.3.1', {
  name: '组合',
  castTime: 10000,
  notBreakable: true,
  effect(world, self, level) {
    for (const unit of world.units) {
      if (unit.type === 'nightmare.slime.queen') {
        unit.hp += unit.maxHp / 4;
      }
    }
    self.kill();
  },
});

define(tables, 'skills', 'nightmare.slime.queue.4', {
  name: '召唤不稳定的组合体',
  castTime: 300,
  coolDown: 15000,
  notBreakable: true,
  canUse(world, self) {
    return self.runAttrHooks(100, 'bossState') === 20;
  },
  effect(world, self, level) {
    world.addEnemy('nightmare.slime.minium2', null, 0, self);
  },
});

define(tables, 'skills', 'nightmare.slime.queue.4.1', {
  name: '不稳定的组合',
  castTime: 10000,
  notBreakable: true,
  effect(world, self, level) {
    for (const unit of world.units) {
      if (unit.type === 'nightmare.slime.queen') {
        unit.hp += unit.maxHp / 4;
        self.addBuff('enemy.upgrade');
        self.addBuff('enemy.upgrade');
      }
    }
    self.kill();
  },
});

define(tables, 'enemies', 'nightmare.slime.minium', {
  name: '巨型史莱姆',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 2500000,
  exp: 2400,
  atk: 3000,
  level: 250,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
  ],
});

define(tables, 'enemies', 'nightmare.slime.minium1', {
  name: '史莱姆组合体',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 16000000,
  exp: 2400,
  atk: 2000,
  level: 250,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'nightmare.slime.queue.3.1',
      level: 0,
    },
  ],
});

define(tables, 'enemies', 'nightmare.slime.minium2', {
  name: '史莱姆组合体',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 16000000,
  exp: 2400,
  atk: 2000,
  level: 250,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'nightmare.slime.queue.4.1',
      level: 0,
    },
  ],
});

define(tables, 'enemies', 'nightmare.slime.queen', {
  name: '史莱姆王后',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 80000000,
  def: 100,
  allResist: 50,
  exp: 2400,
  atk: 15000,
  level: 250,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'enemy.upgrade',
      level: 0,
    },
    {
      key: 'nightmare.slime.queue.1',
      level: 0,
    },
    {
      key: 'nightmare.slime.queue.2',
      level: 0,
    },
    {
      key: 'nightmare.slime.queue.3',
      level: 0,
    },
    {
      key: 'nightmare.slime.queue.4',
      level: 0,
    },
    {
      key: 'bossState',
      level: 50,
    },
    {
      key: 'bossState',
      level: 20,
    },
  ],
  hooks: {
    appeared(world, value) {
      this.addBuff('nightmare.slime.queen.buff.1', null, 16000000);
    },
  },
  stunResist: 20000,
  loots: [
    {
      key: 'gold',
      count: [1, 100],
      rate: 0.25,
    },  ],
});

define(tables, 'maps', 'nightmare.slime', {
  name: '噩梦-母体史莱姆',
  isDungeon: true,
  isEndless: true,
  outside: 'home',
  group: 'nightmare.1',
  requirement: {
    atLeastMaxLevel: 70,
  },
  phases: [
    {
      description: '击败噩梦中再次出现的母体史莱姆。',
      monsters: [
        {
          type: 'nightmare.slime.queen',
          total: 1,
        },
      ],
    },
  ],
  stunResist: 10000,
  resetPrice: 250,
  level: 250,
  exp: 5000000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [150000, 250000],
    },    {
      key: 'year2018.redbag',
      count: [1, 1],
      rate: 0.1,
    },
  ],
});

// ── packages/nightmare/wolf.js ──
/**
 * Created by tdzl2003 on 27/08/2017.
 */



define(tables, 'skills', 'nightmare.wolf.hunter', {
  name: '召唤陷阱',
  castTime: 25000,
  canUse(world, self) {
    return !world.units.find((v) => v.type === 'nightmare.wolf.hunter.trigger');
  },
  effect(world, self, level) {
    world.addEnemy('nightmare.wolf.hunter.trigger', null, 0, self);
  },
});

define(tables, 'enemies', 'nightmare.wolf.hunter', {
  name: '老练的猎人',
  description: '的',
  camp: 'shrine',
  race: 'unknown',
  career: 'melee',
  skills: [
    {
      key: 'nightmare.wolf.hunter',
      level: 0,
    },
  ],
});

define(tables, 'enemies', 'nightmare.wolf.hunter.trigger', {
  name: '陷阱',
  description: '的',
  camp: 'shrine',
  race: 'unknown',
  career: 'melee',
  onPress(world) {
    for (const unit of world.units) {
      if (unit.type === 'nightmare.wolf.king') {
        unit.stun(5, 'stunned', true);
      }
    }
    this.kill();
  },
});

define(tables, 'enemies', 'nightmare.wolf.healer', {
  name: '母狼',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 2500000,
  exp: 2400,
  atk: 2000,
  level: 250,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'wolf.heal',
      level: 8000000,
    },
  ],
});

define(tables, 'enemies', 'nightmare.wolf.minium', {
  name: '公狼',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 2500000,
  exp: 2400,
  atk: 2000,
  level: 250,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'wolf.worry',
      level: 0,
    },
  ],
});

extend(tables, 'skills', 'nightmare.wolf.1', 'wolf.call', {
  coolDown: 30000,
  notBreakable: true,
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 75) {
        return false;
      }
      return origin.call(this, world, self);
    };
  },
  effect() {
    return function (world, self, level) {
      world.sendSkillUsage(self, null, this);
      world.addEnemy('nightmare.wolf.healer', null, 0, self);
      world.addEnemy('nightmare.wolf.minium', null, 0, self);
      world.addEnemy('nightmare.wolf.minium', null, 0, self);
    };
  },
});

extend(tables, 'skills', 'nightmare.wolf.2', 'knight.melee1', {
  name: '爪击',
  coolDown: 2000,
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 50) {
        return false;
      }
      return origin.call(this, world, self);
    };
  },
});

extend(tables, 'skills', 'nightmare.wolf.3', 'rosa.angry', {
  name: '嗜血',
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 25) {
        return false;
      }
      return origin.call(this, world, self);
    };
  },
});

define(tables, 'enemies', 'nightmare.wolf.king', {
  name: '白鬃狼王',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 160000000,
  def: 100,
  allResist: 50,
  exp: 2400,
  atk: 20000,
  level: 250,
  atkSpeed: 0.8,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'enemy.upgrade',
      level: 0,
    },
    {
      key: 'nightmare.wolf.1',
      level: 0,
    },
    {
      key: 'nightmare.wolf.2',
      level: 0,
    },
    {
      key: 'nightmare.wolf.3',
      level: 0,
    },
    {
      key: 'bossState',
      level: 75,
    },
    {
      key: 'bossState',
      level: 50,
    },
    {
      key: 'bossState',
      level: 20,
    },
  ],
  stunResist: 20000,
  loots: [
    {
      key: 'gold',
      count: [1, 100],
      rate: 0.25,
    },  ],
});

define(tables, 'maps', 'nightmare.wolf', {
  name: '噩梦-狼王',
  isDungeon: true,
  isEndless: true,
  outside: 'home',
  group: 'nightmare.1',
  requirement: {
    atLeastMaxLevel: 70,
  },
  phases: [
    {
      description: '击败噩梦中再次出现的狼王。',
      monsters: [
        {
          type: 'nightmare.wolf.hunter',
          max: 1,
          delay: 10,
        },
        {
          type: 'nightmare.wolf.king',
          total: 1,
        },
      ],
    },
  ],
  stunResist: 10000,
  resetPrice: 250,
  level: 250,
  exp: 5000000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [150000, 250000],
    },    {
      key: 'year2018.redbag',
      count: [1, 1],
      rate: 0.1,
    },
  ],
});

// ── packages/nightmare/kobold.js ──
/**
 * Created by tdzl2003 on 27/08/2017.
 */



define(tables, 'enemies', 'nightmare.kobold.candle', {
  name: '安全牌蜡烛',
  description: '一根蜡烛。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 2500000,
  exp: 0,
  atk: 8000,
  level: 1,
  atkSpeed: 0.4,
  skills: [
    {
      key: 'nightmare.kobold.bomb',
      level: 0,
    },
  ],
});

extend(tables, 'skills', 'nightmare.kobold.bomb', 'bomb', {
  notBreakable: true,
});

extend(tables, 'skills', 'nightmare.kobold.bomb1', 'bomb', {
  notBreakable: true,
  effect(origin) {
    return function (world, self, level) {
      const targets = world.units.filter((v) => self.canAttack(v));
      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        world.sendDamage('fire', self, target, this, self.atk, false);
        target.stun(5);
      });
      self.kill();
    };
  },
});

define(tables, 'enemies', 'nightmare.kobold.candle.1', {
  name: '安全牌大蜡烛',
  description: '一根蜡烛。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 2500000,
  exp: 0,
  atk: 8000,
  level: 1,
  atkSpeed: 0.4,
  skills: [
    {
      key: 'nightmare.kobold.bomb1',
      level: 0,
    },
  ],
});

extend(tables, 'skills', 'nightmare.kobold.1', 'candle.call', {
  coolDown: 30000,
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') <= 50) {
        return false;
      }
      return origin.call(this, world, self);
    };
  },
  effect(origin) {
    return function (world, self, level) {
      world.sendSkillUsage(self, null, this);
      world.addEnemy('nightmare.kobold.candle', null, 0, self);
    };
  },
});

extend(tables, 'skills', 'nightmare.kobold.3', 'candle.call', {
  name: '驱散更多暗影',
  coolDown: 30000,
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 50) {
        return false;
      }
      return origin.call(this, world, self);
    };
  },
  effect(origin) {
    return function (world, self, level) {
      world.sendSkillUsage(self, null, this);
      world.addEnemy('nightmare.kobold.candle.1', null, 0, self);
    };
  },
});

define(tables, 'enemies', 'nightmare.kobold.altar', {
  name: '火焰祭坛',
  camp: 'shrine',
  race: 'unknown',
  career: 'melee',
  atk: 8000,
  onPress(world) {
    for (const unit of world.units) {
      if (unit.camp === 'player' || unit.camp === 'alien') {
        world.sendDamage('fire', this, unit, null, this.atk);
      }
    }
    this.kill();
  },
});

define(tables, 'buffs', 'nightmare.kobold.2.1', {
  name: '火焰献祭',
});

define(tables, 'buffs', 'nightmare.kobold.2.3', {
  name: '更多火焰献祭',
});

define(tables, 'buffs', 'nightmare.kobold.2.2', {
  name: '火焰献祭',
  didRemove(world) {
    for (const unit of world.units) {
      if (unit.camp === 'player' || unit.camp === 'alien') {
        world.sendDamage('fire', this.unit, unit, null, this.unit.atk * 5);
      }
    }
    this.unit.kill();
  },
});

define(tables, 'skills', 'nightmare.kobold.2', {
  name: '火焰献祭',
  coolDown: 15000,
  notBreakable: true,
  canUse(world, self) {
    const state = self.runAttrHooks(100, 'bossState');
    if (state <= 20 || state > 75) {
      return false;
    }
    return !!world.units.find((v) => v.key === 'nightmare.kobold.altar');
  },
  effect(world, self, level) {
    const target = world.units.find((v) => v.type === 'nightmare.kobold.altar')!;
    target.startRead('nightmare.kobold.2.2', 5000, null, this);
    self.startRead('nightmare.kobold.2.1', 5000, null, this);
  },
});

define(tables, 'skills', 'nightmare.kobold.4', {
  name: '更多火焰献祭',
  coolDown: 15000,
  notBreakable: true,
  canUse(world, self) {
    if (self.runAttrHooks(100, 'bossState') > 20) {
      return false;
    }
    return !!world.units.find((v) => v.type === 'nightmare.kobold.altar');
  },
  effect(world, self, level) {
    for (const target of world.units.filter(
      (v) => v.type === 'nightmare.kobold.altar'
    )) {
      target.startRead('nightmare.kobold.2.2', 5000, null, this);
    }
    self.startRead('nightmare.kobold.2.3', 5000, null, this);
  },
});

define(tables, 'enemies', 'nightmare.kobold.king', {
  name: '金牙大王',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 160000000,
  def: 100,
  allResist: 50,
  exp: 2400,
  atk: 10000,
  level: 250,
  atkSpeed: 0.4,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'shaman.fireball',
      level: 0,
    },
    {
      key: 'nightmare.kobold.1',
      level: 0,
    },
    {
      key: 'nightmare.kobold.2',
      level: 0,
    },
    {
      key: 'nightmare.kobold.3',
      level: 0,
    },
    {
      key: 'nightmare.kobold.4',
      level: 0,
    },
    {
      key: 'enemy.upgrade',
      level: 0,
    },
    {
      key: 'bossState',
      level: 75,
    },
    {
      key: 'bossState',
      level: 50,
    },
    {
      key: 'bossState',
      level: 20,
    },
  ],
  stunResist: 20000,
  loots: [
    {
      key: 'gold',
      count: [1, 100],
      rate: 0.25,
    },  ],
});

define(tables, 'maps', 'nightmare.kobold', {
  name: '噩梦-金牙',
  isDungeon: true,
  isEndless: true,
  outside: 'home',
  group: 'nightmare.1',
  requirement: {
    atLeastMaxLevel: 70,
  },
  phases: [
    {
      description: '击败噩梦中再次出现的狗头人金牙。',
      monsters: [
        {
          type: 'nightmare.kobold.altar',
          max: 5,
          delay: 3000,
        },
        {
          type: 'nightmare.kobold.king',
          total: 1,
        },
      ],
    },
  ],
  stunResist: 10000,
  resetPrice: 250,
  level: 250,
  exp: 5000000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [150000, 250000],
    },    {
      key: 'year2018.redbag',
      count: [1, 1],
      rate: 0.1,
    },
  ],
});

// ── packages/nightmare/undead.js ──
/**
 * Created by tdzl2003 on 27/08/2017.
 */



define(tables, 'enemies', 'nightmare.undead.minimal', {
  name: '重生的僵尸',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 5000000,
  exp: 2400,
  atk: 3000,
  level: 250,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
  ],
});

define(tables, 'skills', 'nightmare.undead.1', {
  name: '毒爆',
  coolDown: 15000,
  castTime: 5000,
  antiBreak: 0.8,
  canUse(world, self) {
    const state = self.runAttrHooks(100, 'bossState');
    if (state > 75) {
      return false;
    }
    return !!world.units.find((v) => v.type === 'nightmare.undead.minimal');
  },
  effect(world, self, level) {
    const minimal = world.units.find(
      (v) => v.type === 'nightmare.undead.minimal'
    );
    if (!minimal) {
      return;
    }
    const val = minimal.hp / 100;
    minimal.kill();
    for (const target of world.units.filter((v) => self.willAttack(v))) {
      world.sendDamage('chaos', self, target, this, val, false);
    }
  },
});

define(tables, 'skills', 'nightmare.undead.2', {
  name: '暗影治疗',
  coolDown: 15000,
  castTime: 5000,
  antiBreak: 0.8,
  canUse(world, self) {
    const state = self.runAttrHooks(100, 'bossState');
    if (state > 50) {
      return false;
    }
    return !!world.units.find((v) => v.type === 'nightmare.undead.minimal');
  },
  effect(world, self, level) {
    for (const target of world.units.filter(
      (v) => v.type === 'nightmare.undead.minimal'
    )) {
      world.sendHeal(self, target, this, target.maxHp);
    }
  },
});

define(tables, 'skills', 'nightmare.undead.3', {
  name: '死亡一指',
  coolDown: 30000,
  castTime: 10000,
  antiBreak: 0.8,
  canUse(world, self) {
    const state = self.runAttrHooks(100, 'bossState');
    if (state > 20) {
      return false;
    }
    return true;
  },
  effect(world, self, level) {
    const target = world.playerUnit;
    if (target.camp !== 'ghost') {
      target.kill();
    }
  },
});

define(tables, 'enemies', 'nightmare.undead.king', {
  name: '亡者统帅奈布',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 160000000,
  def: 100,
  allResist: 50,
  exp: 2400,
  atk: 10000,
  level: 250,
  atkSpeed: 0.4,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'shaman.darkball',
      level: 0,
    },
    {
      key: 'nightmare.undead.1',
      level: 0,
    },
    {
      key: 'nightmare.undead.2',
      level: 0,
    },
    {
      key: 'nightmare.undead.3',
      level: 0,
    },
    {
      key: 'enemy.upgrade',
      level: 0,
    },
    {
      key: 'bossState',
      level: 75,
    },
    {
      key: 'bossState',
      level: 50,
    },
    {
      key: 'bossState',
      level: 20,
    },
  ],
  stunResist: 20000,
  loots: [
    {
      key: 'gold',
      count: [1, 100],
      rate: 0.25,
    },  ],
});

define(tables, 'maps', 'nightmare.undead', {
  name: '噩梦-奈布',
  isDungeon: true,
  isEndless: true,
  outside: 'home',
  group: 'nightmare.1',
  requirement: {
    atLeastMaxLevel: 70,
  },
  phases: [
    {
      description: '击败噩梦中再次出现的死灵法师奈布。',
      monsters: [
        {
          type: 'nightmare.undead.minimal',
          max: 10,
          delay: 5000,
        },
        {
          type: 'nightmare.undead.king',
          total: 1,
        },
      ],
    },
  ],
  stunResist: 10000,
  resetPrice: 250,
  level: 250,
  exp: 5000000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [150000, 250000],
    },    {
      key: 'year2018.redbag',
      count: [1, 1],
      rate: 0.1,
    },
  ],
});

// ── packages/nightmare/fire.js ──
/**
 * Created by tdzl2003 on 27/08/2017.
 */



define(tables, 'skills', 'nightmare.fire.kakarif.1', {
  name: '地震',
  coolDown: 15000,
  castTime: 1000,
  notBreakable: true,
  canUse(world, self) {
    return true;
  },
  effect(world, self, level) {
    for (const target of world.units.filter((v) => self.willAttack(v))) {
      world.sendDamage('melee', self, target, this, self.atk, true);
    }
  },
});

define(tables, 'skills', 'nightmare.fire.kakarif.2', {
  name: '火狱之楔',
  coolDown: 30000,
  castTime: 1000,
  notBreakable: true,
  canUse(world, self) {
    if (self.runAttrHooks(100, 'bossState') > 75) {
      return false;
    }
    return true;
  },
  effect(world, self, level) {
    let dmg = self.atk;
    for (const target of world.units.filter(
      (v) => v.type === 'nightmare.fire.minimal'
    )) {
      target.kill();
      dmg += self.atk;
    }
    for (let i = 0; i < 8; i++) {
      world.addEnemy('nightmare.fire.minimal', null, 0, self);
    }
    for (const target of world.units.filter((v) => self.willAttack(v))) {
      world.sendDamage('fire', self, target, this, dmg / 2, true);
    }
  },
});

define(tables, 'buffs', 'nightmare.fire.kakarif.3', {
  name: '烈焰之子',
  effectInterval: 500,
  effect(world) {
    world.addEnemy('nightmare.fire.minimal1', null, 0, this.unit);
  },
});

define(tables, 'skills', 'nightmare.fire.kakarif.3', {
  name: '烈焰之子',
  coolDown: 30000,
  notBreakable: true,
  canUse(world, self) {
    if (self.runAttrHooks(100, 'bossState') > 50) {
      return false;
    }
    return true;
  },
  effect(world, self, level) {
    self.startRead('nightmare.fire.kakarif.3', 10000, null, this);
  },
});

define(tables, 'buffs', 'nightmare.fire.kakarif.4', {
  name: '元素怒火',
  effectInterval: 1000,
  effect(world) {
    world.sendDamage('fire', null, this.unit, null, this.arg, false);
  },
});

define(tables, 'skills', 'nightmare.fire.kakarif.4', {
  name: '元素怒火',
  coolDown: 30000,
  castTime: 1000,
  notBreakable: true,
  canUse(world, self) {
    if (self.runAttrHooks(100, 'bossState') > 50) {
      return false;
    }
    return !!self.target;
  },
  effect(world, self, level) {
    const { target } = self;
    world.sendSkillUsage(self, [target], this);
    target.addBuff('nightmare.fire.kakarif.4', 10000, self.atk, null);
  },
});

define(tables, 'skills', 'nightmare.fire.kakarif.5', {
  name: '卡卡列夫之怒',
  description: '增加300%攻击速度，持续6秒。',
  targetType: 'target',
  castTime: 2000,
  coolDown: 30000,
  nonBreakable: true,
  canUse(world, self) {
    if (self.runAttrHooks(100, 'bossState') > 25) {
      return false;
    }
    return !!self.target;
  },
  effect(world, self, level) {
    self.addBuff('kakarif.mad', 6000, null, 'kakarif.mad');
  },
});

define(tables, 'enemies', 'nightmare.fire.minimal', {
  name: '火狱之楔',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 15000000,
  exp: 2400,
  atk: 3000,
  level: 285,
  atkSpeed: 0.6,
  skills: [],
});

define(tables, 'enemies', 'nightmare.fire.minimal1', {
  name: '卡卡列夫之子',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 15000000,
  exp: 2400,
  atk: 3000,
  level: 285,
  atkSpeed: 0.6,
  skills: [
    {
      key: 'fireElement.fireball',
      level: 0,
    },
  ],
});

define(tables, 'enemies', 'nightmare.fire.kakarif', {
  name: '烈焰领主卡卡列夫',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 160000000,
  def: 100,
  allResist: 50,
  exp: 2400,
  atk: 15000,
  level: 285,
  atkSpeed: 0.4,
  skills: [
    {
      key: 'kakarif.melee',
      level: 0,
    },
    {
      key: 'nightmare.fire.kakarif.1',
      level: 0,
    },
    {
      key: 'nightmare.fire.kakarif.2',
      level: 0,
    },
    {
      key: 'nightmare.fire.kakarif.3',
      level: 0,
    },
    {
      key: 'nightmare.fire.kakarif.4',
      level: 0,
    },
    {
      key: 'nightmare.fire.kakarif.5',
      level: 0,
    },
    {
      key: 'enemy.upgrade',
      level: 0,
    },
    {
      key: 'bossState',
      level: 75,
    },
    {
      key: 'bossState',
      level: 50,
    },
    {
      key: 'bossState',
      level: 20,
    },
  ],
  stunResist: 40000,
  loots: [
    {
      key: 'gold',
      count: [1, 100],
      rate: 0.25,
    },  ],
});

define(tables, 'maps', 'nightmare.fire', {
  name: '噩梦-卡卡列夫',
  isDungeon: true,
  isEndless: true,
  outside: 'home',
  group: 'nightmare.2',
  requirement: {
    atLeastMaxLevel: 70,
  },
  phases: [
    {
      description: '击败噩梦中再次出现的烈焰领主卡卡列夫。',
      monsters: [
        {
          type: 'nightmare.fire.kakarif',
          total: 1,
        },
      ],
    },
  ],
  stunResist: 10000,
  resetPrice: 250,
  level: 250,
  exp: 5000000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [250000, 500000],
    },    {
      key: 'year2018.redbag',
      count: [1, 1],
      rate: 0.1,
    },
  ],
});

// ── packages/nightmare/knight.js ──
/**
 * Created by tdzl2003 on 27/08/2017.
 */



extend(tables, 'buffs', 'nightmare.knight.buff.1', 'manaShield', {
  name: '盾墙',
  hooks: {
    hasShield() {
      return function (val) {
        return true;
      };
    },
  },
});

define(tables, 'buffs', 'nightmare.knight.buff.2', {
  name: '盾姿',
  hooks: {
    hasShield() {
      return true;
    },
    willDamaged(val, from, type) {
      if (type === 'melee') {
        return val / 4;
      }
      return val;
    },
  },
});

define(tables, 'buffs', 'nightmare.knight.buff.3', {
  name: '盾反',
  hooks: {
    hasShield() {
      return true;
    },
    willDamaged(val, from, type) {
      if (type !== 'melee' && type !== 'real') {
        return 0;
      }
      return val;
    },
  },
});

const names = ['盾墙', '盾姿', '盾反'];

for (let i = 1; i <= 3; i++) {
  define(tables, 'skills', `nightmare.knight.${i}`, {
    name: names[i],
    castTime: 300,
    coolDown: 30000,
    antiBreak: 0.5,
    canUse(world, self) {
      if (self.runAttrHooks(100, 'bossState') > 75) {
        return false;
      }
      return !self.runAttrHooks(false, 'hasShield');
    },
    effect(world, self, level) {
      self.addBuff(`nightmare.knight.buff.${i}`, 10000, self.hp / 8);
    },
  });
}

extend(tables, 'skills', 'nightmare.knight.4', 'knight.melee1', {
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 50) {
        return false;
      }
      return origin(world, self);
    };
  },
});

extend(tables, 'skills', 'nightmare.knight.5', 'knight.deserve', {
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 50) {
        return false;
      }
      return origin(world, self);
    };
  },
});

extend(tables, 'skills', 'nightmare.knight.6', 'knight.heal', {
  antiBreak: 0.5,
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 50) {
        return false;
      }
      return origin(world, self);
    };
  },
  effect() {
    return function (world, self, level) {
      world.sendSkillUsage(self, [self], this);
      self.hp += self.maxHp / 16;
    };
  },
});

extend(tables, 'skills', 'nightmare.knight.7', 'knight.thumpHead.enemy', {
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 25) {
        return false;
      }
      return origin(world, self);
    };
  },
});

extend(tables, 'skills', 'nightmare.knight.8', 'shockWave', {
  name: '神圣愤怒',
  castTime: 3000,
  antiBreak: 0.5,
  canUse(origin) {
    return function (world, self) {
      if (self.runAttrHooks(100, 'bossState') > 25) {
        return false;
      }
      return origin(world, self);
    };
  },
});

define(tables, 'enemies', 'nightmare.knight.boss', {
  name: '皇家骑士队长卡罗',
  description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
  camp: 'enemy',
  race: 'unknown',
  career: 'melee',
  maxHp: 160000000,
  def: 100,
  allResist: 50,
  exp: 2400,
  atk: 15000,
  level: 285,
  atkSpeed: 0.8,
  skills: [
    {
      key: 'melee',
      level: 0,
    },
    {
      key: 'enemy.upgrade',
      level: 0,
    },
    {
      key: 'nightmare.knight.1',
      level: 0,
    },
    {
      key: 'nightmare.knight.2',
      level: 0,
    },
    {
      key: 'nightmare.knight.3',
      level: 0,
    },
    {
      key: 'nightmare.knight.4',
      level: 0,
    },
    {
      key: 'nightmare.knight.5',
      level: 0,
    },
    {
      key: 'nightmare.knight.6',
      level: 0,
    },
    {
      key: 'nightmare.knight.7',
      level: 0,
    },
    {
      key: 'nightmare.knight.8',
      level: 6,
    },
    {
      key: 'bossState',
      level: 75,
    },
    {
      key: 'bossState',
      level: 50,
    },
    {
      key: 'bossState',
      level: 20,
    },
  ],
  stunResist: 40000,
  loots: [
    {
      key: 'gold',
      count: [1, 100],
      rate: 0.25,
    },  ],
});

define(tables, 'maps', 'nightmare.knight', {
  name: '噩梦-卡罗',
  isDungeon: true,
  isEndless: true,
  outside: 'home',
  group: 'nightmare.2',
  requirement: {
    atLeastMaxLevel: 70,
  },
  phases: [
    {
      description: '击败噩梦中再次出现的皇家骑士队长卡罗。',
      monsters: [
        {
          type: 'nightmare.knight.boss',
          total: 1,
        },
      ],
    },
  ],
  stunResist: 10000,
  resetPrice: 250,
  level: 250,
  exp: 5000000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [250000, 500000],
    },    {
      key: 'year2018.redbag',
      count: [1, 1],
      rate: 0.1,
    },
  ],
});

}
