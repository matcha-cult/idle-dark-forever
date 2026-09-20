import { describe, expect, it } from 'vitest';

import { InventorySlot } from './inventory-slot.js';
import {
  DEFAULT_INVENTORY_SIZE,
  MAX_SKILL_LEVEL,
  MAX_TICKET_STACK,
  Player,
  createPlayerAccountState,
  type PlayerAccountState,
} from './player.js';
import { createTestTables } from './fixtures.test.js';

const tables = createTestTables();
const NOW = 1_700_000_000_000;
const now = (): number => NOW;

function makePlayer(account?: PlayerAccountState): Player {
  return new Player(tables, 'p1', now, account);
}

/** 给玩家塞 n 个空格子（原版 `postCreate` 会补到 4 个）。 */
function withBag(player: Player, n = 4): Player {
  while (player.inventory.length < n) {
    player.inventory.push(new InventorySlot(tables, 'inventory'));
  }
  return player;
}

function item(key: string, count: number, extra: Record<string, unknown> = {}): InventorySlot {
  return new InventorySlot(tables, 'loot').fromJSON({ key, count, ...extra });
}

describe('Player 构造与访问器', () => {
  it('默认值与时间注入', () => {
    const player = makePlayer();
    expect(player.key).toBe('p1');
    expect(player.timestamp).toBe(NOW);
    expect(player.gold).toBe(0);
    expect(player.inventory).toEqual([]);
    expect(player.inventoryDiamondLevel).toBe(0);
    expect(player.skillExp.size).toBe(0);
    expect(player.careers.size).toBe(0);
    expect(player.dungeonTickets.size).toBe(0);
    expect(player.minLootLevel).toBe(0);
    expect(player.banned).toBe(false);
    expect(player.isBanned).toBe(false);
    expect(player.timelineId).toBeNull();
  });

  it('无当前职业时所有等级相关访问器返回 0 / 安全空值', () => {
    const player = makePlayer();
    expect(player.careerInfo).toBeUndefined();
    expect(player.level).toBe(0);
    expect(player.maxLevel).toBe(0);
    expect(player.exp).toBe(0);
    expect(player.peakLevel).toBe(0);
    expect(player.peakExp).toBe(0);
    expect(player.maxExp).toBe(0);
    expect(player.maxPeakExp).toBe(0);
    expect(player.equipments).toBeUndefined();

    // setter 不应抛错（原版会 TypeError）
    expect(() => {
      player.level = 5;
      player.maxLevel = 70;
      player.exp = 3;
      player.peakLevel = 1;
      player.peakExp = 2;
    }).not.toThrow();
    expect(player.level).toBe(0);
  });

  it('account 共享引用（神力 / 封禁 / 银行 / updateRate）', () => {
    const account = createPlayerAccountState();
    const player = makePlayer(account);
    expect(player.account).toBe(account);
    account.banned = true;
    expect(player.isBanned).toBe(true);
    player.banned = false;
    expect(player.isBanned).toBe(true);
  });

  it('技能/强化槽位上限随等级变化（边界逐条覆盖）', () => {
    const player = makePlayer();
    player.postCreate();
    const cases: Array<[number, number, number | null, number, number | null]> = [
      // level, maxSkillCount, nextSkillUnlockLevel, maxEnhanceCount, nextEnhanceUnlockLevel
      [1, 2, 10, 0, 10],
      [9, 2, 10, 0, 10],
      [10, 3, 20, 1, 20],
      [19, 3, 20, 1, 20],
      [20, 4, 40, 2, 30],
      [29, 4, 40, 2, 30],
      [30, 4, 40, 3, 60],
      [39, 4, 40, 3, 60],
      [40, 5, 60, 3, 60],
      [59, 5, 60, 3, 60],
      [60, 6, null, 4, null],
      [999, 6, null, 4, null],
    ];
    for (const [level, skills, nextSkill, enhances, nextEnhance] of cases) {
      player.level = level;
      expect(player.maxSkillCount, `level=${level}`).toBe(skills);
      expect(player.nextSkillUnlockLevel, `level=${level}`).toBe(nextSkill);
      expect(player.maxEnhanceCount, `level=${level}`).toBe(enhances);
      expect(player.nextEnhanceUnlockLevel, `level=${level}`).toBe(nextEnhance);
    }
  });
});

describe('postCreate / selectCareer', () => {
  it('postCreate 选默认职业、补满背包、发放初始物资', () => {
    const player = makePlayer();
    player.postCreate();

    expect(player.currentCareer).toBe('warrior');
    expect(player.currentCareerLevel).toBe(1);
    expect(player.inventory).toHaveLength(DEFAULT_INVENTORY_SIZE);
    expect(player.awardInventory).toHaveLength(2);
    expect(player.awardInventory[0]!.key).toBe('potion');
    expect(player.awardInventory[0]!.count).toBe(3);
    expect(player.awardInventory[1]!.key).toBe('stickSword');
    expect(player.awardInventory[1]!.quality).toBe(1);
    expect(player.awardInventory[1]!.level).toBe(1);
  });

  it('selectCareer 建立 CareerInfo：初始技能 = 等级需求 <= 1 的技能，并装备默认武器', () => {
    const player = makePlayer();
    player.selectCareer('warrior');
    const info = player.careers.get('warrior');
    expect(info).toBeDefined();
    expect(info!.selectedSkills).toEqual(['slash']);
    expect(info!.equipments.weapon.key).toBe('stickSword');
    expect(info!.equipments.weapon.level).toBe(1);
    // skillExp 按 expGroup 建组
    expect([...player.skillExp.keys()].sort()).toEqual(['melee', 'slash']);
    expect(player.getCareerLevel('warrior')).toBe(1);
    expect(player.getCareerLevel('nobody')).toBe(0);
  });

  it('selectCareer 幂等（已有 CareerInfo 不会被重置）', () => {
    const player = makePlayer();
    player.selectCareer('warrior');
    player.careers.get('warrior')!.exp = 55;
    player.selectCareer('warrior');
    expect(player.careers.get('warrior')!.exp).toBe(55);
    expect(player.careers.size).toBe(1);
  });

  it('selectCareer 容忍未知职业（不抛错）', () => {
    const player = makePlayer();
    expect(() => player.selectCareer('nobody')).not.toThrow();
    expect(player.currentCareer).toBe('nobody');
    expect(player.skillExp.size).toBe(0);
  });

  it('postLoad 补满背包并选中当前职业', () => {
    const player = makePlayer();
    player.currentCareer = 'mage';
    player.postLoad();
    expect(player.inventory).toHaveLength(DEFAULT_INVENTORY_SIZE);
    expect(player.careers.has('mage')).toBe(true);
  });
});

describe('Player.fromJSON 隐式兼容', () => {
  it('skillExp.level 夹到 70，缺失字段兜底', () => {
    const player = Player.fromJSON(tables, 'p1', now, {
      skillExp: { slash: { level: 999, exp: 12 }, melee: { exp: 3 }, weird: null },
    });
    expect(player.skillExp.get('slash')).toEqual({ level: MAX_SKILL_LEVEL, exp: 12 });
    expect(player.skillExp.get('melee')).toEqual({ level: 0, exp: 3 });
    expect(player.skillExp.get('weird')).toEqual({ level: 0, exp: 0 });
  });

  it('skillExp 也接受 Map 形态', () => {
    const player = Player.fromJSON(tables, 'p1', now, {
      skillExp: new Map([['slash', { level: 3, exp: 1 }]]),
    });
    expect(player.skillExp.get('slash')).toEqual({ level: 3, exp: 1 });
  });

  it('dungeonTickets 缺失时按地图配置补齐，跳过无尽地图', () => {
    const player = Player.fromJSON(tables, 'p1', now, {});
    expect(player.dungeonTickets.get('dungeon1')).toBe(2);
    expect(player.dungeonTickets.has('endlessDungeon')).toBe(false);
    expect(player.dungeonTickets.has('nightmare.3')).toBe(false);
    expect(player.dungeonTickets.has('home')).toBe(false);
  });

  it('dungeonTickets 已有值时保留（含 0）', () => {
    const player = Player.fromJSON(tables, 'p1', now, { dungeonTickets: { dungeon1: 0 } });
    expect(player.dungeonTickets.get('dungeon1')).toBe(0);
  });

  it('dungeonTickets 使用 group 作为键', () => {
    const custom = createTestTables();
    custom.maps.grouped = {
      key: 'grouped',
      name: '分组地城',
      isDungeon: true,
      group: 'sharedGroup',
      defaultTicketCount: 7,
    };
    const player = Player.fromJSON(custom, 'p1', now, {});
    expect(player.dungeonTickets.get('sharedGroup')).toBe(7);
    expect(player.dungeonTickets.has('grouped')).toBe(false);
    expect(player.dungeonTickets.size).toBe(2); // dungeon1 + sharedGroup
  });

  it('背包里的无尽钥石会抬高 highestEndlessLevel', () => {
    const account = createPlayerAccountState();
    Player.fromJSON(tables, 'p1', now, {
      inventory: [
        { key: 'ticket', count: 2, dungeonKey: 'nightmare.3' },
        { key: 'ticket', count: 1, dungeonKey: 'dungeon1' },
      ],
    }, account);
    expect(account.highestEndlessLevel).toBe(3);
  });

  it('dungeonKey 非无尽时不影响 highestEndlessLevel', () => {
    const account = createPlayerAccountState();
    account.highestEndlessLevel = 9;
    Player.fromJSON(tables, 'p1', now, {
      inventory: [{ key: 'ticket', count: 1, dungeonKey: 'dungeon1' }],
    }, account);
    expect(account.highestEndlessLevel).toBe(9);
  });

  it('buildInventory / awardInventory 只保留非空格子', () => {
    const player = Player.fromJSON(tables, 'p1', now, {
      buildInventory: [{ key: 'dust1', count: 2 }, {}, null],
      awardInventory: [{ key: 'stickSword', count: 1 }, { key: null }],
    });
    expect(player.buildInventory).toHaveLength(1);
    expect(player.buildInventory[0]!.position).toBe('build');
    expect(player.awardInventory).toHaveLength(1);
    expect(player.awardInventory[0]!.position).toBe('award');
  });

  it('inventory 保留长度（含空格子）且 position 为 inventory', () => {
    const player = Player.fromJSON(tables, 'p1', now, {
      inventory: [{ key: 'dust1', count: 2 }, {}, { key: 'dress', count: 1 }],
    });
    expect(player.inventory).toHaveLength(3);
    expect(player.inventory[1]!.key).toBeNull();
    expect(player.inventory[0]!.position).toBe('inventory');
  });

  it('careers 同时支持普通对象与 Map', () => {
    const objectForm = Player.fromJSON(tables, 'p1', now, {
      careers: { warrior: { level: 30, exp: 5 } },
    });
    expect(objectForm.careers.get('warrior')!.level).toBe(30);

    const mapForm = Player.fromJSON(tables, 'p1', now, {
      careers: new Map([['mage', { level: 4 }]]),
    });
    expect(mapForm.careers.get('mage')!.level).toBe(4);
    expect(mapForm.currentCareer).toBe('warrior'); // PlayerMeta 默认职业
  });

  it('migrateMap 的值统一归一为 1', () => {
    const player = Player.fromJSON(tables, 'p1', now, { migrateMap: { a: 0, b: 5, c: null } });
    expect([...player.migrateMap.entries()]).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 1],
    ]);
  });

  it('lootRule 保留数值；非数字归一为 0', () => {
    const player = Player.fromJSON(tables, 'p1', now, {
      lootRule: { 'equip:0': 1, 'equip:4': 2, bad: 'x' },
    });
    expect(player.lootRule.get('equip:0')).toBe(1);
    expect(player.lootRule.get('equip:4')).toBe(2);
    expect(player.lootRule.get('bad')).toBe(0);
  });

  it('timestamp 缺失或为 0 时回落到注入的 now()', () => {
    expect(Player.fromJSON(tables, 'p1', now, {}).timestamp).toBe(NOW);
    expect(Player.fromJSON(tables, 'p1', now, { timestamp: 0 }).timestamp).toBe(NOW);
    expect(Player.fromJSON(tables, 'p1', now, { timestamp: 123 }).timestamp).toBe(123);
  });

  it('fromJSON 容忍非对象入参', () => {
    const player = Player.fromJSON(tables, 'p1', now, null);
    expect(player.gold).toBe(0);
    expect(player.timestamp).toBe(NOW);
  });

  it('toJSON → fromJSON 深度等价', () => {
    const account = createPlayerAccountState();
    const original = Player.fromJSON(tables, 'p1', now, {
      gold: 123,
      inventoryDiamondLevel: 2,
      minLootLevel: 5,
      timestamp: 999,
      timelineId: 'timeline-a',
      banned: true,
      skillExp: { slash: { level: 3, exp: 4 } },
      migrateMap: { m1: 1 },
      lootRule: { 'equip:1': 2 },
      dungeonTickets: { dungeon1: 4 },
      inventory: [{ key: 'dust1', count: 2 }, { key: 'stickSword', count: 1, level: 7 }],
      buildInventory: [{ key: 'dust1', count: 1 }],
      awardInventory: [{ key: 'potion', count: 2 }],
      careers: {
        warrior: {
          level: 7,
          exp: 9,
          equipments: { weapon: { key: 'stickSword', count: 1, level: 6 } },
          selectedSkills: ['slash'],
        },
      },
    }, account);

    const restored = Player.fromJSON(tables, 'p1', now, original.toJSON(), account);
    expect(restored.toJSON()).toEqual(original.toJSON());
  });
});

describe('Player.loot', () => {
  it('金币直接进 gold，掷骰子槽位被清空', () => {
    const player = withBag(makePlayer());
    const gold = item('gold', 25);
    player.loot(gold);
    expect(player.gold).toBe(25);
    expect(gold.empty).toBe(true);
  });

  it('神力进账号状态', () => {
    const account = createPlayerAccountState();
    const player = withBag(makePlayer(account));
    player.loot(item('diamonds', 7));
    expect(account.diamonds).toBe(7);
    expect(player.gold).toBe(0);
  });

  it('可堆叠物品按 stack 拆分到多个格子', () => {
    const player = withBag(makePlayer(), 3);
    player.loot(item('potion', 25)); // stack = 20
    expect(player.inventory[0]!.key).toBe('potion');
    expect(player.inventory[0]!.count).toBe(20);
    expect(player.inventory[1]!.key).toBe('potion');
    expect(player.inventory[1]!.count).toBe(5);
    expect(player.inventory[2]!.key).toBeNull();
  });

  it('可堆叠物品继续叠加到已有格子', () => {
    const player = withBag(makePlayer(), 2);
    player.loot(item('potion', 5));
    player.loot(item('potion', 6));
    expect(player.inventory[0]!.count).toBe(11);
    expect(player.inventory[1]!.key).toBeNull();
  });

  it('不可堆叠物品每件占一格；空间不足时整件不拾取', () => {
    const player = withBag(makePlayer(), 2);
    const first = item('stickSword', 1, { level: 5 });
    player.loot(first);
    expect(player.inventory[0]!.key).toBe('stickSword');
    expect(first.empty).toBe(true);

    player.inventory[1]!.fromJSON({ key: 'dress', count: 1 });
    const blocked = item('charm', 1);
    player.loot(blocked);
    expect(blocked.empty).toBe(false); // 仍留在「掉落物」里
    expect(blocked.count).toBe(1);
  });

  it('可堆叠物品空间不足时保留剩余数量', () => {
    const player = withBag(makePlayer(), 1);
    const good = item('potion', 30); // 只放得下 20
    player.loot(good);
    expect(player.inventory[0]!.count).toBe(20);
    expect(good.count).toBe(10);
  });

  it('钥石使用专属堆叠上限（50）并按 dungeonKey 区分格子', () => {
    const player = withBag(makePlayer(), 3);
    expect(MAX_TICKET_STACK).toBe(50);
    player.loot(item('ticket', 60, { dungeonKey: 'dungeon1' }));
    expect(player.inventory[0]!.count).toBe(50);
    expect(player.inventory[1]!.count).toBe(10);
    player.loot(item('ticket', 1, { dungeonKey: 'nightmare.3' }));
    expect(player.inventory[2]!.dungeonKey).toBe('nightmare.3');
  });

  it('拾取无尽钥石会抬高 highestEndlessLevel', () => {
    const account = createPlayerAccountState();
    const player = withBag(makePlayer(account), 2);
    player.loot(item('ticket', 1, { dungeonKey: 'nightmare.5' }));
    expect(account.highestEndlessLevel).toBe(5);
  });

  it('空掉落物被忽略', () => {
    const player = withBag(makePlayer(), 1);
    player.loot(new InventorySlot(tables, 'loot'));
    expect(player.inventory[0]!.key).toBeNull();
  });

  it('未知 key 视为不可堆叠（原版会 TypeError）', () => {
    const player = withBag(makePlayer(), 1);
    expect(() => player.loot(item('no-such-good', 1))).not.toThrow();
    expect(player.inventory[0]!.key).toBe('no-such-good');
  });

  it('可指定其它容器（如银行）', () => {
    const player = makePlayer();
    const bank = [new InventorySlot(tables, 'bank')];
    player.loot(item('dust1', 3), bank);
    expect(bank[0]!.key).toBe('dust1');
    expect(player.inventory).toEqual([]);
  });
});

describe('Player.sellItem', () => {
  it('普通格子：扣数量、归零则清空、金币入账', () => {
    const player = makePlayer();
    const slot = new InventorySlot(tables, 'inventory').fromJSON({ key: 'dust1', count: 3, quality: 1 });
    player.sellItem(slot, 1);
    expect(player.gold).toBe(2); // price = 1 * 2^1 = 2
    expect(slot.count).toBe(2);

    player.sellItem(slot, 2);
    expect(slot.key).toBeNull();
    expect(player.gold).toBe(6);
  });

  it('build / award 容器：整格移出', () => {
    const player = makePlayer();
    const build = new InventorySlot(tables, 'build').fromJSON({ key: 'dust1', count: 5 });
    const award = new InventorySlot(tables, 'award').fromJSON({ key: 'dust1', count: 5 });
    player.buildInventory.push(build);
    player.awardInventory.push(award);

    player.sellItem(build, 1);
    expect(player.buildInventory).toHaveLength(0);
    player.sellItem(award, 1);
    expect(player.awardInventory).toHaveLength(0);
    expect(player.gold).toBe(2); // dust1 price=1，卖出 2 格
  });

  it('空槽位不产生收入', () => {
    const player = makePlayer();
    player.sellItem(new InventorySlot(tables, 'inventory'), 5);
    expect(player.gold).toBe(0);
  });
});

describe('Player 票券与材料', () => {
  it('countTicket 汇总地图票 + 背包 + 银行', () => {
    const account = createPlayerAccountState();
    const player = withBag(Player.fromJSON(tables, 'p1', now, { dungeonTickets: { dungeon1: 2 } }, account), 2);
    player.inventory[0]!.fromJSON({ key: 'ticket', count: 3, dungeonKey: 'dungeon1' });
    account.bank.push(new InventorySlot(tables, 'bank').fromJSON({ key: 'ticket', count: 4, dungeonKey: 'dungeon1' }));
    account.bank.push(new InventorySlot(tables, 'bank').fromJSON({ key: 'ticket', count: 9, dungeonKey: 'other' }));

    expect(player.countTicket('dungeon1')).toBe(9);
    expect(player.countTicket('other')).toBe(9);
    expect(player.countTicket('none')).toBe(0);
  });

  it('costTicket 优先扣地图票，其次背包，最后银行', () => {
    const account = createPlayerAccountState();
    const player = withBag(Player.fromJSON(tables, 'p1', now, { dungeonTickets: { dungeon1: 2 } }, account), 1);
    player.costTicket('dungeon1');
    expect(player.dungeonTickets.get('dungeon1')).toBe(1);
    expect(player.countTicket('dungeon1')).toBe(1);

    player.costTicket('dungeon1');
    expect(player.dungeonTickets.get('dungeon1')).toBe(0);

    player.inventory[0]!.fromJSON({ key: 'ticket', count: 2, dungeonKey: 'dungeon1' });
    player.costTicket('dungeon1');
    expect(player.inventory[0]!.count).toBe(1);

    player.inventory[0]!.clear();
    account.bank.push(new InventorySlot(tables, 'bank').fromJSON({ key: 'ticket', count: 1, dungeonKey: 'dungeon1' }));
    player.costTicket('dungeon1');
    expect(account.bank[0]!.key).toBeNull();
  });

  it('costTicket 无票时不抛错', () => {
    const player = makePlayer();
    expect(() => player.costTicket('dungeon1')).not.toThrow();
  });

  it('countGood / costGood：只统计背包，且从尾部扣', () => {
    const player = makePlayer();
    player.inventory.push(new InventorySlot(tables, 'inventory').fromJSON({ key: 'dust1', count: 3 }));
    player.inventory.push(new InventorySlot(tables, 'inventory').fromJSON({ key: 'dust1', count: 4 }));
    player.inventory.push(new InventorySlot(tables, 'inventory').fromJSON({ key: 'potion', count: 1 }));

    expect(player.countGood('dust1')).toBe(7);
    expect(player.countGood('potion')).toBe(1);
    expect(player.countGood('none')).toBe(0);

    expect(player.costGood('dust1', 2)).toBe(0);
    expect(player.inventory[1]!.count).toBe(2);
    expect(player.inventory[0]!.count).toBe(3);

    expect(player.costGood('dust1', 10)).toBe(5);
    expect(player.inventory[0]!.key).toBeNull();
    expect(player.inventory[1]!.key).toBeNull();
  });
});

describe('Player 技能经验', () => {
  it('getSkillLevel 按 expGroup 共享等级', () => {
    const player = makePlayer();
    player.selectCareer('warrior');
    expect(player.getSkillLevel('slash')).toBe(0);
    expect(player.getSkillLevel('bash')).toBe(0);
    player.skillExp.get('melee')!.level = 4;
    expect(player.getSkillLevel('slash')).toBe(0);
    expect(player.getSkillLevel('bash')).toBe(4);
    expect(player.getSkillLevel('no-such-skill')).toBe(0);
  });

  it('addSkillExp 乘 updateRate，且一次只升一级', () => {
    const account = createPlayerAccountState();
    const player = makePlayer(account);
    player.selectCareer('warrior');
    player.currentCareerLevel = 10;

    player.addSkillExp('bash', 10); // maxExp(0) = 50
    expect(player.skillExp.get('melee')).toEqual({ level: 0, exp: 10 });

    account.updateRate = 5;
    player.addSkillExp('bash', 100); // 10 + 500 = 510 >= 50 → 只升一级，余 460
    expect(player.skillExp.get('melee')).toEqual({ level: 1, exp: 460 });
  });

  it('技能等级超过 currentCareerLevel 时不再获得经验', () => {
    const player = makePlayer();
    player.selectCareer('warrior');
    player.skillExp.get('slash')!.level = 3;
    player.currentCareerLevel = 1;
    player.addSkillExp('slash', 1000);
    expect(player.skillExp.get('slash')).toEqual({ level: 3, exp: 0 });

    // 相等时仍然可以继续升级
    player.currentCareerLevel = 3;
    player.addSkillExp('slash', 100);
    expect(player.skillExp.get('slash')).toEqual({ level: 4, exp: 0 });
  });

  it('未知技能 / 未建组时不抛错', () => {
    const player = makePlayer();
    expect(() => player.addSkillExp('no-such-skill', 10)).not.toThrow();
    expect(() => player.addSkillExp('slash', 10)).not.toThrow();
    expect(player.skillExp.size).toBe(0);
  });
});

describe('Player 装备（P2：9 槽 + 副手判定表）', () => {
  it('单手武器：主手空 → 主手；主手单手且副手空 → 副手（双持）', () => {
    const player = makePlayer();
    player.postCreate();
    // postCreate 后主手是 stickSword（单手）。
    expect(player.equipments!.weapon.key).toBe('stickSword');

    const second = item('stickSword', 1, { level: 20, quality: 2 });
    expect(player.equip(second)).toBe(true);
    // 主手仍被第一把占据，第二把进副手（双持）。
    expect(player.equipments!.weapon.level).toBe(1);
    expect(player.equipments!.offHand.key).toBe('stickSword');
    expect(player.equipments!.offHand.level).toBe(20);

    // 副手也占满 → 换主手，旧主手回传入槽。
    const third = item('stickSword', 1, { level: 30 });
    expect(player.equip(third)).toBe(true);
    expect(player.equipments!.weapon.level).toBe(30);
    expect(player.equipments!.offHand.level).toBe(20);
    expect(third.level).toBe(1);
  });

  it('主手空：只允许副手专属（盾 / 箭袋），单手武器仍进主手', () => {
    const player = makePlayer();
    player.postCreate();
    player.unequip(player.equipments!.weapon);
    expect(player.equipments!.weapon.empty).toBe(true);

    expect(player.equip(item('woodenShield', 1))).toBe(true);
    expect(player.equipments!.offHand.key).toBe('woodenShield');

    player.unequip(player.equipments!.offHand);
    expect(player.equip(item('arrowQuiver', 1))).toBe(true);
    expect(player.equipments!.offHand.key).toBe('arrowQuiver');

    // 单手武器不会进副手（主手空时进主手）。
    player.unequip(player.equipments!.offHand);
    expect(player.equip(item('stickSword', 1))).toBe(true);
    expect(player.equipments!.weapon.key).toBe('stickSword');
    expect(player.equipments!.offHand.empty).toBe(true);
  });

  it('单手主手：可盾、禁箭袋', () => {
    const player = makePlayer();
    player.postCreate();
    expect(player.equip(item('arrowQuiver', 1))).toBe(false);
    expect(player.equipments!.offHand.empty).toBe(true);
    expect(player.equip(item('woodenShield', 1))).toBe(true);
    expect(player.equipments!.offHand.key).toBe('woodenShield');
  });

  it('双手近战：装上后副手被锁定 / 清空；再装箭袋被拒', () => {
    const player = makePlayer();
    player.postCreate();
    player.equip(item('woodenShield', 1));
    expect(player.equipments!.offHand.key).toBe('woodenShield');

    const twoHand = item('bigSword', 1);
    expect(player.equip(twoHand)).toBe(true);
    // 副手被清空并挪回背包；双手武器在主手。
    expect(player.equipments!.weapon.key).toBe('bigSword');
    expect(player.equipments!.offHand.empty).toBe(true);
    expect(player.inventory.some((slot) => slot.key === 'woodenShield')).toBe(true);

    expect(player.equip(item('arrowQuiver', 1))).toBe(false);
    expect(player.equip(item('woodenShield', 1))).toBe(false);
    expect(player.equipments!.offHand.empty).toBe(true);
  });

  it('弓：可装箭袋、禁盾', () => {
    const player = makePlayer();
    player.postCreate();
    expect(player.equip(item('shortBow', 1))).toBe(true);
    expect(player.equipments!.weapon.key).toBe('shortBow');

    expect(player.equip(item('woodenShield', 1))).toBe(false);
    expect(player.equip(item('arrowQuiver', 1))).toBe(true);
    expect(player.equipments!.offHand.key).toBe('arrowQuiver');
  });

  it('equip 忽略非装备与未知物品（返回 false）', () => {
    const player = makePlayer();
    player.postCreate();
    const before = player.equipments!.weapon.toJSON();
    expect(player.equip(item('dust1', 1))).toBe(false);
    expect(player.equip(item('no-such-good', 1))).toBe(false);
    expect(player.equipments!.weapon.toJSON()).toEqual(before);
  });

  it('unequip 换到第一个空格；无空格时不动', () => {
    const player = makePlayer();
    player.postCreate();
    player.unequip(player.equipments!.weapon);
    expect(player.equipments!.weapon.empty).toBe(true);
    expect(player.inventory[0]!.key).toBe('stickSword');

    // 背包塞满后无法卸下
    player.equip(player.inventory[0]!); // 换回来
    for (const slot of player.inventory) {
      if (slot.empty) {
        slot.fromJSON({ key: 'dust1', count: 1 });
      }
    }
    const equipped = player.equipments!.weapon.toJSON();
    player.unequip(player.equipments!.weapon);
    expect(player.equipments!.weapon.toJSON()).toEqual(equipped);
  });
});

describe('Player.sortInventory', () => {
  it('按 类型 → 品质 → 部位/等级 → goodOrder 排序，并清空后重新入包', () => {
    const player = withBag(makePlayer(), 6);
    player.inventory[0]!.fromJSON({ key: 'stickSword', count: 1, level: 10, quality: 0 });
    player.inventory[1]!.fromJSON({ key: 'dust1', count: 5 });
    player.inventory[2]!.fromJSON({ key: 'trash', count: 1 });
    player.inventory[3]!.fromJSON({ key: 'box', count: 1 });
    player.inventory[4]!.fromJSON({ key: 'ticket', count: 1, dungeonKey: 'dungeon1' });

    player.sortInventory();

    const order = player.inventory.map((slot) => (slot.goodData ? slot.goodData.type : slot.key));
    expect(order.slice(0, 5)).toEqual(['junk', 'package', 'material', 'ticket', 'equip']);
    expect(player.inventory[5]!.empty).toBe(true);
  });

  it('装备按部位顺序与等级排序', () => {
    const player = withBag(makePlayer(), 3);
    player.inventory[0]!.fromJSON({ key: 'stickSword', count: 1, level: 30 }); // weapon
    player.inventory[1]!.fromJSON({ key: 'dress', count: 1, level: 5 }); // plastron
    player.inventory[2]!.fromJSON({ key: 'charm', count: 1, level: 1 }); // ornament

    player.sortInventory();
    expect(player.inventory.map((slot) => slot.key).slice(0, 3)).toEqual(['stickSword', 'dress', 'charm']);
  });

  it('可整理任意容器；空容器不抛错', () => {
    const player = makePlayer();
    const bank = [
      new InventorySlot(tables, 'bank').fromJSON({ key: 'dust1', count: 1 }),
      new InventorySlot(tables, 'bank').fromJSON({ key: 'trash', count: 1 }),
    ];
    player.sortInventory(bank);
    expect(bank[0]!.key).toBe('trash');
    expect(bank[1]!.key).toBe('dust1');
    expect(bank[0]!.position).toBe('bank');
    expect(() => player.sortInventory([])).not.toThrow();
  });

  it('钥石按地图等级排序', () => {
    const player = withBag(makePlayer(), 3);
    player.inventory[0]!.fromJSON({ key: 'ticket', count: 1, dungeonKey: 'nightmare.3' }); // 320
    player.inventory[1]!.fromJSON({ key: 'ticket', count: 1, dungeonKey: 'dungeon1' }); // 10
    player.sortInventory();
    expect(player.inventory[0]!.dungeonKey).toBe('dungeon1');
    expect(player.inventory[1]!.dungeonKey).toBe('nightmare.3');
  });
});

describe('Player.getInventory（注入 lootGoods）', () => {
  it('用注入的领取函数替换容器内容', () => {
    const player = makePlayer();
    const target = [new InventorySlot(tables, 'build')];
    player.getInventory(target, () => [item('dust1', 3)]);
    expect(target).toHaveLength(1);
    expect(target[0]!.key).toBe('dust1');
    expect(target[0]!.count).toBe(3);
  });

  it('领取函数返回空数组时清空容器', () => {
    const player = makePlayer();
    const target = [new InventorySlot(tables, 'award').fromJSON({ key: 'dust1', count: 1 })];
    player.getInventory(target, () => []);
    expect(target).toEqual([]);
  });
});
