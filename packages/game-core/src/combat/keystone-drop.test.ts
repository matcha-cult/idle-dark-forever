/**
 * W5 混沌钥石掉落集成单测（seed 世界 + 真实 `Player`）。
 *
 * 验证：
 * - 只在 85+ 区域掉落；75 图 / 无 level 图永不掉；
 * - 怪最多掉「自身阶 + 1」，且不超过 T16；
 * - 真实入包：同阶堆叠、异阶分格；
 * - 钱包隔离：钥石不进 `Player.wallet`；
 * - 白图守卫：`InventorySlot.affixes` 为空数组、物品无词缀字段。
 */
import { describe, expect, it } from 'vitest';

import type { DataTables } from '../contracts/data.js';
import { createDefaultTables } from '../data/index.js';
import { InventorySlot } from '../rules/inventory-slot.js';
import { Player } from '../rules/player.js';
import { keystoneKeyOfTier, keystoneTierOfKey, keystoneTierOfLevel, MAX_KEYSTONE_TIER } from '../rules/keystone.js';
import { EnemyUnit } from './enemy-unit.js';
import type { PlayerLike } from './player-unit.js';
import { enemyData, makeTestWorld, mapData } from './test-support.js';

/** 造一张 85+ 野外图 + 一只 85 级 dummy（无普通掉落表，隔离钥石判定）。 */
function makeKeystoneTables(mapLevel: number): DataTables {
  const tables = createDefaultTables();
  tables.maps = {
    home: mapData({ key: 'home', name: 'Home', monsters: [] }),
    'world.tier': mapData({ key: 'world.tier', name: 'Tier Map', level: mapLevel, monsters: [] }),
  };
  tables.enemies = {
    ...tables.enemies,
    dummy: enemyData({ key: 'dummy', name: 'Dummy', level: 85, exp: 0, loots: [] }),
  };
  return tables;
}

/** 把真实 `Player` 适配成 combat 的 `PlayerLike`（只接管掉落落地）。 */
function playerLikeOf(player: Player, tables: DataTables): PlayerLike {
  const like = Object.create(player) as PlayerLike;
  like.loot = (input: unknown): number => {
    const raw = (input ?? {}) as { key?: string | null; count?: number; quality?: number };
    const slot = new InventorySlot(tables, 'loot').fromJSON({
      key: raw.key ?? null,
      count: raw.count ?? 0,
      quality: raw.quality ?? 0,
    });
    return player.loot(slot);
  };
  return like;
}

function setup(mapLevel: number, seed: number, inventorySlots = 2) {
  const tables = makeKeystoneTables(mapLevel);
  const player = new Player(tables, 'p1', () => 0);
  for (let i = 0; i < inventorySlots; i += 1) {
    player.inventory.push(new InventorySlot(tables, 'inventory'));
  }
  const like = playerLikeOf(player, tables);
  const t = makeTestWorld({ map: 'world.tier', tables, seed, player: like });
  return { t, tables, player };
}

/** 走真实死亡清理路径击杀一只 dummy。 */
function killDummy(world: ReturnType<typeof makeTestWorld>['world']): void {
  const unit = new EnemyUnit(world, 'dummy', 0);
  world.addUnit(unit);
  unit.clean();
}

function keystoneSlots(player: Player): InventorySlot[] {
  return player.inventory.filter((slot) => (slot.key ?? '').startsWith('keystone.'));
}

describe('W5 掉落：85+ 区域才能产出混沌钥石', () => {
  it('85 级图 400 次击杀至少产出 1 枚钥石，且阶不超过怪阶 + 1', () => {
    const { t, player } = setup(85, 20240607);
    for (let i = 0; i < 400; i += 1) {
      killDummy(t.world);
    }
    const dropped = keystoneSlots(player);
    expect(dropped.length).toBeGreaterThan(0);
    const monsterTier = keystoneTierOfLevel(85)!;
    for (const slot of dropped) {
      const tier = keystoneTierOfKey(slot.key ?? '');
      expect(tier).not.toBeNull();
      expect(tier!).toBeLessThanOrEqual(monsterTier + 1);
      expect(tier!).toBeLessThanOrEqual(MAX_KEYSTONE_TIER);
    }
  });

  it('75 级图 400 次击杀永不产出钥石', () => {
    const { t, player } = setup(75, 20240607);
    for (let i = 0; i < 400; i += 1) {
      killDummy(t.world);
    }
    expect(keystoneSlots(player)).toHaveLength(0);
  });

  it('地图缺失 level：即使怪物 100 级也永不产出', () => {
    const tables = createDefaultTables();
    tables.maps = {
      home: mapData({ key: 'home', name: 'Home', monsters: [] }),
      // 故意不给 level。
      'world.tier': mapData({ key: 'world.tier', name: 'No Level Map', monsters: [] }),
    };
    tables.enemies = {
      ...tables.enemies,
      dummy: enemyData({ key: 'dummy', name: 'Dummy', level: 100, exp: 0, loots: [] }),
    };
    const player = new Player(tables, 'p1', () => 0);
    for (let i = 0; i < 3; i += 1) {
      player.inventory.push(new InventorySlot(tables, 'inventory'));
    }
    const t = makeTestWorld({ map: 'world.tier', tables, seed: 5, player: playerLikeOf(player, tables) });
    for (let i = 0; i < 200; i += 1) {
      killDummy(t.world);
    }
    expect(keystoneSlots(player)).toHaveLength(0);
  });

  it('怪阶 1..16：直接掷掉落的阶永远落在 1..min(16, 怪阶 + 1)', () => {
    for (let monsterTier = 1; monsterTier <= MAX_KEYSTONE_TIER; monsterTier += 1) {
      const monsterLevel = 84 + monsterTier;
      const { t, player } = setup(85, 1000 + monsterTier, 16);
      for (let i = 0; i < 300; i += 1) {
        t.world.rollKeystoneDrop(monsterLevel);
      }
      const dropped = keystoneSlots(player);
      for (const slot of dropped) {
        const tier = keystoneTierOfKey(slot.key ?? '')!;
        expect(tier, `monsterTier=${monsterTier}`).toBeGreaterThanOrEqual(1);
        expect(tier, `monsterTier=${monsterTier}`).toBeLessThanOrEqual(
          Math.min(MAX_KEYSTONE_TIER, monsterTier + 1),
        );
      }
    }
  });

  it('怪物等级低于 85（即便在 85+ 图中）不产出钥石', () => {
    const { t, player } = setup(100, 42);
    for (let i = 0; i < 500; i += 1) {
      t.world.rollKeystoneDrop(84);
    }
    expect(keystoneSlots(player)).toHaveLength(0);
  });
});

describe('W5 堆叠：同阶合并、异阶分格', () => {
  it('两枚 keystone.t01 合并成一格 count=2', () => {
    const { player, tables } = setup(85, 1, 0);
    player.inventory.push(new InventorySlot(tables, 'inventory'));
    player.loot(new InventorySlot(tables, 'loot').fromJSON({ key: 'keystone.t01', count: 1 }));
    player.loot(new InventorySlot(tables, 'loot').fromJSON({ key: 'keystone.t01', count: 1 }));
    const slots = player.inventory.filter((slot) => slot.key === 'keystone.t01');
    expect(slots).toHaveLength(1);
    expect(slots[0]!.count).toBe(2);
    expect(player.countGood('keystone.t01')).toBe(2);
  });

  it('keystone.t01 与 keystone.t02 各自独立成格', () => {
    const { player, tables } = setup(85, 1, 0);
    player.inventory.push(new InventorySlot(tables, 'inventory'));
    player.inventory.push(new InventorySlot(tables, 'inventory'));
    player.loot(new InventorySlot(tables, 'loot').fromJSON({ key: 'keystone.t01', count: 1 }));
    player.loot(new InventorySlot(tables, 'loot').fromJSON({ key: 'keystone.t02', count: 1 }));
    expect(player.countGood('keystone.t01')).toBe(1);
    expect(player.countGood('keystone.t02')).toBe(1);
    expect(player.inventory.filter((slot) => slot.key?.startsWith('keystone.'))).toHaveLength(2);
  });

  it('不同阶不会互相堆叠（T1 + T2 不合并）', () => {
    const { player, tables } = setup(85, 1, 0);
    player.inventory.push(new InventorySlot(tables, 'inventory'));
    player.inventory.push(new InventorySlot(tables, 'inventory'));
    player.loot(new InventorySlot(tables, 'loot').fromJSON({ key: 'keystone.t01', count: 1 }));
    player.loot(new InventorySlot(tables, 'loot').fromJSON({ key: 'keystone.t02', count: 1 }));
    const t1 = player.inventory.find((slot) => slot.key === 'keystone.t01');
    const t2 = player.inventory.find((slot) => slot.key === 'keystone.t02');
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t1).not.toBe(t2);
  });
});

describe('W5 钱包隔离 + 白图守卫', () => {
  it('isWalletGood(keystone.*) 为 false，且掉落不进 Player.wallet', () => {
    const { t, player } = setup(85, 20240607);
    expect(player.isWalletGood('keystone.t01')).toBe(false);
    expect(player.isWalletGood('keystone.t16')).toBe(false);
    for (let i = 0; i < 400; i += 1) {
      killDummy(t.world);
    }
    expect(player.wallet.size).toBe(0);
    // 通货/精华仍是钱包物品（对照，未被本次改动误伤）。
    expect(player.isWalletGood('currency.chaos')).toBe(true);
  });

  it('掉落产出的 InventorySlot.affixes 为空数组（无词缀白图）', () => {
    const { t, player } = setup(85, 20240607);
    for (let i = 0; i < 400; i += 1) {
      killDummy(t.world);
    }
    const dropped = keystoneSlots(player);
    expect(dropped.length).toBeGreaterThan(0);
    for (const slot of dropped) {
      expect(slot.affixes).toEqual([]);
      expect(slot.affixData).toBeUndefined();
    }
  });

  it('白图物品没有 affixGroup / position / equipCategory 等词缀承载字段', () => {
    const tables = createDefaultTables();
    for (let tier = 1; tier <= MAX_KEYSTONE_TIER; tier += 1) {
      const key = keystoneKeyOfTier(tier)!;
      const good = tables.goods[key]!;
      expect(good.affixGroup).toBeUndefined();
      expect(good.position).toBeUndefined();
      expect(good.equipCategory).toBeUndefined();
      expect(good.wallet).toBeUndefined();
      expect(good.type).toBe('material');
    }
  });
});
