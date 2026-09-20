/**
 * 掉落如实上报（服务端侧）：满包 → `lost`，且不计入战利品 / 离线报告。
 */
import { describe, expect, it } from 'vitest';

import {
  InventorySlot,
  Player,
  createDefaultTables,
  createPlayerAccountState,
} from '@idle-dark/game-core';
import { BattleCollector } from '../src/modules/logic/shared/battle-collector.js';
import { toPlayerLike } from '../src/modules/logic/shared/player-like.js';

describe('掉落如实上报（服务端）', () => {
  it('toPlayerLike：满包 → recorder 收到 lost、返回 0', () => {
    const tables = createDefaultTables();
    const player = new Player(tables, 'p1', () => 0, createPlayerAccountState());
    player.postCreate();
    // 50 格全部占满（不可堆叠杂物）。
    for (const slot of player.inventory) {
      slot.fromJSON({ key: 'trash', count: 1 });
    }
    const records: Array<{ handled: string; count: number }> = [];
    const like = toPlayerLike(player, tables, {
      record: (slot: InventorySlot, handled: string) =>
        records.push({ handled, count: slot.count ?? 0 }),
    });
    const placed = like.loot!({ key: 'mucus', count: 2, quality: 0, handled: 'pickup' });
    expect(placed).toBe(0);
    expect(records).toEqual([{ handled: 'lost', count: 2 }]);
  });

  it('toPlayerLike：正常入包 → handled 原样、count = 实际入包数量', () => {
    const tables = createDefaultTables();
    const player = new Player(tables, 'p1', () => 0, createPlayerAccountState());
    player.postCreate();
    const records: Array<{ handled: string; count: number }> = [];
    const like = toPlayerLike(player, tables, {
      record: (slot: InventorySlot, handled: string) =>
        records.push({ handled, count: slot.count ?? 0 }),
    });
    // ⚠️ 用普通可堆叠材料 `mucus`；通货 `currency.*` 自 R1 起是钱包物品（永远入包成功）。
    const placed = like.loot!({ key: 'mucus', count: 3, quality: 0, handled: 'pickup' });
    expect(placed).toBe(3);
    expect(records).toEqual([{ handled: 'pickup', count: 3 }]);
  });

  it('BattleCollector：lost 不计入战利品 / 金币 / 材料', () => {
    const collector = new BattleCollector();
    collector.loot({ key: 'currency.mirror', count: 1, quality: 0, handled: 'lost' });
    collector.loot({ key: 'currency.chaos', count: 2, quality: 0, handled: 'pickup' });
    collector.loot({ key: 'gold', count: 99, quality: 0, handled: 'lost' });
    const snapshot = collector.snapshot();
    expect(snapshot.loots.map((loot) => `${loot.handled}:${loot.key}`)).toEqual([
      'pickup:currency.chaos',
    ]);
    expect(snapshot.gainedGold).toBe(0);
    expect(snapshot.materials).toEqual([]);
  });
});
