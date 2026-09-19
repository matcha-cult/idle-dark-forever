/**
 * 测试夹具：**内联最小 `DataTables`**（不依赖 `src/data/`，那是另一个 agent 的产物）。
 *
 * 之所以放在 `*.test.ts` 里：任务约束只允许在
 * `rules/{index,inventory-slot,player-meta,career-info,player,goods,check}.ts + *.test.ts`
 * 下创建文件，因此共享夹具只能挂在一个测试文件上。本文件同时承担「夹具自检」。
 */

import { describe, expect, it } from 'vitest';

import type { DataTables, MapData } from '../contracts/data.js';
import { Mulberry32Rng } from '../rng/index.js';

/** 带 `isEndless` 的地图（冻结的 `MapData` 尚未声明该字段）。 */
type MapWithEndless = MapData & { isEndless?: boolean };

/** 固定种子的确定随机源（测试里禁止真随机）。 */
export function makeRng(seed = 12345): Mulberry32Rng {
  return new Mulberry32Rng(seed);
}

export function createTestTables(): DataTables {
  return {
    careers: {
      warrior: {
        key: 'warrior',
        name: '战士',
        description: '',
        requirement: {},
        equipments: { weapon: 'stickSword', plastron: 'dress' },
        // maxExp(level) = 100 + 10*level + level^2
        expFormula: [100, 10, 1],
        attrGrow: { str: 3, dex: 1, int: 1, sta: 2 },
        skills: { slash: 1, bash: 5 },
        passives: {},
        enhances: { fury: 1 },
        availableClasses: { sword: true },
      },
      mage: {
        key: 'mage',
        name: '法师',
        description: '',
        requirement: {},
        equipments: { weapon: 'stickWand' },
        expFormula: [80, 5],
        attrGrow: { str: 1, dex: 1, int: 3, sta: 1 },
        skills: { bolt: 1 },
        passives: {},
        enhances: {},
        availableClasses: { wand: true },
      },
    },
    roles: {
      Eyer: {
        key: 'Eyer',
        name: '艾尔',
        description: '',
        defaultCareer: 'warrior',
        atk: 1,
        atkSpeed: 1,
        attrBase: { str: 1, dex: 1, int: 1, sta: 1 },
        startup: { potion: 3, stickSword: { quality: 1, affixes: [] } },
      },
    },
    maps: {
      home: { key: 'home', name: '家' },
      dungeon1: {
        key: 'dungeon1',
        name: '试炼地城',
        isDungeon: true,
        defaultTicketCount: 2,
        level: 10,
        cooldown: 0,
      } as MapData,
      endlessDungeon: {
        key: 'endlessDungeon',
        name: '无限回廊',
        isDungeon: true,
        isEndless: true,
        group: 'endlessGroup',
        defaultTicketCount: 5,
        level: 99,
      } as MapWithEndless,
      'nightmare.3': {
        key: 'nightmare.3',
        name: '噩梦3',
        isDungeon: true,
        isEndless: true,
        level: 320,
      } as MapWithEndless,
    },
    enemies: {},
    skills: {
      slash: {
        key: 'slash',
        name: '斩击',
        group: 'melee',
        description: '',
        isAttack: true,
        coolDown: 1,
        maxExp: () => 100,
        effect: () => {},
      },
      bash: {
        key: 'bash',
        name: '重击',
        group: 'melee',
        description: '',
        isAttack: true,
        coolDown: 5,
        expGroup: 'melee',
        maxExp: (level) => 50 + level * 10,
        effect: () => {},
      },
      bolt: {
        key: 'bolt',
        name: '奥术箭',
        group: 'magic',
        description: '',
        isAttack: true,
        coolDown: 2,
        maxExp: () => 100,
        effect: () => {},
      },
    },
    goods: {
      stickSword: {
        key: 'stickSword',
        type: 'equip',
        name: '木剑',
        class: 'sword',
        position: 'weapon',
        price: 10,
        atkSpeed: 1.5,
        minLevel: 0,
        maxLevel: 60,
      },
      stickWand: {
        key: 'stickWand',
        type: 'equip',
        name: '木杖',
        class: 'wand',
        position: 'weapon',
        price: 10,
        atkSpeed: 1.2,
        mpRecovery: 2,
        mpFromKill: 3,
      },
      dress: {
        key: 'dress',
        type: 'equip',
        name: '布衣',
        class: 'cloth',
        position: 'plastron',
        price: 8,
      },
      rattanArmor: {
        key: 'rattanArmor',
        type: 'equip',
        name: '藤甲',
        class: 'lightArmor',
        position: 'plastron',
        price: 20,
        minLevel: 8,
        maxLevel: 80,
      },
      boneShinGuard: {
        key: 'boneShinGuard',
        type: 'equip',
        name: '骨胫甲',
        class: 'armor',
        position: 'gaiter',
        price: 40,
        minLevel: 52,
      },
      charm: {
        key: 'charm',
        type: 'equip',
        name: '护符',
        class: 'ornament',
        position: 'ornament',
        price: 30,
      },
      dust1: { key: 'dust1', type: 'material', name: '尘1', price: 1 },
      piece2: { key: 'piece2', type: 'material', name: '碎片2', price: 2 },
      potion: { key: 'potion', type: 'material', name: '药水', price: 5, stack: 20, energy: 3 },
      ticket: { key: 'ticket', type: 'material', name: '钥石', price: 0, stack: 50 },
      trash: { key: 'trash', type: 'junk', name: '杂物', price: 1 },
      gold: { key: 'gold', type: 'junk', name: '金币', price: 0 },
      diamonds: { key: 'diamonds', type: 'junk', name: '神力', price: 0 },
      box: { key: 'box', type: 'package', name: '礼盒', price: 1, requireInventory: 1 },
    },
    passives: {},
    enhances: { fury: { key: 'fury', name: '狂怒', description: '', hooks: {} } },
    buffs: {},
    affixes: {
      atk: {
        key: 'atk',
        display: (value) => `攻击+${value}`,
        weight: 10,
        generate: (level, rng) => Math.floor(rng.range(1, 5)) + level,
        range: (level) => [level + 1, level + 4],
      },
      str: {
        key: 'str',
        display: (value) => `力量+${value}`,
        weight: 5,
        minLevel: 5,
        validClasses: ['sword'],
        generate: (_level, rng) => rng.int(3) + 1,
        range: () => [1, 3],
      },
      gaiterOnly: {
        key: 'gaiterOnly',
        display: (value) => `护腿+${value}`,
        weight: 1,
        validPositions: ['gaiter'],
        generate: (_level, rng) => rng.int(2) + 1,
        range: () => [1, 2],
      },
      cap: {
        key: 'cap',
        display: (value) => `上限+${value}`,
        weight: 1,
        maxLevel: 10,
        generate: (_level, rng) => rng.int(2) + 1,
        range: () => [1, 2],
      },
      def: {
        key: 'def',
        display: (value) => `防御+${value}`,
        weight: 8,
        generate: (level, rng) => level + rng.int(4),
        range: (level) => [level, level + 3],
      },
      crit: {
        key: 'crit',
        display: (value) => `暴击+${value}`,
        weight: 4,
        generate: (_level, rng) => rng.int(5) + 1,
        range: () => [1, 5],
      },
      luck: {
        key: 'luck',
        display: (value) => `幸运+${value}`,
        weight: 2,
        generate: (_level, rng) => rng.int(9) + 1,
        range: () => [1, 9],
      },
      noWeight: {
        key: 'noWeight',
        display: (value) => `无权重+${value}`,
        weight: 0,
        generate: (_level, rng) => rng.int(2) + 1,
        range: () => [1, 2],
      },
    },
    enemyAffixes: {},
    stories: {
      prologue: {
        key: 'prologue',
        group: 'main',
        name: '序章',
        script: '',
        requirement: {},
        taskType: 'kill',
        awards: {},
      },
    },
    legends: {
      flame: {
        key: 'flame',
        type: 'stickSword',
        itemName: '烈焰木剑',
        itemDescription: '燃烧吧',
        minLevel: 0,
        maxLevel: 100,
        display: (value) => `烈焰${value}`,
        generate: (_level, rng) => rng.int(10) + 1,
        range: () => [1, 10],
      },
      specialOne: {
        key: 'specialOne',
        type: 'stickSword',
        itemName: '特殊传奇',
        special: true,
        display: () => '',
        generate: () => 1,
      },
    },
    medicines: {},
    upgrades: { bankByDiamonds: [], inventoryByDiamonds: [], inventory: [] },
    announcement: { version: 'test' },
  };
}

describe('测试夹具自检', () => {
  it('createTestTables 结构完整且可重复构建（每次返回新对象）', () => {
    const a = createTestTables();
    const b = createTestTables();
    expect(a).not.toBe(b);
    expect(Object.keys(a.careers)).toEqual(['warrior', 'mage']);
    expect(Object.keys(a.goods).length).toBeGreaterThan(5);
    expect(a.maps.dungeon1?.isDungeon).toBe(true);
  });

  it('makeRng 固定种子可重放', () => {
    expect(makeRng(7).next()).toBe(makeRng(7).next());
    expect(makeRng(7).next()).not.toBe(makeRng(8).next());
  });

  it('夹具中的 expFormula 与 maxExp 语义一致（手算对照）', () => {
    const tables = createTestTables();
    const formula = tables.careers.warrior!.expFormula;
    const calculated = formula.map((v, i) => v * 3 ** i).reduce((sum, v) => sum + v, 0);
    expect(calculated).toBe(100 + 30 + 9);
  });
});
