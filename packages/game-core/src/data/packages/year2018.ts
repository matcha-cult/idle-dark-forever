/**
 * ⚠️ 由原版 `data/packages/year2018/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
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
 * 原版 `data/packages/year2018/index.js` 的显式化：顺序 = require 顺序
 * （legends → redbag → dungeon），且注释明确「活动副本不掉落红包，所以顺序很重要」——
 * redbag 会给**当时已注册的**所有 enemies / maps 追加红包掉落，因此必须在 dungeon 之前。
 *
 * W6：旧 `year2018.dungeon`（年兽巢穴，属氪金秘境体系）已随副本 / 相位契约
 * 一并物理删除；依赖噩梦 `bossState` 的活动怪物/技能也同步移除。
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
        this.clock.setTimeout(() => {
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
    chaosAbsorb: (_, v) => v + 0.3,
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
    chaosAbsorb: (_, v) => v + 0.2,
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
      // ⚠️ 原版这里写的是 `this.summoner`，但引擎调用该 hook 时 `this` 是 **SkillState**
      // （`skill-state.ts#effect` 的 `skillData.effect.call(this, ...)`），而 `summoner`
      // 只存在于 `Unit` 上 ⇒ `this.summoner` 恒为 `undefined`，配合下面的 `if (!target) return;`
      // 会让这个技能**永远静默不生效**。正确的取法是从第二参数（施法单位）上读。
      // 与同条目 `canUse` 的 `self.summoner` 保持一致。
      const target = self.summoner;
      if (!target) {
        return;
      }
      world.sendSkillUsage(self, [target], this);
      target.hp += 10000000;
    };
  },
});

}
