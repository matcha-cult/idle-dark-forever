/**
 * ⚠️ 由原版 `data/maps/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 随机一律走注入的 `Rng` 端口，本文件**零** `Math.random()`：
 *    词缀 / 传奇的 `generate` 用形参 `rng`；技能 / buff / 强化 hook 用 `world.rng.skill`（标签 `'skill'`）。
 */

import type { AttackLike, BuffStateLike, ComboLike, MapEntry, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/maps/home.js ──
const __maps_0 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'home',
  name: '自宅',
  hint: '安全的避难所。休息够了就可以再度出发。',
};

})();

// ── 原 data/maps/town/street.js ──
const __maps_1 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.street',
  name: '村间小路',
  hint: '边境之村通往邻村的一条小路。',
  requirement: {
  },
  monsters: [
    {
      type: 'slime.minimal',
      warmup: 1000,
      delay: 5000,
      max: 2,
      quality: [81, 9, 1],
    },
    {
      type: 'slime.giant',
      warmup: 120000,
      delay: 120000,
      max: 1,
      quality: [49, 7, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/town/cave.js ──
const __maps_2 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.cave',
  name: '洞窟一层',
  hint: '边境之村通往邻村的一条小路旁的洞窟，里面阴森且潮湿。',
  requirement: {
  },
  monsters: [
    {
      type: 'slime.minimal',
      warmup: 1000,
      delay: 10000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      type: 'slime.minimal',
      warmup: 6000,
      delay: 10000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      type: 'slime.giant.enemy',
      warmup: 15000,
      delay: 60000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/town/cave2.js ──
const __maps_3 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.cave2',
  name: '洞窟深处',
  hint: '洞穴的底层，让人隐隐赶到不安。',
  isDungeon: true,
  outside: 'town.cave',
  requirement: {
  },
  phases: [
    {
      description: '击败母体史莱姆，拯救亚莲娜。',
      monsters: [
        {
          type: 'slime.queen',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'slime.minimal',
      warmup: 1000,
      delay: 10000,
      max: 2,
    },
    {
      type: 'slime.minimal',
      warmup: 6000,
      delay: 10000,
      max: 2,
    },
    {
      type: 'slime.giant.enemy',
      warmup: 10000,
      delay: 30000,
      max: 2,
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 30,
  level: 30,
  exp: 5000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [1000, 2000],
    },  ],
};

})();

// ── 原 data/maps/town/valley.js ──
const __maps_4 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.valley',
  name: '山谷',
  hint: '靠近邻村的山谷，有各种各样的野兽。',
  requirement: {
  },
  monsters: [
    {
      type: 'wolf.minimal',
      warmup: 1000,
      delay: 10000,
      max: 4,
      quality: [49, 7, 1],
    },
    {
      type: 'wolf.giant',
      warmup: 15000,
      delay: 60000,
      max: 1,
      quality: [100, 10],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/town/woods.js ──
const __maps_5 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.woods',
  name: '迷雾森林',
  hint: '山谷底部的森林，笼罩在雾气之中。',
  isDungeon: true,
  outside: 'town.valley',
  requirement: {
  },
  phases: [
    {
      description: '击败狼王。',
      monsters: [
        {
          type: 'wolf.king',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'wolf.minimal',
      warmup: 1000,
      delay: 30000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      type: 'wolf.minimal',
      warmup: 6000,
      delay: 30000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      type: 'wolf.giant',
      warmup: 10000,
      delay: 30000,
      max: 2,
      quality: [25, 5, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 40,
  level: 40,
  exp: 20000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [25, 5000],
    },  ],
};

})();

// ── 原 data/maps/town/mine-1.js ──
const __maps_6 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.mine.1',
  name: '矿洞入口',
  hint: '一个看似废弃已久的矿洞，被附近的狗头人霸占了。',
  requirement: {
  },
  monsters: [
    {
      type: 'kobold.miner',
      warmup: 1000,
      delay: 10000,
      max: 4,
      quality: [49, 7, 1],
    },
    {
      type: 'kobold.shaman',
      warmup: 15000,
      delay: 60000,
      max: 1,
      quality: [100, 10],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/town/mine-2.js ──
const __maps_7 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.mine.2',
  name: '矿洞深处',
  hint: '金牙居住之处。',
  isDungeon: true,
  outside: 'town.mine.1',
  requirement: {
  },
  phases: [
    {
      description: '击败金牙，探听村长的情报。',
      monsters: [
        {
          type: 'kobold.goldteeth',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'kobold.miner',
      warmup: 1000,
      delay: 10000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'kobold.miner',
      warmup: 1000,
      delay: 10000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'kobold.shaman',
      warmup: 10000,
      delay: 30000,
      max: 2,
      quality: [25, 5, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 50,
  level: 50,
  exp: 80000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [4000, 7000],
    },  ],
};

})();

// ── 原 data/maps/town/mine-3.js ──
const __maps_8 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.mine.3',
  name: '神秘祭坛',
  hint: '矿洞深处的祭坛，通往下位面的传送门。',
  isDungeon: true,
  outside: 'town.mine.1',
  requirement: {
  },
  phases: [
    {
      description: '击败卡卡列夫的幻象，找回村长',
      monsters: [
        {
          type: 'kakarif.illusion',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'kakarif.generations',
      warmup: 1000,
      delay: 10000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'kakarif.generations',
      warmup: 1000,
      delay: 10000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'kakarif.servants',
      warmup: 10000,
      delay: 30000,
      max: 2,
      quality: [25, 5, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 60,
  level: 60,
  exp: 120000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [5000, 10000],
    },  ],
};

})();

// ── 原 data/maps/town/neighbourTown.js ──
const __maps_9 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.neighbourTown',
  name: '邻村',
  hint: '隔壁的村子。当亚莲娜赶到时，所有的村民都发狂了。',
  requirement: {
  },
  monsters: [
    {
      type: 'zombies.farmer',
      warmup: 1000,
      delay: 10000,
      max: 4,
      quality: [49, 7, 1],
    },
    {
      type: 'zombies.hammersmith',
      warmup: 15000,
      delay: 60000,
      max: 1,
      quality: [100, 10],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/town/neighbourTown-1.js ──
const __maps_10 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.neighbourTown.2',
  name: '幽暗的地窖',
  hint: '一个亡灵法师在这里布置了一个招魂阵法。',
  isDungeon: true,
  outside: 'town.neighbourTown',
  requirement: {
  },
  phases: [
    {
      description: '击败亡灵法师，阻止他的邪恶魔法。',
      monsters: [
        {
          type: 'zombie.necromancer',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'zombies.farmer',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'zombies.farmer',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'zombies.hammersmith',
      warmup: 10000,
      delay: 30000,
      max: 1,
      quality: [25, 5, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 50,
  level: 50,
  exp: 80000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [4000, 7000],
    },  ],
};

})();

// ── 原 data/maps/town/neighbourTown-2.js ──
const __maps_11 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'town.neighbourTown.3',
  name: '邻村村口',
  hint: '闻讯赶来的圣殿骑士团保卫了整个村子。',
  isDungeon: true,
  outside: 'town.neighbourTown',
  requirement: {
  },
  phases: [
    {
      description: '阻止骑士团对村民的屠杀。',
      monsters: [
        {
          type: 'knight.leader',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'knight.normal',
      warmup: 1000,
      delay: 10000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'knight.normal',
      warmup: 1000,
      delay: 10000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'knight.prayer',
      warmup: 10000,
      delay: 30000,
      max: 2,
      quality: [25, 5, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 60,
  level: 60,
  exp: 120000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [5000, 10000],
    },  ],
};

})();

// ── 原 data/maps/chapter3/road.js ──
const __maps_12 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.road',
  name: '大路',
  hint: '很宽的马路。',
  requirement: {
  },
  monsters: [
    {
      type: 'chapter3.undead.ghost',
      warmup: 1000,
      delay: 10000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter3.undead.zombie',
      warmup: 6000,
      delay: 15000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/chapter3/shelter773.js ──
const __maps_13 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.shelter773',
  name: '庇护所773号',
  hint: '一个被亡灵化了的庇护所',
  isDungeon: true,
  outside: 'chapter3.road',
  requirement: {
  },
  phases: [
    {
      description: '击败暗影法师奈布。',
      monsters: [
        {
          type: 'chapter3.necromancer',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'chapter3.undead.ghost',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.undead.ghost',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.undead.zombie',
      warmup: 6000,
      delay: 20000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.undead.zombie',
      warmup: 14000,
      delay: 20000,
      max: 2,
      quality: [25, 5, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 70,
  level: 70,
  exp: 180000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [10000, 20000],
    },  ],
};

})();

// ── 原 data/maps/chapter3/wood.js ──
const __maps_14 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.wood',
  name: '边界森林',
  hint: '抵达奥兰帝国的必经之路。',
  requirement: {
  },
  monsters: [
    {
      type: 'chapter3.beast.wildpig',
      warmup: 1000,
      delay: 10000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter3.beast.lion',
      warmup: 6000,
      delay: 15000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/chapter3/wood1.js ──
const __maps_15 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.wood1',
  name: '森林深处',
  hint: '抵达奥兰帝国的必经之路。',
  isDungeon: true,
  outside: 'chapter3.wood',
  requirement: {
  },
  phases: [
    {
      description: '击败辛巴、彭彭和丁满。',
      monsters: [
        {
          type: 'chapter3.beast.pengpeng',
          total: 1,
        },
        {
          type: 'chapter3.beast.simba',
          total: 1,
        },
        {
          type: 'chapter3.beast.dingman',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'chapter3.beast.wildpig',
      warmup: 1000,
      delay: 10000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter3.beast.lion',
      warmup: 6000,
      delay: 15000,
      max: 2,
      quality: [49, 7, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 80,
  level: 80,
  exp: 180000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [15000, 25000],
    },  ],
};

})();

// ── 原 data/maps/chapter3/auran.js ──
const __maps_16 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.auran',
  name: '奥兰境内',
  hint: '抵达奥兰帝国的必经之路。',
  requirement: {
  },
  monsters: [
    {
      type: 'chapter3.murloc.minions',
      warmup: 1000,
      delay: 10000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter3.murloc.shaman',
      warmup: 6000,
      delay: 15000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/chapter3/auran1.js ──
const __maps_17 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.auran1',
  name: '湖畔镇',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter3.auran',
  requirement: {
  },
  phases: [
    {
      description: '击败鱼人督军，拯救被鱼人袭击的当地村民。',
      monsters: [
        {
          type: 'chapter3.murloc.warlord',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'chapter3.murloc.minions',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.murloc.minions',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.murloc.shaman',
      warmup: 6000,
      delay: 20000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.murloc.shaman',
      warmup: 14000,
      delay: 20000,
      max: 2,
      quality: [25, 5, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 90,
  level: 90,
  exp: 300000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [18000, 30000],
    },  ],
};

})();

// ── 原 data/maps/chapter3/auran2.js ──
const __maps_18 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.auran2',
  name: '闪光湖',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter3.auran',
  requirement: {
  },
  phases: [
    {
      description: '击败巨型海怪鱼斯拉。',
      monsters: [
        {
          type: 'chapter3.fishzilla',
          warmup: 25000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'chapter3.fishzilla.magician',
      warmup: 5000,
      delay: 10000,
      max: 5,
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 100,
  level: 100,
  exp: 400000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [20000, 40000],
    },  ],
};

})();

// ── 原 data/maps/chapter3/tower1.js ──
const __maps_19 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.tower1',
  name: '混乱元素之塔',
  hint: '小湖边的镇子，到处都是鱼人。',
  requirement: {
  },
  monsters: [
    {
      type: 'chapter3.element.fire',
      warmup: 5000,
      delay: 30000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.element.water',
      warmup: 15000,
      delay: 30000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.element.earth',
      warmup: 25000,
      delay: 30000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/chapter3/tower2.js ──
const __maps_20 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.tower2',
  name: '混乱元素王座',
  isDungeon: true,
  outside: 'chapter3.tower1',
  hint: '小湖边的镇子，到处都是鱼人。',
  requirement: {
  },
  phases: [
    {
      description: '击败失去控制的阿撒托斯的分身',
      monsters: [
        {
          type: 'chapter3.element.azathoth.fire',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'chapter3.element.fire',
      warmup: 5000,
      delay: 60000,
      max: 1,
      quality: [25, 2],
    },
    {
      type: 'chapter3.element.water',
      warmup: 25000,
      delay: 60000,
      max: 1,
      quality: [25, 2],
    },
    {
      type: 'chapter3.element.earth',
      warmup: 45000,
      delay: 60000,
      max: 1,
      quality: [25, 2],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 110,
  level: 110,
  exp: 500000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [25000, 50000],
    },  ],
};

})();

// ── 原 data/maps/chapter3/auran3.js ──
const __maps_21 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.auran3',
  name: '卡格西城',
  hint: '小湖边的镇子，到处都是鱼人。',
  requirement: {
  },
  monsters: [
    {
      type: 'chapter3.waterElement.nagaHero',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.waterElement',
      warmup: 6000,
      delay: 20000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.waterElement.giants',
      warmup: 30000,
      delay: 50000,
      max: 1,
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/chapter3/auran4.js ──
const __maps_22 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter3.auran4',
  name: '雨之都卡格西',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter3.auran3',
  requirement: {
  },
  phases: [
    {
      description: '击败奈因洛斯降临的分身',
      monsters: [
        {
          type: 'chapter3.waterElement.Nynnroth',
          total: 1,
        },
        {
          type: 'shrine.nynnroth.shield',
          max: 1,
          warmup: 15000,
          delay: 30000,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'chapter3.waterElement.nagaHero',
      warmup: 1000,
      delay: 15000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.waterElement',
      warmup: 6000,
      delay: 25000,
      max: 2,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter3.waterElement.giants',
      warmup: 30000,
      delay: 50000,
      max: 1,
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 120,
  level: 120,
  exp: 750000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [40000, 60000],
    },  ],
};

})();

// ── 原 data/maps/chapter4/westRolan.js ──
const __maps_23 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter4.westRolan',
  name: '东罗兰帝国',
  requirement: {
  },
  monsters: [
    {
      type: 'chapter4.orcs.warrior',
      warmup: 1000,
      delay: 10000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter4.orcs.hunter',
      warmup: 6000,
      delay: 15000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/chapter4/westRolan1.js ──
const __maps_24 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter4.westRolan1',
  name: '卡尔要塞',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter4.westRolan',
  requirement: {
  },
  phases: [
    {
      description: '击败汹涌的狼群。',
      monsters: [
        {
          type: 'chapter3.orcs.wolf',
          max: 2,
          delay: 8000,
          total: 4,
        },
        {
          type: 'chapter3.orcs.wolf',
          max: 2,
          delay: 8000,
          total: 4,
        },
        {
          type: 'chapter3.orcs.wolf',
          max: 2,
          delay: 8000,
          total: 4,
        },
        {
          type: 'chapter3.orcs.wolf',
          max: 2,
          delay: 8000,
          total: 4,
        },
      ],
    },
    {
      description: '击败兽人酋长萨布罗·霜狼。',
      monsters: [
        {
          type: 'chapter3.orcs.shaman',
          max: 1,
          delay: 8000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'chapter4.orcs.warrior',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter4.orcs.warrior',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter4.orcs.hunter',
      warmup: 6000,
      delay: 20000,
      max: 2,
      quality: [25, 5, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 130,
  level: 130,
  exp: 1000000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [50000, 100000],
    },  ],
};

})();

// ── 原 data/maps/chapter4/westRolan2.js ──
const __maps_25 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter4.westRolan2',
  name: '司璐登监狱',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter4.westRolan',
  requirement: {
  },
  phases: [
    {
      description: '击败流氓和小偷的偷袭。',
      monsters: [
        {
          type: 'chapter4.humans.thief',
          max: 2,
          delay: 20000,
          total: 4,
        },
        {
          type: 'chapter4.humans.thief',
          max: 2,
          delay: 20000,
          warmup: 12000,
          total: 4,
        },
        {
          type: 'chapter4.humans.rogue',
          max: 2,
          delay: 20000,
          warmup: 6000,
          total: 4,
        },
        {
          type: 'chapter4.humans.rogue',
          max: 2,
          delay: 20000,
          warmup: 16000,
          total: 4,
        },
      ],
    },
    {
      description: '击败手黑党的领袖罗兰·赛克。',
      monsters: [
        {
          type: 'chapter4.humans.seck',
          max: 1,
          delay: 8000,
          total: 1,
        },
      ],
    },
    {
      description: '再次击败手黑党的领袖罗兰·赛克。这货绑了灵魂石。',
      monsters: [
        {
          type: 'chapter4.humans.seck1',
          max: 1,
          delay: 8000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 140,
  level: 140,
  exp: 1500000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [75000, 100000],
    },  ],
};

})();

// ── 原 data/maps/chapter4/sanAnthony.js ──
const __maps_26 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter4.sanAnthony',
  name: '圣安东尼帝国',
  requirement: {
  },
  monsters: [
    {
      type: 'chapter4.humans.soldier',
      warmup: 1000,
      delay: 10000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter4.humans.musketeer',
      warmup: 6000,
      delay: 15000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter4.humans.mortar',
      warmup: 18000,
      delay: 40000,
      max: 1,
      quality: [49, 7, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/chapter4/sanAnthony1.js ──
const __maps_27 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter4.sanAnthony1',
  name: '四骑士圣殿',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter4.sanAnthony',
  requirement: {
  },
  phases: [
    {
      description: '抵挡迫击炮的齐射。',
      monsters: [
        {
          type: 'chapter4.humans.mortar',
          max: 1,
          warmup: 1000,
          delay: 5000,
          total: 2,
        },
        {
          type: 'chapter4.humans.mortar',
          max: 1,
          warmup: 3000,
          delay: 5000,
          total: 2,
        },
        {
          type: 'chapter4.humans.mortar',
          max: 1,
          warmup: 5000,
          delay: 5000,
          total: 2,
        },
        {
          type: 'chapter4.humans.mortar',
          max: 1,
          warmup: 7000,
          delay: 5000,
          total: 2,
        },
        {
          type: 'chapter4.humans.mortar',
          max: 1,
          warmup: 9000,
          delay: 5000,
          total: 2,
        },
        {
          type: 'chapter4.humans.mortar',
          max: 1,
          warmup: 11000,
          delay: 5000,
          total: 2,
        },
      ],
    },
    {
      description: '击败英勇骑士达尔。',
      monsters: [
        {
          type: 'chapter4.humans.knights.dare',
          max: 1,
          warmup: 8000,
          delay: 8000,
          total: 1,
        },
      ],
    },
    {
      description: '击败光明骑士莱特和鲜血骑士布莱德。',
      monsters: [
        {
          type: 'chapter4.humans.knights.blood',
          max: 1,
          warmup: 8000,
          delay: 8000,
          total: 1,
        },
        {
          type: 'chapter4.humans.knights.light',
          max: 1,
          warmup: 8000,
          delay: 8000,
          total: 1,
        },
      ],
    },
    {
      description: '击败制裁骑士山新和全能骑士雷格。没错，四骑士组合有五个人。',
      monsters: [
        {
          type: 'chapter4.humans.knights.sanction',
          max: 1,
          warmup: 8000,
          delay: 8000,
          total: 1,
        },
        {
          type: 'chapter4.humans.knights.rage',
          max: 1,
          warmup: 8000,
          delay: 8000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'chapter4.humans.soldier',
      warmup: 1000,
      delay: 20000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter4.humans.musketeer',
      warmup: 1000,
      delay: 30000,
      max: 3,
      quality: [25, 5, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 300,
  level: 150,
  exp: 1800000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [75000, 150000],
    },  ],
};

})();

// ── 原 data/maps/chapter4/sanAnthony2.js ──
const __maps_28 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter4.sanAnthony2',
  name: '未知暗殿',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter4.sanAnthony',
  requirement: {
  },
  phases: [
    {
      description: '触动把手，打开秘密的通道。',
      monsters: [
        {
          type: 'chapter4.humans.trigger.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '进入下水道，揭开未知暗殿的奥秘。',
      monsters: [
        {
          type: 'chapter4.humans.trigger.2',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '通过陷阱阵。',
      monsters: [
        {
          type: 'chapter4.humans.trigger.3.1',
          max: 1,
          randomPosition: true,
          delay: 10,
          total: 1,
        },
        {
          type: 'chapter4.humans.trigger.3.2',
          max: 3,
          randomPosition: true,
          delay: 10,
          total: 3,
        },
        {
          type: 'chapter4.humans.trigger.3.3',
          max: 3,
          randomPosition: true,
          delay: 10,
          total: 3,
        },
        {
          type: 'chapter4.humans.trigger.3.4',
          max: 3,
          randomPosition: true,
          delay: 10,
          total: 3,
        },
      ],
    },
    {
      description: '击败守门人菲尔斯男爵',
      monsters: [
        {
          type: 'chapter4.humans.boss.fearas',
          max: 1,
          delay: 10,
          total: 1,
        },
      ],
    },
    {
      description: '打开监狱的牢笼，释放强大的邪恶',
      monsters: [
        {
          type: 'chapter4.humans.trigger.6',
          max: 1,
          warmup: 1000,
          delay: 10,
          total: 1,
        },
      ],
    },
    {
      description: '击败……哈？',
      monsters: [
        {
          type: 'chapter4.humans.boss.milhous',
          max: 1,
          delay: 10,
        },
        {
          type: 'chapter4.humans.trigger.6',
          max: 1,
          warmup: 2000,
          delay: 10,
          total: 1,
        },
      ],
    },
    {
      description: '击败解除封印的上古邪恶。',
      monsters: [
        {
          type: 'chapter4.humans.boss.evil',
          max: 1,
          delay: 10,
          total: 1,
        },
      ],
    },
  ],
  monsters: [],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 320,
  level: 160,
  exp: 2200000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [100000, 150000],
    },  ],
};

})();

// ── 原 data/maps/silver/warrior.js ──
const __maps_29 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'silver.warrior',
  name: '白银试炼 - 战士',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter4.sanAnthony',
  requirement: {
    career: 'warrior',
    level: 60,
    atMostMaxLevel: 60,
  },
  phases: [
    {
      description: '进行坚毅试炼。',
      monsters: [
        {
          type: 'silver.warrior.trigger.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '击败科力克。',
      monsters: [
        {
          type: 'silver.warrior.boss.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '进行勇气试炼。',
      monsters: [
        {
          type: 'silver.warrior.trigger.2',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '击败马道克和士兵们。',
      monsters: [
        {
          type: 'silver.warrior.boss.2',
          max: 1,
          delay: 5000,
          total: 1,
        },
        {
          type: 'chapter4.humans.soldier',
          max: 3,
          delay: 10000,
          total: 6,
        },
        {
          type: 'chapter4.humans.musketeer',
          max: 3,
          delay: 10000,
          warmup: 3000,
          total: 6,
        },
        {
          type: 'chapter4.humans.soldier',
          max: 3,
          delay: 10000,
          warmup: 5000,
          total: 6,
        },
        {
          type: 'chapter4.humans.musketeer',
          max: 3,
          delay: 10000,
          warmup: 8000,
          total: 6,
        },
      ],
    },
    {
      description: '进行技巧试炼。',
      monsters: [
        {
          type: 'silver.warrior.trigger.3',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '击败塔里克。',
      monsters: [
        {
          type: 'silver.warrior.boss.3',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [
  ],
  resetPrice: -1,
  level: 180,
  loots: [
    {
      type: 'maxLevel',
      value: 70,
    },
  ],
};

})();

// ── 原 data/maps/silver/assassin.js ──
const __maps_30 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'silver.assassin',
  name: '白银试炼 - 刺客',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter4.sanAnthony',
  requirement: {
    career: 'assassin',
    level: 60,
    atMostMaxLevel: 60,
  },
  phases: [
    {
      description: '进行刺杀试炼。',
      monsters: [
        {
          type: 'silver.assassin.trigger.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '在保镖赶到前刺杀目标一号。',
      monsters: [
        {
          type: 'silver.assassin.boss.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
        {
          type: 'silver.assassin.boss.1.summon',
          max: 1,
          warmup: 30000,
        },
        {
          type: 'silver.assassin.boss.1.summon',
          max: 1,
          warmup: 30000,
        },
        {
          type: 'silver.assassin.boss.1.summon',
          max: 1,
          warmup: 30000,
        },
        {
          type: 'silver.assassin.boss.1.summon',
          max: 1,
          warmup: 30000,
        },
        {
          type: 'silver.assassin.boss.1.summon',
          max: 1,
          warmup: 30000,
        },
      ],
    },
    {
      description: '进行闪避试炼。',
      monsters: [
        {
          type: 'silver.assassin.trigger.2',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '进行战斗试炼。',
      monsters: [
        {
          type: 'silver.assassin.trigger.3',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '击败寇马克。',
      monsters: [
        {
          type: 'silver.assassin.boss.3',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [
  ],
  resetPrice: -1,
  level: 180,
  loots: [
    {
      type: 'maxLevel',
      value: 70,
    },
  ],
};

})();

// ── 原 data/maps/silver/sorceress.js ──
const __maps_31 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'silver.sorceress',
  name: '白银试炼 - 魔法少女',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter4.sanAnthony',
  requirement: {
    career: 'sorceress',
    level: 60,
    atMostMaxLevel: 60,
  },
  phases: [
    {
      description: '进行奥术试炼。',
      monsters: [
        {
          type: 'silver.sorceress.trigger.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '击败奥术灵体。',
      monsters: [
        {
          type: 'silver.sorceress.boss.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '进行数学试炼。',
      monsters: [
        {
          type: 'silver.sorceress.trigger.2',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '从魔力书籍的围困中脱身。',
      monsters: [
        {
          type: 'silver.sorceress.boss.2',
          max: 3,
          delay: 10000,
          total: 6,
        },
        {
          type: 'silver.sorceress.boss.2',
          max: 3,
          delay: 10000,
          warmup: 3000,
          total: 6,
        },
        {
          type: 'silver.sorceress.boss.2',
          max: 3,
          delay: 10000,
          warmup: 5000,
          total: 6,
        },
        {
          type: 'silver.sorceress.boss.2',
          max: 3,
          delay: 10000,
          warmup: 8000,
          total: 6,
        },
      ],
    },
    {
      description: '进行作战试炼。',
      monsters: [
        {
          type: 'silver.sorceress.trigger.3',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '击败恐怖的怪物。',
      monsters: [
        {
          type: 'silver.sorceress.boss.3',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [
  ],
  resetPrice: -1,
  level: 180,
  loots: [
    {
      type: 'maxLevel',
      value: 70,
    },
  ],
};

})();

// ── 原 data/maps/silver/summoner.js ──
const __maps_32 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'silver.summoner',
  name: '白银试炼 - 元素召唤师',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter4.sanAnthony',
  requirement: {
    career: 'elementSommoner',
    level: 60,
    atMostMaxLevel: 60,
  },
  phases: [
    {
      description: '开启火元素试炼。',
      monsters: [
        {
          type: 'silver.summoner.trigger.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '击败火元素。',
      monsters: [
        {
          type: 'silver.summoner.boss.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '开启水元素试炼。',
      monsters: [
        {
          type: 'silver.summoner.trigger.2',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '击败水元素。',
      monsters: [
        {
          type: 'silver.summoner.boss.2',
          max: 1,
          delay: 10000,
          total: 1,
        },
      ],
    },
    {
      description: '开启土元素试炼。',
      monsters: [
        {
          type: 'silver.summoner.trigger.3',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '击败土元素。',
      monsters: [
        {
          type: 'silver.summoner.boss.3',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [
  ],
  resetPrice: -1,
  level: 180,
  loots: [
    {
      type: 'maxLevel',
      value: 70,
    },
  ],
};

})();

// ── 原 data/maps/silver/knight.js ──
const __maps_33 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'silver.knight',
  name: '白银试炼 - 圣骑士',
  hint: '小湖边的镇子，到处都是鱼人。',
  isDungeon: true,
  outside: 'chapter4.sanAnthony',
  requirement: {
    career: 'knight',
    level: 60,
    atMostMaxLevel: 60,
  },
  phases: [
    {
      description: '开始祷告',
      monsters: [
        {
          type: 'silver.knight.trigger.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '击败内心深处的迷惘。',
      monsters: [
        {
          type: 'silver.knight.boss.1',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '继续祷告。',
      monsters: [
        {
          type: 'silver.knight.trigger.2',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '在梦境中复仇。',
      monsters: [
        {
          type: 'silver.knight.boss.2',
          max: 1,
          delay: 5000,
          total: 1,
        },
        {
          type: 'chapter4.humans.soldier',
          max: 3,
          delay: 10000,
          total: 6,
        },
        {
          type: 'chapter4.humans.musketeer',
          max: 3,
          delay: 10000,
          warmup: 3000,
          total: 6,
        },
        {
          type: 'chapter4.humans.soldier',
          max: 3,
          delay: 10000,
          warmup: 5000,
          total: 6,
        },
        {
          type: 'chapter4.humans.musketeer',
          max: 3,
          delay: 10000,
          warmup: 8000,
          total: 6,
        },
      ],
    },
    {
      description: '继续祷告。',
      monsters: [
        {
          type: 'silver.knight.trigger.3',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '阻止你自己。',
      monsters: [
        {
          type: 'silver.knight.boss.3',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
    {
      description: '完成祷告。',
      monsters: [
        {
          type: 'silver.knight.trigger.4',
          max: 1,
          delay: 5000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [
  ],
  resetPrice: -1,
  level: 180,
  loots: [
    {
      type: 'maxLevel',
      value: 70,
    },
  ],
};

})();

// ── 原 data/maps/chapter5/byer1.js ──
const __maps_34 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter5.byer1',
  name: '西拜尔港',
  requirement: {
    atLeastMaxLevel: 70,
  },
  monsters: [
    {
      type: 'chapter5.undead.ghost',
      warmup: 1000,
      delay: 10000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter5.undead.zombie',
      warmup: 6000,
      delay: 15000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/chapter5/byer2.js ──
const __maps_35 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter5.byer2',
  name: '幽暗的货仓',
  hint: '一个亡灵法师在这里布置了一个招魂阵法。',
  isDungeon: true,
  outside: 'chapter5.byer1',
  requirement: {
    atLeastMaxLevel: 70,
  },
  phases: [
    {
      description: '击败亡灵法师，阻止他的邪恶魔法。',
      monsters: [
        {
          type: 'chapter5.necromancer',
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'chapter5.undead.ghost',
      warmup: 1000,
      delay: 8000,
      max: 3,
      quality: [25, 5, 1],
    },
    {
      type: 'chapter5.undead.zombie',
      warmup: 1000,
      delay: 8000,
      max: 3,
      quality: [25, 5, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 190,
  level: 190,
  exp: 1500000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [50000, 100000],
    },  ],
};

})();

// ── 原 data/maps/chapter5/byer3.js ──
const __maps_36 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter5.byer3',
  name: '梦境之森',
  requirement: {
    atLeastMaxLevel: 70,
  },
  monsters: [
    {
      type: 'chapter5.woodElf.crazy',
      warmup: 1000,
      delay: 10000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter5.woodElf.crazy',
      warmup: 1000,
      delay: 10000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter5.woodElf.sad',
      warmup: 6000,
      delay: 15000,
      max: 2,
      quality: [49, 7, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/chapter5/byer4.js ──
const __maps_37 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter5.byer4',
  name: '睡美人湖',
  hint: '一个亡灵法师在这里布置了一个招魂阵法。',
  isDungeon: true,
  outside: 'chapter5.byer1',
  requirement: {
    atLeastMaxLevel: 70,
  },
  phases: [
    {
      description: '击败并安抚节制的萨曼莎。',
      monsters: [
        {
          type: 'chapter5.woodElf.shamansa',
          warmup: 15000,
          total: 1,
        },
      ],
    },
    {
      description: '击败并安抚勤勉的罗莎。',
      monsters: [
        {
          type: 'chapter5.woodElf.rosa',
          warmup: 15000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [
    {
      type: 'chapter5.woodElf.crazy',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter5.woodElf.crazy',
      warmup: 1000,
      delay: 10000,
      max: 3,
      quality: [49, 7, 1],
    },
    {
      type: 'chapter5.woodElf.sad',
      warmup: 6000,
      delay: 15000,
      max: 2,
      quality: [49, 7, 1],
    },
  ],
  coolDown: 24 * 3600 * 1000,
  maxCoolDownStack: 1,
  coolDownOffset: -4 * 3600 * 1000, // 凌晨4点更新
  resetPrice: 200,
  level: 200,
  exp: 1800000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [75000, 120000],
    },  ],
};

})();

// ── 原 data/maps/chapter5/byer5.js ──
const __maps_38 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter5.byer5',
  name: '噩梦边境',
  requirement: {
    atLeastMaxLevel: 70,
  },
  monsters: [
    {
      types: {
        'chapter5.daughter.monster1': 1,
        'chapter5.daughter.monster2': 1,
        'chapter5.daughter.monster3': 1,
        'chapter5.daughter.monster4': 1,
        'chapter5.daughter.monster5': 1,
        'chapter5.daughter.monster6': 1,
      },
      warmup: 1000,
      delay: 6000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      types: {
        'chapter5.daughter.monster1': 1,
        'chapter5.daughter.monster2': 1,
        'chapter5.daughter.monster3': 1,
        'chapter5.daughter.monster4': 1,
        'chapter5.daughter.monster5': 1,
        'chapter5.daughter.monster6': 1,
      },
      warmup: 4000,
      delay: 6000,
      max: 5,
      quality: [49, 7, 1],
    },
    {
      types: {
        'shrine.heal': 10,
        'shrine.energy': 10,
        'shrine.power': 2.5,
      },
      warmup: 300000,
      delay: 300000,
      max: 1,
    },
  ],
};

})();

// ── 原 data/maps/chapter5/byer6.js ──
const __maps_39 = ((): MapEntry => {
/**
 * Created by tdzl2003 on 2/1/17.
 */

return  {
  key: 'chapter5.byer6',
  name: '噩梦巨人国度',
  hint: '一个亡灵法师在这里布置了一个招魂阵法。',
  isDungeon: true,
  outside: 'chapter5.byer1',
  requirement: {
    atLeastMaxLevel: 70,
  },
  phases: [
    {
      description: '击败拦路的噩梦之灵，找到好心的巨人',
      monsters: [
        {
          types: {
            'chapter5.daughter.monster1': 1,
            'chapter5.daughter.monster2': 1,
            'chapter5.daughter.monster3': 1,
            'chapter5.daughter.monster4': 1,
            'chapter5.daughter.monster5': 1,
            'chapter5.daughter.monster6': 1,
          },
          warmup: 1000,
          delay: 6000,
          max: 5,
          total: 10,
        },
      ],
    },
    {
      description: '击败吃小孩的巨人',
      monsters: [
        {
          type: 'chapter5.daughter.badGiant',
          warmup: 5000,
          total: 1,
        },
        {
          type: 'chapter5.woodElf.crazy',
          warmup: 1000,
          delay: 10000,
          max: 3,
          quality: [49, 7, 1],
        },
        {
          type: 'chapter5.woodElf.crazy',
          warmup: 1000,
          delay: 10000,
          max: 3,
          quality: [49, 7, 1],
        },
        {
          type: 'chapter5.woodElf.sad',
          warmup: 6000,
          delay: 15000,
          max: 2,
          quality: [49, 7, 1],
        },
      ],
    },
    {
      description: '唤醒不安的艾米拉',
      monsters: [
        {
          type: 'chapter5.daughter.amira',
          warmup: 5000,
          total: 1,
        },
      ],
    },
  ],
  monsters: [],
  resetPrice: 210,
  level: 210,
  exp: 2200000,
  loots: [
    {
      key: 'gold',
      rate: 1,
      count: [95000, 150000],
    },    {
      type: 'ticket',
      rate: 1,
      dungeons: {
        'nightmare.1': 1,
      },
    },
  ],
};

})();

// ── P8：0 级城镇（出售底材的入口骨架；底材目录下期开工） ──
const __maps_town = ((): MapEntry => ({
  key: 'town',
  name: '边境之村',
  hint: '0 级城镇。可以在这里兑换装备底材（底材目录下期开工）。',
  level: 0,
  monsters: [],
}))();

export const maps: Record<string, MapEntry> = arrayToMap([
  __maps_town,
  __maps_0,
  __maps_1,
  __maps_2,
  __maps_3,
  __maps_4,
  __maps_5,
  __maps_6,
  __maps_7,
  __maps_8,
  __maps_9,
  __maps_10,
  __maps_11,
  __maps_12,
  __maps_13,
  __maps_14,
  __maps_15,
  __maps_16,
  __maps_17,
  __maps_18,
  __maps_19,
  __maps_20,
  __maps_21,
  __maps_22,
  __maps_23,
  __maps_24,
  __maps_25,
  __maps_26,
  __maps_27,
  __maps_28,
  __maps_29,
  __maps_30,
  __maps_31,
  __maps_32,
  __maps_33,
  __maps_34,
  __maps_35,
  __maps_36,
  __maps_37,
  __maps_38,
  __maps_39,
]);
