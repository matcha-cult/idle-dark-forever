/**
 * ⚠️ 由原版 `data/enemies/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 随机一律走注入的 `Rng` 端口，本文件**零** `Math.random()`：
 *    词缀 / 传奇的 `generate` 用形参 `rng`；技能 / buff / 强化 hook 用 `world.rng.skill`（标签 `'skill'`）。
 */

import type { AttackLike, BuffStateLike, ComboLike, EnemyEntry, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/enemies/slime.js ──
const __enemies_0 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'slime.minimal',
    name: '小史莱姆',
    description:
      '黏糊糊的一团，是被黑暗之力操控的最原始的生物，不断吞噬周遭的物体。',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 25,
    atk: 0.5,
    atkSpeed: 0.2,
    exp: 2,
    level: 10,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [1, 5],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'slime.giant',
    name: '大史莱姆',
    description: '黏糊糊的一大团，缓慢的蠕动着，透过身体还能看到未消化的东西。',
    camp: 'neutral',
    race: 'unknown',
    career: 'melee',
    maxHp: 100,
    exp: 3,
    atk: 2,
    level: 12,
    atkSpeed: 0.25,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [1, 20],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
    ],
  },
  {
    key: 'slime.giant.enemy',
    name: '大史莱姆',
    description: '黏糊糊的一大团，缓慢的蠕动着，透过身体还能看到未消化的杂物。',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 100,
    exp: 3,
    atk: 1,
    level: 16,
    atkSpeed: 0.25,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [1, 20],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
      {
        type: 'ticket',
        rate: 0.005,
        dungeons: {
          'town.cave2': 1,
        },
      },
    ],
  },
  {
    key: 'slime.queen',
    name: '母体史莱姆',
    description: '不断变形着的黏液，会吞食周围的其它史莱姆。',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 1000,
    def: 100,
    exp: 50,
    atk: 15,
    level: 20,
    atkSpeed: 0.1,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'slime.swallow',
        level: 0,
      },
    ],
    loots: [
      {
        key: 'gold',
        count: [1, 100],
        rate: 0.25,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/wolfs.js ──
const __enemies_1 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'wolf.minimal',
    name: '幼狼',
    description: '山里的狼有这么多？看来大人们真的没有骗人。',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 150,
    atk: 1.5,
    atkSpeed: 0.4,
    exp: 5,
    level: 20,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [1, 10],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'wolf.giant',
    name: '母狼',
    description: '你问我怎么分清是公是母的？小孩子不要问太多……',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 300,
    exp: 10,
    atk: 6,
    level: 22,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'wolf.heal',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [1, 20],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
      {
        type: 'ticket',
        rate: 0.005,
        dungeons: {
          'town.cave2': 2,
          'town.woods': 1,
        },
      },
    ],
  },
  {
    key: 'wolf.king',
    name: '狼王',
    description: '头顶有一撮白毛。据说这是最好的品种的象征',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 6000,
    def: 50,
    exp: 200,
    atk: 12,
    level: 26,
    atkSpeed: 0.6,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'wolf.call',
        level: 0,
      },
    ],
    loots: [
      {
        key: 'gold',
        count: [1, 200],
        rate: 0.25,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/kobolds.js ──
const __enemies_2 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'kobold.miner',
    name: '狗头人矿工',
    description: '狗头人居然长这么多的胡子，有点萌。\u{1F60A}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 350,
    atk: 10,
    atkSpeed: 0.4,
    exp: 20,
    level: 36,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [1, 10],
        rate: 0.2,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'kobold.shaman',
    name: '狗头人萨满',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 500,
    exp: 40,
    atk: 10,
    level: 38,
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
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 10],
        rate: 0.2,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
      {
        type: 'ticket',
        rate: 0.005,
        dungeons: {
          'town.woods': 4,
          'town.mine.2': 2,
          'town.mine.3': 1,
        },
      },
    ],
  },
  {
    key: 'kobold.candle',
    name: '安全牌蜡烛',
    description: '一根蜡烛。',
    camp: 'neutral',
    race: 'unknown',
    career: 'melee',
    maxHp: 10,
    exp: 0,
    atk: 100,
    level: 1,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'bomb',
        level: 0,
      },
    ],
    onPress(world) {
      this.kill();
      return false;
    },
    affixes: {
      stronger: 2,
    },
    loots: [
    ],
  },
  {
    key: 'kobold.goldteeth',
    name: '金牙',
    description: '狗头人的大王，最萌了~ \u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 4000,
    hpRecovery: 15,
    exp: 800,
    atk: 50,
    level: 42,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'candle.call',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 100],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/fireElements.js ──
const __enemies_3 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'kakarif.generations',
    name: '卡卡列夫的后代',
    description: '一团燃烧着的火元素',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 600,
    exp: 30,
    atk: 25,
    fireAbsorb: 1.2,
    level: 50,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'fireElement.fireball',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 25],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'kakarif.servants',
    name: '卡卡列夫的仆从',
    description: '一种来自火元素位面的蛇形生物',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    fireAbsorb: 0.3,
    maxHp: 750,
    exp: 30,
    atk: 30,
    level: 52,
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
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 35],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
    ],
  },
  {
    key: 'kakarif.illusion',
    name: '卡卡列夫的幻象',
    description: '一人高的元素生物，灼热的气浪迎面而来',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 10000,
    fireAbsorb: 1.0,
    hpRecovery: 20,
    exp: 1200,
    atk: 50,
    level: 56,
    atkSpeed: 0.5,
    skills: [
      {
        key: 'kakarif.melee',
        level: 0,
      },
      {
        key: 'kakarif.mad',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [50, 150],
        rate: 0.25,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/zombie.js ──
const __enemies_4 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'zombies.farmer',
    name: '农夫发狂',
    description: '两眼发红，口水流了一嘴，看起来极其可怕',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 450,
    atk: 10,
    atkSpeed: 0.4,
    exp: 20,
    level: 36,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [1, 10],
        rate: 0.2,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'zombies.hammersmith',
    name: '铁匠发狂',
    description: '大哥，放下你手里的锤子！有话好好说！',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 600,
    exp: 40,
    atk: 30,
    level: 38,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'zombie.thumpHead',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 10],
        rate: 0.2,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
      {
        type: 'ticket',
        rate: 0.005,
        dungeons: {
          'town.woods': 4,
          'town.neighbourTown.2': 3,
          'town.neighbourTown.3': 1,
        },
      },
    ],
  },
  {
    key: 'zombie.necromancer',
    name: '死灵法师奈布',
    description: '死灵法师头目',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 5000,
    hpRecovery: 15,
    exp: 800,
    atk: 0,
    level: 42,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'zombie.heal',
        level: 0,
      },
      {
        key: 'zombie.hide',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 100],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
      {
        type: 'equip',
        rate: 0.5,
        mfRate: 3,
      },
      {
        type: 'equip',
        rate: 0.25,
        mfRate: 5,
      },
    ],
  },
];

})();

// ── 原 data/enemies/knights.js ──
const __enemies_5 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'knight.normal',
    name: '圣殿骑士',
    description: '一团燃烧着的火元素',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 600,
    exp: 30,
    atk: 20,
    def: 200,
    level: 50,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'shieldShock',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 25],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'knight.prayer',
    name: '圣殿牧师',
    description: '一种来自火元素位面的蛇形生物',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 750,
    exp: 30,
    atk: 10,
    level: 52,
    def: 100,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'knight.heal',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 35],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
    ],
  },
  {
    key: 'knight.leader',
    name: '骑士队长卡罗',
    description: '一人高的元素生物，灼热的气浪迎面而来',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 10000,
    def: 300,
    exp: 1200,
    atk: 50,
    level: 56,
    atkSpeed: 0.5,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'knight.shout',
        level: 0,
      },
      {
        key: 'knight.reflect',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [50, 150],
        rate: 0.25,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
      {
        type: 'equip',
        rate: 0.5,
        mfRate: 3,
      },
      {
        type: 'equip',
        rate: 0.25,
        mfRate: 5,
      },
    ],
  },
];

})();

// ── 原 data/enemies/chapter3.undeads.js ──
const __enemies_6 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'chapter3.undead.ghost',
    name: '不安的冤魂',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 1000,
    atk: 50,
    atkSpeed: 0.4,
    exp: 50,
    level: 60,
    skills: [
      {
        key: 'shaman.darkball',
        level: 0,
      },
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [1, 15],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter3.undead.zombie',
    name: '行尸',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 2000,
    exp: 50,
    atk: 75,
    level: 64,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 20],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
      {
        type: 'ticket',
        rate: 0.00125,
        dungeons: {
          'town.mine.2': 2,
          'town.mine.3': 1,
          'town.neighbourTown.2': 2,
          'town.neighbourTown.3': 1,
          'chapter3.shelter773': 1,
        },
      },
    ],
  },
  {
    key: 'chapter3.undead.ghostShield',
    name: '幽魂护卫',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 500,
    atkSpeed: 0.4,
    level: 64,
    skills: [
      {
        key: 'ghostShield',
        level: 0,
      }
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
    ],
  },
  {
    key: 'chapter3.necromancer',
    name: '暗影法师奈布',
    description: '狗头人的大王，最萌了~ \u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 50000,
    hpRecovery: 50,
    exp: 1800,
    atk: 200,
    level: 66,
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
        key: 'necromancer.ghostShield',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [100, 200],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/chapter3.beast.js ──
const __enemies_7 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 4/12/17.
 */

return  [
  {
    key: 'chapter3.beast.wildpig',
    name: '豪猪',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 2500,
    def: 100,
    atk: 100,
    exp: 65,
    atkSpeed: 0.4,
    level: 70,
    skills: [
      {
        key: 'melee',
        level: 0,
      }
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 35],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      }
    ],
  },
  {
    key: 'chapter3.beast.lion',
    name: '雄狮',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    exp: 85,
    maxHp: 1500,
    def: 50,
    atk: 80,
    atkSpeed: 0.7,
    level: 72,
    skills: [
      {
        key: 'melee',
        level: 0,
      }
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 35],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
      {
        type: 'ticket',
        rate: 0.00125,
        dungeons: {
          'chapter3.shelter773': 2,
          'chapter3.wood1': 1,
        },
      },
    ],
  },
  {
    key: 'chapter3.beast.pengpeng',
    name: '彭彭',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 80000,
    exp: 800,
    def: 100,
    atk: 400,
    atkSpeed: 0.4,
    level: 80,
    skills: [
      {
        key: 'simba.thumpHead',
        level: 0,
      },
      {
        key: 'melee',
        level: 0,
      }
    ],
    hooks: {
      'simba.goodFriends': value => true,
    },
    buffs: [
      {
        type: 'simba.goodFriends',
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 1,
    },
    loots: [
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter3.beast.simba',
    name: '辛巴',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 60000,
    def: 50,
    exp: 800,
    atk: 400,
    atkSpeed: 0.7,
    level: 80,
    skills: [
      {
        key: 'melee',
        level: 0,
      }
    ],
    hooks: {
      'simba.goodFriends': value => true,
    },
    buffs: [
      {
        type: 'simba.goodFriends',
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 1,
    },
    loots: [
    ],
  },
  {
    key: 'chapter3.beast.dingman',
    name: '丁满',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 40000,
    atk: 200,
    exp: 800,
    atkSpeed: 0.6,
    level: 80,
    skills: [
      {
        key: 'simba.heal',
        level: 0,
      },
      {
        key: 'melee',
        level: 0,
      }
    ],
    hooks: {
      'simba.goodFriends': value => true,
    },
    buffs: [
      {
        type: 'simba.goodFriends',
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [150, 250],
        rate: 1,
      },
    ],
  },
];

})();

// ── 原 data/enemies/chapter3.murloc.js ──
const __enemies_8 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 4/12/17.
 */

return  [
  {
    key: 'chapter3.murloc.minions',
    name: '鱼人战士',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 8000,
    atk: 150,
    exp: 150,
    atkSpeed: 0.4,
    level: 80,
    skills: [
      {
        key: 'melee',
        level: 0,
      }
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [10, 40],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      }
    ],
  },
  {
    key: 'chapter3.murloc.shaman',
    name: '鱼人祭祀',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    exp: 125,
    maxHp: 6000,
    def: 50,
    atk: 180,
    atkSpeed: 0.7,
    level: 82,
    skills: [
      {
        key: 'shaman.iceball',
        level: 0,
      },
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [20, 40],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1,
      },
      {
        type: 'ticket',
        rate: 0.00125,
        dungeons: {
          'chapter3.wood1': 4,
          'chapter3.auran1': 2,
          'chapter3.auran2': 1,
        },
      },
    ],
  },
  {
    key: 'chapter3.murloc.army',
    name: '鱼人大军',
    camp: 'neutral',
    race: 'unknown',
    career: 'melee',
    maxHp: 1000,
    def: 50,
    atk: 50,
    atkSpeed: 0.4,
    level: 1,
    skills: [
      {
        key: 'murloc.army.thumpHead',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 1,
    }
  },
  {
    key: 'chapter3.murloc.warlord',
    name: '鱼人督军',
    description: '狗头人的大王，最萌了~ \u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 300000,
    hpRecovery: 50,
    exp: 3000,
    atk: 500,
    level: 90,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'murloc.thumpHead',
        level: 0,
      },
      {
        key: 'murloc.shieldShout',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [180, 300],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/chapter3.fishzilla.js ──
const __enemies_9 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 4/18/17.
 */

return  [
  {
    key: 'chapter3.fishzilla.magician',
    name: '湖畔镇魔法师',
    camp: 'alien',
    race: 'unknown',
    career: 'melee',
    maxHp: 5000,
    atk: 150,
    atkSpeed: 0.4,
    level: 94,
    skills: [
      {
        key: 'fishzilla.focus',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 1,
    },
  },
  {
    key: 'chapter3.murloc.slaves',
    name: '鱼人奴隶',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 10000,
    atk: 1000,
    exp: 100,
    atkSpeed: 0.5,
    level: 94,
    skills: [
      {
        key: 'melee',
        level: 0,
      }
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [10, 40],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      }
    ],
  },
  {
    key: 'chapter3.fishzilla',
    name: '鱼斯拉',
    description: '狗头人的大王，最萌了~ \u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 10000000,
    hpRecovery: 250,
    exp: 5000,
    atk: 1500,
    level: 100,
    atkSpeed: 0.6,
    skills: [
      {
        key: 'fishzilla.summonSlaves',
        level: 0,
      },
      {
        key: 'fishzilla.bomb',
        level: 12,
      },
      {
        key: 'melee',
        level: 0,
      },
    ],
    stunResist: 3000,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [200, 400],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];
})();

// ── 原 data/enemies/chapter3.elements.js ──
const __enemies_10 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'chapter3.element.fire',
    name: '火焰精灵',
    description: '一团跳动的火焰',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'fireElement.fireball',
        level: 0,
      },
    ],
    maxHp: 40000,
    def: 150,
    atk: 500,
    fireAbsorb: 1.2,
    atkSpeed: 0.4,
    exp: 180,
    level: 104,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [20, 50],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter3.element.water',
    name: '水元素',
    description: '一团跳动的火焰',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'waterElement.waterArrow',
        level: 0,
      },
      {
        key: 'iceNova',
        level: 0,
      },
    ],
    maxHp: 40000,
    def: 150,
    atk: 400,
    coldAbsorb: 1.2,
    atkSpeed: 0.4,
    exp: 180,
    level: 104,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [20, 50],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter3.element.earth',
    name: '岩石傀儡',
    description: '一团跳动的火焰',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    maxHp: 40000,
    def: 350,
    atk: 800,
    atkSpeed: 0.4,
    exp: 180,
    level: 106,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [20, 50],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1,
      },
      {
        type: 'ticket',
        rate: 0.0025,
        dungeons: {
          'chapter3.auran1': 4,
          'chapter3.auran2': 2,
          'chapter3.tower2': 1,
        },
      },
    ],
  },
  {
    key: 'chapter3.element.azathoth.fire',
    name: '阿撒托斯[火]',
    description: '一团跳动的混沌元素',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'fireElement.fireball',
        level: 0,
      },
      {
        key: 'azathoth.transformIce',
        level: 0,
      },
    ],
    stunResist: 3000,
    maxHp: 1000000,
    fireAbsorb: 1.2,
    def: 150,
    atk: 1000,
    atkSpeed: 0.4,
    exp: 7000,
    level: 110,
    loots: [
      {
        key: 'gold',
        count: [250, 500],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter3.element.azathoth.ice',
    name: '阿撒托斯[冰]',
    description: '一团跳动的混沌元素',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'waterElement.waterArrow',
        level: 0,
      },
      {
        key: 'iceNova',
        level: 0,
      },
      {
        key: 'azathoth.transformEarth',
        level: 0,
      },
    ],
    stunResist: 3000,
    maxHp: 1000000,
    def: 150,
    atk: 1000,
    atkSpeed: 0.4,
    coldAbsorb: 1.2,
    exp: 8000,
    level: 110,
    loots: [
      {
        key: 'gold',
        count: [250, 500],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter3.element.azathoth.earth',
    name: '阿撒托斯[土]',
    description: '一团跳动的混沌元素',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'azathoth.transformDark',
        level: 0,
      },
      {
        key: 'melee',
        level: 0,
      },
    ],
    maxHp: 1000000,
    def: 350,
    atk: 1000,
    atkSpeed: 0.4,
    exp: 8000,
    level: 110,
    stunResist: 3000,
    loots: [
      {
        key: 'gold',
        count: [250, 500],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter3.element.azathoth.dark',
    name: '阿撒托斯[混乱]',
    description: '一团跳动的混沌元素',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'azathoth.explode',
        level: 0,
      },
    ],
    maxHp: 1000000,
    def: 0,
    chaosAbsorb: 0.6,
    atk: 1000,
    atkSpeed: 0.4,
    exp: 8000,
    level: 110,
    stunResist: 3000,
    loots: [
      {
        key: 'gold',
        count: [250, 500],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter3.element.azathoth.none',
    name: '阿撒托斯的灰烬',
    description: '一团跳动的混沌元素',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [],
    maxHp: 1000000,
    def: 150,
    chaosAbsorb: 0.6,
    atk: 1500,
    atkSpeed: 0.4,
    exp: 5000,
    level: 110,
    buffs: [],
    loots: [
      {
        key: 'gold',
        count: [250, 500],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.5,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/chapter3.waterElements.js ──
const __enemies_11 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'chapter3.waterElement.nagaHero',
    name: '娜迦勇士',
    description: '一团跳动的火焰',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    maxHp: 60000,
    def: 150,
    atk: 1000,
    atkSpeed: 0.4,
    exp: 220,
    level: 114,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [20, 50],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter3.waterElement',
    name: '水元素',
    description: '一团跳动的火焰',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'waterElement.waterArrow',
        level: 0,
      },
      {
        key: 'iceNova',
        level: 0,
      },
    ],
    maxHp: 60000,
    def: 150,
    atk: 700,
    coldAbsorb: 1.2,
    atkSpeed: 0.4,
    exp: 220,
    level: 114,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [20, 50],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter3.waterElement.giants',
    name: '深海巨人',
    description: '一团跳动的火焰',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'cleave',
        level: 0,
      },
    ],
    maxHp: 150000,
    def: 250,
    atk: 1400,
    atkSpeed: 0.4,
    exp: 450,
    level: 116,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [20, 50],
        rate: 0.1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1,
      },
      {
        type: 'ticket',
        rate: 0.005,
        dungeons: {
          'chapter3.tower2': 2,
          'chapter3.auran4': 1,
        },
      },
    ],
  },
  {
    key: 'chapter3.waterElement.Nynnroth',
    name: '奈因洛斯的分身',
    description: '一团跳动的水元素',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    skills: [
      {
        key: 'waterElement.waterArrow',
        level: 0,
      },
      {
        key: 'waterElement.waterFlow',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 3000,
    maxHp: 1600000,
    coldAbsorb: 0.6,
    def: 150,
    atk: 2000,
    atkSpeed: 0.4,
    exp: 10000,
    level: 120,
    loots: [
      {
        key: 'gold',
        count: [400, 600],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },

  {
    key: 'shrine.nynnroth.shield',
    name: '定海圣殿',
    description: '增加怒气、能量、法力恢复速度3秒。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      for (const unit of world.units.filter(
        (v) => v.camp === 'player' || v.camp === 'alien'
      )) {
        unit.addBuff('nynnroth.shield', 5000);
      }
      this.kill();
      return false;
    },
  },
];

})();

// ── 原 data/enemies/chapter4.orcs.js ──
const __enemies_12 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'chapter4.orcs.warrior',
    name: '兽人战士',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 150000,
    atk: 1200,
    atkSpeed: 0.4,
    exp: 300,
    level: 124,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [30, 80],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter4.orcs.hunter',
    name: '兽人驯狼师',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 200000,
    maxEp: 50,
    epRecovery: 2,
    exp: 450,
    atk: 1000,
    level: 126,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'orcs.summonWolf',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [30, 80],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
      {
        type: 'ticket',
        rate: 0.002,
        dungeons: {
          'chapter3.auran4': 4,
          'chapter4.westRolan1': 2,
          'chapter4.westRolan2': 1,
        },
      },
    ],
  },
  {
    key: 'chapter3.orcs.wolf',
    name: '野狼',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 100000,
    atk: 1200,
    atkSpeed: 0.6,
    level: 126,
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
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
    ],
  },
  {
    key: 'chapter3.orcs.totem',
    name: '治疗图腾',
    description: '',
    camp: 'neutral',
    race: 'unknown',
    career: 'melee',
    maxHp: 30000,
    atk: 1200,
    atkSpeed: 0.6,
    level: 126,
    skills: [
      {
        key: 'totem.heal',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
    ],
  },
  {
    key: 'chapter3.orcs.shaman',
    name: '萨布罗·霜狼',
    description: '兽人霜狼氏族领袖',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 2400000,
    hpRecovery: 1500,
    exp: 1800,
    atk: 2000,
    level: 130,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'shaman.chainingLightning',
        level: 0,
      },
      {
        key: 'orcs.summonHealToken',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/chapter4.humans.js ──
const __enemies_13 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'chapter4.humans.thief',
    name: '小偷',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 200000,
    atk: 1800,
    atkSpeed: 0.6,
    exp: 450,
    level: 134,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [50, 100],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter4.humans.rogue',
    name: '流氓',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 280000,
    exp: 450,
    atk: 1800,
    level: 126,
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
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [50, 100],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
    ],
  },
  {
    key: 'chapter4.humans.monster',
    name: '虚空行者',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 2000000,
    atk: 2500,
    atkSpeed: 0.4,
    level: 136,
    skills: [
      {
        key: 'darkElement.darkball',
        level: 0,
      },
      {
        key: 'summon.earth.comeToMe',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
    ],
  },
  {
    key: 'chapter4.humans.seck',
    name: '罗兰·赛克',
    description: '手黑党的领袖',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 2400000,
    maxMp: 1000,
    mpRecovery: 20,
    hpRecovery: 2000,
    exp: 1500,
    atk: 4000,
    level: 140,
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
        key: 'chapter4.humans.seck.summonDarkSoul',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter4.humans.women',
    name: '魅魔',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 2000000,
    atk: 4000,
    atkSpeed: 0.4,
    level: 136,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'chapter4.humans.women.thumpHead',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
    ],
  },
  {
    key: 'chapter4.humans.seck1',
    name: '罗兰·赛克',
    description: '手黑党的领袖，丫用灵魂石复活了',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 2400000,
    maxMp: 1000,
    mpRecovery: 20,
    hpRecovery: 2000,
    exp: 1500,
    atk: 4000,
    level: 140,
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
        key: 'chapter4.humans.seck.summonWomen',
        level: 0,
      },
      {
        key: 'chapter4.humans.seck.healthDrill',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/chapter4.humans1.js ──
const __enemies_14 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'chapter4.humans.soldier',
    name: '士兵',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 250000,
    atk: 2200,
    atkSpeed: 0.6,
    exp: 450,
    level: 144,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [50, 100],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter4.humans.musketeer',
    name: '火枪手',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 200000,
    atk: 1800,
    atkSpeed: 0.8,
    critRate: 0.3,
    critBonus: 2.5,
    exp: 450,
    level: 146,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [50, 100],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter4.humans.mortar',
    name: '迫击炮',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 400000,
    exp: 450,
    atk: 5000,
    level: 148,
    atkSpeed: 0.2,
    skills: [
      {
        key: 'melee.aoe',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [50, 100],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
      {
        type: 'ticket',
        rate: 0.005,
        dungeons: {
          'chapter4.westRolan1': 4,
          'chapter4.westRolan2': 2,
          'chapter4.sanAnthony1': 2,
          'chapter4.sanAnthony2': 1,
        },
      },
    ],
  },
  {
    key: 'chapter4.humans.knights.dare',
    name: '英勇骑士达尔',
    description: '手黑党的领袖，丫用灵魂石复活了',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3600000,
    maxRp: 100,
    rpOnAttack: 10,
    rpOnAttacked: 1,
    exp: 1500,
    atk: 4000,
    level: 150,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'meleeForRage',
        level: 4,
      },
      {
        key: 'thump',
        level: 2,
      },
      {
        key: 'mortalStrike',
        level: 5,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter4.humans.knights.light',
    name: '光明骑士莱特',
    description: '手黑党的领袖，丫用灵魂石复活了',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3600000,
    exp: 1500,
    atk: 3000,
    level: 150,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'knight.melee',
        level: 4,
      },
      {
        key: 'knight.glory.enemy',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    hooks: {
      displayCpBar(world, value) {
        return true;
      },
    },
    stunResist: 4000,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter4.humans.knights.blood',
    name: '鲜血骑士布莱德',
    description: '手黑党的领袖，丫用灵魂石复活了',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3600000,
    exp: 1500,
    atk: 3000,
    level: 150,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'knight.sacrifice',
        level: 4,
      },
      {
        key: 'knight.thump',
        level: 2,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    hooks: {
      displayCpBar(world, value) {
        return true;
      },
    },
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter4.humans.knights.sanction',
    name: '制裁骑士山新',
    description: '手黑党的领袖，丫用灵魂石复活了',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3600000,
    exp: 1500,
    atk: 4000,
    level: 150,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'swordSkill',
        level: 4,
      },
      {
        key: 'knight.kick',
        level: 0,
      },
      {
        key: 'knight.thumpHead.enemy',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter4.humans.knights.rage',
    name: '全能骑士雷格',
    description: '手黑党的领袖，丫用灵魂石复活了',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3600000,
    maxRp: 100,
    rpRecovery: 1,
    rpOnAttack: 10,
    rpOnAttacked: 3,
    exp: 1500,
    atk: 4000,
    level: 150,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'cleave',
        level: 4,
      },
      {
        key: 'thump',
        level: 2,
      },
      {
        key: 'shockWave',
        level: 0,
      },
      {
        key: 'commandShout',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/chapter4.humans2.js ──
const __enemies_15 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'chapter4.humans.trigger.1',
    name: '神秘的把手',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('机关被触动了。一阵令人牙酸的声音之后，下水道的入口显现了出来。');
      return false;
    },
  },
  {
    key: 'chapter4.humans.trigger.2',
    name: '下水道',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      return false;
    },
  },
  {
    key: 'chapter4.humans.trigger.3.1',
    name: '未知的机关',
    description: '真正通过的机关。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      for (const unit of world.units) {
        if (unit.type && unit.type.indexOf('chapter4.humans.trigger.3') >= 0) {
          unit.kill(false);
        }
      }
      world.sendGeneralMsg('你触发了一个看起来很危险的机关，所有其它的机关都消失了。');
      return false;
    },
  },
  {
    key: 'chapter4.humans.trigger.3.2',
    name: '未知的机关',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill();
      world.sendGeneralMsg('这个机关看起来没有任何作用。');
      return false;
    },
  },
  {
    key: 'chapter4.humans.trigger.3.3',
    name: '未知的机关',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill();
      for (const unit of world.units) {
        if (unit.type && unit.type.indexOf('chapter4.humans.trigger') >= 0) {
          continue
        }
        world.sendDamage('real', this, unit, {name: '爆炸'}, unit.maxHp * 0.7)
      }
      return false;
    },
  },
  {
    key: 'chapter4.humans.trigger.3.4',
    name: '未知的机关',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',
    maxHp: 400000,

    onPress(world) {
      this.transformType('chapter4.humans.trigger.4');
      return false;
    },
  },
  {
    key: 'chapter4.humans.trigger.4',
    name: '活动的机关',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 400000,
    atk: 6000,
    atkSpeed: 1.5,
    level: 156,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
  },
  {
    key: 'chapter4.humans.boss.fearas',
    name: '菲尔斯男爵',
    description: '地精刺客',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 5000000,
    exp: 1800,
    atk: 6000,
    level: 160,
    atkSpeed: 1.0,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'enemy.fearas.summonTrigger',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter4.humans.trigger.5.1',
    name: '安全牌地雷',
    description: '将在3秒后爆炸。',
    camp: 'neutral',
    race: 'unknown',
    career: 'melee',
    atk: 1000,

    skills: [
      {
        key: 'enemy.fearas.bomb',
        level: 0,
      }
    ],

    onPress(world) {
      for (const unit of world.units) {
        if (this.canAttack(unit)) {
          world.sendDamage('fire', this, unit, {name: '爆炸'}, 10000)
        }
      }
      this.kill(false);
      world.sendGeneralMsg('你试图解除安全牌地雷的时候，地雷反而爆炸的更厉害了。');
      return false;
    },
  },
  {
    key: 'chapter4.humans.trigger.5.2',
    name: '哑炮牌地雷',
    description: '将在3秒后爆炸。',
    camp: 'neutral',
    race: 'unknown',
    career: 'melee',

    atk: 10000,

    skills: [
      {
        key: 'enemy.fearas.bomb1',
        level: 0,
      }
    ],

    onPress(world) {
      for (const unit of world.units) {
        if (this.canAttack(unit)) {
          unit.breakCasting();
          unit.stun(3, 'stunned');
        }
      }
      this.kill(false);
      world.sendGeneralMsg('哑炮牌地雷释放了一阵烟雾，你一时动弹不得。');
      return false;
    },
  },
  {
    key: 'chapter4.humans.trigger.5.3',
    name: '科学牌地雷',
    description: '将在3秒后爆炸。',
    camp: 'neutral',
    race: 'unknown',
    career: 'melee',
    atk: 6000,

    skills: [
      {
        key: 'enemy.fearas.bomb',
        level: 0,
      }
    ],

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('科学牌地雷被解除后，很科学的停止了工作。');
      return false;
    },
  },
  {
    key: 'chapter4.humans.trigger.5.4',
    name: '机械松鼠',
    description: '额，拿错了。',
    camp: 'alien',
    race: 'unknown',
    career: 'melee',

    skills: [
      {
        key: 'enemy.fearas.bomb2',
        level: 0,
      }
    ],
  },
  {
    key: 'chapter4.humans.trigger.6',
    name: '牢笼控制台',
    description: '真正通过的机关。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      return false;
    },
  },

  {
    key: 'chapter4.humans.boss.milhous',
    name: '米尔豪斯·法力风暴',
    description: '侏儒法师',
    camp: 'alien',
    race: 'unknown',
    career: 'melee',
    maxHp: 1000000,
    exp: 1800,
    atk: 5000,
    level: 160,
    maxMp: 5000,
    mpRecovery: 100,
    atkSpeed: 1.0,
    skills: [
      {
        key: 'fireBall',
        level: 0,
      },
      {
        key: 'iceArrow',
        level: 0,
      },
      {
        key: 'windBlade',
        level: 10,
      },
      {
        key: 'burning',
        level: 0,
      },
      {
        key: 'iceNova',
        level: 0,
      },
      {
        key: 'iceLance',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
    onPress(world) {
      const buff = this.buffs.find(v=>v.type === 'enemy.evil.control');
      if (buff) {
        this.removeBuff(buff);
      }
    }
  },
  {
    key: 'chapter4.humans.boss.evil',
    name: '上古邪恶',
    description: '地精刺客',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 10000000,
    exp: 1800,
    atk: 10000,
    level: 160,
    atkSpeed: 0.6,
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
        key: 'enemy.evil.reading1',
        level: 0,
      },
      {
        key: 'enemy.evil.control',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },

];

})();

// ── 原 data/enemies/summon.assassin.js ──
const __enemies_16 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 4/26/17.
 */

return  [
  {
    key: 'summon.assassin.puppet',
    name: '活动假人',
    description: '哈哈哈哈，来打我啊',
    camp: 'alien',
    race: 'unknown',
    career: 'melee',
    maxHp: 10,
    skills: [
      {
        key: 'summon.puppet.comeToMe',
        level: 0,
      },
    ],
    hooks: {
      maxHp(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.maxHp * 0.5;
      },
    },
  },
];

})();

// ── 原 data/enemies/summon.element.js ──
const __enemies_17 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 4/26/17.
 */

function getLevelBonus(level: number) {
  if (level <= 60) {
    return level * 0.3 + 1;
  }
  if (level <= 70) {
    return level * 0.5 + 1 - 6;
  }
  return NaN;
}

const elements: EnemyEntry[] = [
  {
    key: 'summon.element.fire',
    name: '火焰精灵',
    description: '一团跳动的火焰',
    camp: 'player',
    race: 'unknown',
    career: 'melee',
    maxHp: 10,
    fireAbsorb: 1.2,
    skills: [
      {
        key: 'fireElement.fireball',
        level: 0,
      },
    ],
    v2Skills: [
      {
        key: 'fireElement.flameStrike',
        level: 0,
      },
    ],
    hooks: {
      speedRateMul(world, value, target) {
        if (!this.summoner) {
          return value;
        }
        return this.summoner.runAttrHooks(value, 'speedRateMul');
      },
      willAttack(world, value, target) {
        return value && target.fireAbsorb < 1;
      },
      willDamage(world, value, to, damageType) {
        if (!this.summoner) {
          return value;
        }
        return this.summoner.runAttrHooks(
          value,
          'summonerWillDamage',
          this,
          to,
          damageType
        );
      },
      elementType(world, value) {
        return 'fire';
      },
      maxHp(world, value) {
        if (!this.summoner) {
          return 0;
        }
        const { player } = this.summoner;
        const level = player.getSkillLevel('summonFire');
        return this.summoner.maxHp * 0.2 * (1 + level / 10);
      },
      critRate(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.critRate;
      },
      critBonus(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.critBonus;
      },
      atk(world, value) {
        if (!this.summoner) {
          return 0;
        }
        const { player } = this.summoner;
        const level = player.getSkillLevel('summonFire');
        return (
          5 *
          getLevelBonus(player.level) *
          (this.summoner.int * 0.01 + 1) *
          (level * 0.3 + 1) *
          this.summoner.dmgAdd
        );
      },
      def(world, value) {
        return this.summoner.def;
      },
    },
  },
  {
    key: 'summon.element.water',
    name: '水元素',
    description: '一团滚动的水元素',
    camp: 'player',
    race: 'unknown',
    career: 'melee',
    maxHp: 10,
    iceAbsorb: 1.2,
    skills: [
      {
        key: 'waterElement.waterArrow',
        level: 0,
      },
      {
        key: 'iceNova',
        level: 0,
      },
    ],
    v2Skills: [
      {
        key: 'fishzilla.bomb',
        level: 0,
      },
    ],
    hooks: {
      speedRateMul(world, value, target) {
        if (!this.summoner) {
          return value;
        }
        return this.summoner.runAttrHooks(value, 'speedRateMul');
      },
      willAttack(world, value, target) {
        return value && target.coldAbsorb < 1;
      },
      willDamage(effect, value, to, damageType) {
        if (!this.summoner) {
          return value;
        }
        return this.summoner.runAttrHooks(
          value,
          'summonerWillDamage',
          this,
          to,
          damageType
        );
      },
      elementType(world, value) {
        return 'water';
      },
      maxHp(world, value) {
        if (!this.summoner) {
          return 0;
        }
        const { player } = this.summoner;
        const level = player.getSkillLevel('summonWater');
        return this.summoner.maxHp * 0.2 * (1 + level / 10);
      },
      critRate(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.critRate;
      },
      critBonus(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.critBonus;
      },
      atk(world, value) {
        if (!this.summoner) {
          return 0;
        }
        const { player } = this.summoner;
        const level = player.getSkillLevel('summonWater');
        return (
          4 *
          getLevelBonus(player.level) *
          (this.summoner.int * 0.01 + 1) *
          (level * 0.3 + 1) *
          this.summoner.dmgAdd
        );
      },
      def(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.def * 2;
      },
    },
  },
  {
    key: 'summon.element.earth',
    name: '岩石傀儡',
    description: '坚固的岩石傀儡',
    camp: 'player',
    race: 'unknown',
    career: 'melee',
    maxHp: 10,
    atkSpeed: 0.666,
    def: 100,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'summon.earth.comeToMe',
        level: 0,
      },
    ],
    v2Skills: [
      {
        key: 'earthElement.recovery',
        level: 0,
      },
      {
        key: 'summon.puppet.comeToMe',
        level: 0,
      },
    ],

    hooks: {
      speedRateMul(world, value, target) {
        if (!this.summoner) {
          return value;
        }
        return this.summoner.runAttrHooks(value, 'speedRateMul');
      },
      willDamage(effect, value, to, damageType) {
        if (!this.summoner) {
          return value;
        }
        return this.summoner.runAttrHooks(
          value,
          'summonerWillDamage',
          this,
          to,
          damageType
        );
      },
      elementType(world, value) {
        return 'melee';
      },
      maxHp(world, value) {
        if (!this.summoner) {
          return 0;
        }
        const { player } = this.summoner;
        const level = player.getSkillLevel('summonEarth');
        return this.summoner.maxHp * 0.4 * (1 + level / 10);
      },
      critRate(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.critRate;
      },
      critBonus(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.critBonus;
      },
      atk(world, value) {
        if (!this.summoner) {
          return 0;
        }
        const { player } = this.summoner;
        const level = player.getSkillLevel('summonEarth');
        return (
          6 *
          getLevelBonus(player.level) *
          (this.summoner.int * 0.01 + 1) *
          (level * 0.3 + 1) *
          this.summoner.dmgAdd
        );
      },
      def(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.def * 5;
      },
    },
  },
  {
    key: 'summon.element.lightning',
    name: '闪电风暴',
    description: '一团跳动的闪电',
    camp: 'player',
    race: 'unknown',
    career: 'melee',
    maxHp: 10,
    lightningAbsorb: 1.2,
    skills: [
      {
        key: 'lightningElement.chainingLightning',
        level: 0,
      },
    ],
    v2Skills: [
      {
        key: 'lightningElement.stunAll',
        level: 0,
      },
    ],
    hooks: {
      speedRateMul(world, value, target) {
        if (!this.summoner) {
          return value;
        }
        return this.summoner.runAttrHooks(value, 'speedRateMul');
      },
      willAttack(world, value, target) {
        return value && target.lightningAbsorb < 0.5;
      },
      willDamage(world, value, to, damageType) {
        if (!this.summoner) {
          return value;
        }
        return this.summoner.runAttrHooks(
          value,
          'summonerWillDamage',
          this,
          to,
          damageType
        );
      },
      elementType(world, value) {
        return 'lightning';
      },
      maxHp(world, value) {
        if (!this.summoner) {
          return 0;
        }
        const { player } = this.summoner;
        const level = player.getSkillLevel('summonLightning');
        return this.summoner.maxHp * 0.2 * (1 + level / 10);
      },
      critRate(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.critRate;
      },
      critBonus(world, value) {
        if (!this.summoner) {
          return 0;
        }
        return this.summoner.critBonus;
      },
      atk(world, value) {
        if (!this.summoner) {
          return 0;
        }
        const { player } = this.summoner;
        const level = player.getSkillLevel('summonLightning');
        return (
          5 *
          getLevelBonus(player.level) *
          (this.summoner.int * 0.01 + 1) *
          (level * 0.3 + 1) *
          this.summoner.dmgAdd
        );
      },
      def(world, value) {
        return this.summoner.def * 2;
      },
    },
  },
];

const elementV2 = elements.map((v) => ({
  ...v,
  key: v.key + '.2',
  name: 'II型' + v.name,
  skills: [...(v.skills ?? []), ...(v.v2Skills ?? [])],
}));

return  [...elements, ...elementV2];

})();

// ── 原 data/enemies/shrine.js ──
const __enemies_18 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 5/6/17.
 */
return  [
  {
    key: 'shrine.heal',
    name: '生命圣殿',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      for (const unit of world.units.filter(v => v.camp === 'player' || v.camp === 'alien')) {
        unit.hp += unit.maxHp * 0.6;
      }
      this.kill();
      return false;
    },
  },

  {
    key: 'shrine.energy',
    name: '能量圣殿',
    description: '增加怒气、能量、法力恢复速度30秒。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      for (const unit of world.units.filter(v => v.camp === 'player' || v.camp === 'alien')) {
        unit.addBuff('shrine.energy', 30000);
      }
      this.kill();
      return false;
    },
  },

  {
    key: 'shrine.power',
    name: '威能圣殿',
    description: '增加所有造成的伤害30秒。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      for (const unit of world.units.filter(v => v.camp === 'player' || v.camp === 'alien')) {
        unit.addBuff('shrine.power', 30000);
      }
      this.kill();
      return false;
    },
  },
];

})();

// ── 原 data/enemies/silver.warrior.js ──
const __enemies_19 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 10/07/2017.
 */

return  [
  {
    key: 'silver.warrior.trigger.1',
    name: '坚毅试炼之座',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('科力克：年轻的战士，你是否具备足够的毅力，承担永恒无尽的责任呢？');
      return false;
    },
  },
  {
    key: 'silver.warrior.boss.1',
    name: '科力克',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3000000,
    exp: 1800,
    atk: 15000,
    level: 160,
    atkSpeed: 0.4,
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
        key: 'knight.thumpHead.enemy',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.warrior.trigger.2',
    name: '勇气试炼之座',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('科力克：年轻的战士，我已经看到了你的决心，但你是否具备足够的勇气，面对千军万马的战斗呢？');
      return false;
    },
  },
  {
    key: 'silver.warrior.boss.2',
    name: '马道克',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3000000,
    exp: 1800,
    atk: 10000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.warrior.trigger.3',
    name: '技巧试炼之座',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('塔里克：年轻的战士，我很欣赏你的勇气，但是如果缺乏技艺，勇气就等同于鲁莽。那么，你究竟是否准备好了呢？');
      return false;
    },
  },
  {
    key: 'silver.warrior.boss.3',
    name: '塔里克',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 5000000,
    def: 100,
    exp: 1800,
    atk: 10000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/silver.assassin.js ──
const __enemies_20 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 10/07/2017.
 */

return  [
  {
    key: 'silver.assassin.trigger.1',
    name: '隐秘的记号',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('白鲸，请刺杀目标人物。比目鱼。');
      return false;
    },
  },
  {
    key: 'silver.assassin.boss.1',
    name: '体态优雅的贵族',
    description: '远古野蛮人',
    camp: 'neutral',
    race: 'unknown',
    career: 'melee',
    maxHp: 200000,
    exp: 1800,
    atk: 15000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.assassin.boss.1.summon',
    name: '保镖',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 20000000,
    exp: 1800,
    atk: 1000000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.assassin.trigger.2',
    name: '奇怪的门',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('当心！');
      const skill = {
        name: '射出的弩箭',
      };
      for (let i = 0; i < 3; i++) {
        if (!world.testDodge(this, world.playerUnit, skill)) {
          world.sendDamage('real', this, world.playerUnit, skill, 100000);
        }
      }
      return false;
    },
  },
  {
    key: 'silver.assassin.trigger.3',
    name: '通道',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('寇马克：刺客！你逃不掉了！');
      return false;
    },
  },
  {
    key: 'silver.assassin.boss.3',
    name: '寇马克',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 5000000,
    def: 100,
    exp: 1800,
    atk: 10000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/silver.sorceress.js ──
const __enemies_21 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 10/07/2017.
 */

return  [
  {
    key: 'silver.sorceress.trigger.1',
    name: '奥术能量核心',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('麦迪文的回响：魔法的奥秘无穷无尽，但也蕴含着无穷的危险。你是否能面对并掌控这种危险呢？');
      return false;
    },
  },
  {
    key: 'silver.sorceress.boss.1',
    name: '奥术能量核心',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3000000,
    exp: 1800,
    atk: 15000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'silver.sorceress.boss.1.bolt',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.sorceress.trigger.2',
    name: '书架',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('麦迪文的回响：知识蕴含着无穷的力量，却也成为了无数法师的牢笼。面对知识的困境，你会如何处理呢？');
      return false;
    },
  },
  {
    key: 'silver.sorceress.boss.2',
    name: '飞舞的书籍',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 500000,
    fireResist: -40,
    exp: 180,
    atk: 5000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [50, 100],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.sorceress.trigger.3',
    name: '法阵',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('麦迪文的回响：哦？聪明的办法。但是真正的战斗没有捷径可言。面对真正的敌人吧！');
      return false;
    },
  },
  {
    key: 'silver.sorceress.boss.3',
    name: '恐怖的怪物',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 5000000,
    def: 100,
    exp: 1800,
    atk: 10000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/silver.summoner.js ──
const __enemies_22 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 10/07/2017.
 */

return  [
  {
    key: 'silver.summoner.trigger.1',
    name: '火位面之门',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('小亚的声音：亚莲娜，元素生物在艾希大陆被创造之前就已经存在的古老生物，其中的火元素，代表了毁灭，是世界的基石之一。');
      return false;
    },
  },
  {
    key: 'silver.summoner.boss.1',
    name: '暴躁的火元素',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    fireAbsorb: 1,
    maxHp: 3000000,
    exp: 1800,
    atk: 10000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'kakarif.melee',
        level: 0,
      },
      {
        key: 'fireElement.fireball',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.summoner.trigger.2',
    name: '水位面之门',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('小亚的声音：水元素大都在大海中活动，所以在陆地上看起来很笨拙。但是它的危险程度却一点都不低！');
      return false;
    },
  },
  {
    key: 'silver.summoner.boss.2',
    name: '流动的水元素',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3000000,
    coldAbsorb: 1,
    exp: 1800,
    atk: 10000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'waterElement.waterArrow.notBreakable',
        level: 0,
      },
      {
        key: 'fishzilla.bomb',
        level: 0,
      },
      {
        key: 'iceNova',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.summoner.trigger.3',
    name: '土位面之门',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('小亚的声音：火位面和水位面都不适合生存，但土位面也没有好到哪里去……漫天的沙尘不知不觉的侵蚀你的心肺，呆久了甚至会被土元素同化。');
      return false;
    },
  },
  {
    key: 'silver.summoner.boss.3',
    name: '沉重的土元素',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 5000000,
    def: 100,
    exp: 1800,
    atk: 15000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/silver.knight.js ──
const __enemies_23 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 10/07/2017.
 */

return  [
  {
    key: 'silver.knight.trigger.1',
    name: '祷告台',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('卡罗兰：年轻的骑士，我感觉到了你内心深处的迷惘。不要躲避它，勇敢的面对。');
      return false;
    },
  },
  {
    key: 'silver.knight.boss.1',
    name: '你内心的迷惘',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3000000,
    exp: 1800,
    atk: 15000,
    level: 160,
    atkSpeed: 0.4,
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
        key: 'shaman.darkball',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.knight.trigger.2',
    name: '祷告台',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('卡罗兰：年轻的骑士，我知道你的迷惘来自何处了。在你年幼的时候，你的家乡曾经被铁蹄践踏，整个村子的人都被屠杀一尽，只有前往森林砍柴的你幸免于难，后来你是怎么做的呢？');
      return false;
    },
  },
  {
    key: 'silver.knight.boss.2',
    name: '面容模糊的敌人',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 3000000,
    exp: 1800,
    atk: 10000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.knight.trigger.3',
    name: '祷告台',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('卡罗兰：是的，你的刀刃染上了敌人的鲜血，当敌人在你面前惨叫、哭嚎时，你突然开始怀疑，你的所作所为是否是正确的，你是否已经成为了你自己曾经最痛恨的人了呢……？');
      return false;
    },
  },
  {
    key: 'silver.knight.boss.3',
    name: '心中的邪念',
    description: '远古野蛮人',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 5000000,
    def: 100,
    exp: 1800,
    atk: 10000,
    level: 160,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 4000,
    affixes: {
      stronger: 1,
    },
    loots: [
      {
        key: 'gold',
        count: [500, 1000],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'silver.knight.trigger.4',
    name: '祷告台',
    description: '生命圣殿。',
    camp: 'shrine',
    race: 'unknown',
    career: 'melee',

    onPress(world) {
      this.kill(false);
      world.sendGeneralMsg('卡罗兰：年轻的骑士，我想你已经认清了正义和邪恶的区别，坚定了自己内心的信念。如果你再一次感到迷茫，请再来找我，我会为你指明方向。');
      return false;
    },
  },
];

})();

// ── 原 data/enemies/chapter5.undeads.js ──
const __enemies_24 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'chapter5.undead.ghost',
    name: '受折磨的灵魂',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 250000,
    atk: 2400,
    atkSpeed: 0.4,
    allResist: 50,
    exp: 500,
    level: 184,
    skills: [
      {
        key: 'shaman.darkball',
        level: 0,
      },
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [75, 200],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter5.undead.zombie',
    name: '不安份的尸体',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 300000,
    def: 50,
    exp: 550,
    atk: 2200,
    level: 186,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [5, 20],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
      {
        type: 'ticket',
        rate: 0.0025,
        dungeons: {
          'chapter4.westRolan1': 4,
          'chapter4.westRolan2': 2,
          'chapter5.byer2': 1,
        },
      },
    ],
  },

  {
    key: 'chapter5.necromancer',
    name: '邪恶法师奈布',
    description: '狗头人的大王，最萌了~ \u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 8000000,
    hpRecovery: 500,
    exp: 1800,
    atk: 15000,
    level: 190,
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
        key: 'chapter4.humans.seck.healthDrill',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
      {
        key: 'zombie.hide',
        level: 0,
      },
    ],
    stunResist: 5000,
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [700, 1500],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/chapter5.woodElf.js ──
const __enemies_25 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'chapter5.woodElf.crazy',
    name: '发疯的木灵',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 350000,
    atk: 2400,
    atkSpeed: 0.4,
    allResist: 50,
    exp: 550,
    level: 194,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'simba.thumpHead',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [150, 200],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.1,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter5.woodElf.sad',
    name: '悲痛过度的木灵',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 500000,
    def: 50,
    exp: 650,
    atk: 3000,
    level: 196,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [150, 300],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1.5,
      },
      {
        type: 'ticket',
        rate: 0.005,
        dungeons: {
          'chapter4.westRolan2': 2,
          'chapter5.byer2': 2,
          'chapter5.byer4': 1,
        },
      },
    ],
  },

  {
    key: 'chapter5.woodElf.shamansa',
    name: '暴食的萨曼莎',
    description: '狗头人的大王，最萌了~ \u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 5000000,
    hpRecovery: 2500,
    exp: 2400,
    atk: 15000,
    level: 200,
    atkSpeed: 0.6,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'slime.swallow',
        level: 0,
      },
      {
        key: 'shamansa.spew',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 5000,
    loots: [
      {
        key: 'gold',
        count: [700, 1500],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter5.woodElf.arms',
    name: '恐怖的残肢',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 150000,
    atk: 2400,
    atkSpeed: 0.4,
    allResist: 50,
    level: 194,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
    ],
  },
  {
    key: 'chapter5.woodElf.rosa',
    name: '懒惰的罗莎',
    description: '狗头人的大王，最萌了~ \u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 8000000,
    hpRecovery: 2500,
    exp: 2400,
    atk: 18000,
    level: 200,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'rosa.sleepy',
        level: 0,
      },
      {
        key: 'rosa.angry',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 5000,
    loots: [
      {
        key: 'gold',
        count: [700, 1500],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

// ── 原 data/enemies/chapter5.daughter.js ──
const __enemies_26 = ((): EnemyEntry[] => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  [
  {
    key: 'chapter5.daughter.monster1',
    name: '黑暗之灵',
    description: '',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 500000,
    atk: 3000,
    atkSpeed: 0.4,
    def: 50,
    allResist: 50,
    exp: 700,
    level: 204,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'shaman.darkball',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [180, 250],
        rate: 0.5,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1,
      },
      {
        type: 'ticket',
        rate: 0.005,
        dungeons: {
          'chapter5.byer4': 1,
          'chapter5.byer6': 1,
        },
      },
    ],
  },
  {
    key: 'chapter5.daughter.monster2',
    name: '孤独之灵',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 500000,
    def: 50,
    allResist: 50,
    exp: 700,
    atk: 3000,
    level: 204,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'chapter5.daughter.monster2',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [180, 250],
        rate: 0.5,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter5.daughter.monster3',
    name: '疼痛之灵',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 500000,
    def: 50,
    allResist: 50,
    exp: 700,
    atk: 3000,
    level: 204,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'enemy.evil.reading1',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [180, 250],
        rate: 0.5,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter5.daughter.monster4',
    name: '惊悸之灵',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 500000,
    def: 50,
    allResist: 50,
    exp: 700,
    atk: 3000,
    level: 204,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'chapter5.daughter.monster4',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [180, 250],
        rate: 0.5,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter5.daughter.monster5',
    name: '寒冷之灵',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 500000,
    def: 50,
    allResist: 50,
    exp: 700,
    atk: 3000,
    level: 204,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'shaman.iceball',
        level: 0,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [180, 250],
        rate: 0.5,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter5.daughter.monster6',
    name: '饥饿之灵',
    description: '会玩火的狗头人，还是好萌。\u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 500000,
    def: 50,
    allResist: 50,
    exp: 700,
    atk: 3000,
    level: 204,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'chapter4.humans.seck.healthDrill',
        level: 20,
      },
    ],
    affixes: {
      stronger: 2,
      faster: 1,
      recover: 0.5,
    },
    loots: [
      {
        key: 'gold',
        count: [180, 250],
        rate: 0.5,
      },
      {
        type: 'equip',
        rate: 0.15,
        mfRate: 1,
      },
    ],
  },
  {
    key: 'chapter5.daughter.badGiant',
    name: '吃小孩的巨人',
    description: '狗头人的大王，最萌了~ \u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 10000000,
    def: 50,
    allResist: 50,
    hpRecovery: 2500,
    exp: 3000,
    atk: 10000,
    level: 210,
    atkSpeed: 0.4,
    skills: [
      {
        key: 'melee',
        level: 0,
      },
      {
        key: 'slime.swallow',
        level: 0,
      },
      {
        key: 'shockWave',
        level: 0,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 5000,
    loots: [
      {
        key: 'gold',
        count: [850, 1800],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
  {
    key: 'chapter5.daughter.amira',
    name: '艾米拉',
    description: '狗头人的大王，最萌了~ \u{1F525}',
    camp: 'enemy',
    race: 'unknown',
    career: 'melee',
    maxHp: 10000000,
    def: 50,
    allResist: 50,
    hpRecovery: 2500,
    exp: 3000,
    atk: 10000,
    level: 210,
    atkSpeed: 0.4,
    speedRate: 1.5,
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
        key: 'chapter5.daughter.monster2',
        level: 0,
      },
      {
        key: 'enemy.evil.reading1',
        level: 0,
      },
      {
        key: 'chapter5.daughter.monster4',
        level: 0,
      },
      {
        key: 'shaman.iceball',
        level: 0,
      },
      {
        key: 'chapter4.humans.seck.healthDrill',
        level: 20,
      },
      {
        key: 'enemy.upgrade',
        level: 0,
      },
    ],
    stunResist: 5000,
    loots: [
      {
        key: 'gold',
        count: [850, 1800],
        rate: 1,
      },
      {
        type: 'equip',
        rate: 1,
        mfRate: 2,
      },
    ],
  },
];

})();

export const enemies: Record<string, EnemyEntry> = arrayToMap([
  ...__enemies_0,
  ...__enemies_1,
  ...__enemies_2,
  ...__enemies_3,
  ...__enemies_4,
  ...__enemies_5,
  ...__enemies_6,
  ...__enemies_7,
  ...__enemies_8,
  ...__enemies_9,
  ...__enemies_10,
  ...__enemies_11,
  ...__enemies_12,
  ...__enemies_13,
  ...__enemies_14,
  ...__enemies_15,
  ...__enemies_16,
  ...__enemies_17,
  ...__enemies_18,
  ...__enemies_19,
  ...__enemies_20,
  ...__enemies_21,
  ...__enemies_22,
  ...__enemies_23,
  ...__enemies_24,
  ...__enemies_25,
  ...__enemies_26,
]);
