/**
 * 钱包（R1）线协议投影单测：`slotDtoOf` 标记 + `PlayerStateDto.wallet`。
 *
 * 门禁 §5.3：钱包不计入背包容量 —— 背包满时通货仍能获得，且 `inventory` 不变。
 * 前端零推导：名称 / 类型 / 数量全部由服务端算好下发。
 */
import { describe, expect, it } from 'vitest';
import { InventorySlot } from '@idle-dark/game-core';

import { playerMetaDtoOf, playerStateDtoOf, slotDtoOf, walletDtoOf } from '../../../src/modules/logic/shared/player-dto.js';
import { makeFixture } from '../_helpers.js';

function stateOf(fixture: ReturnType<typeof makeFixture>) {
  return playerStateDtoOf(fixture.tables, fixture.player, {
    extras: fixture.extras,
    map: 'home',
    endlessLevel: 0,
    pendingOfflineMs: 0,
  });
}

function loot(fixture: ReturnType<typeof makeFixture>, key: string, count: number): number {
  return fixture.player.loot(new InventorySlot(fixture.tables, 'loot').fromJSON({ key, count }));
}

describe('钱包 DTO：玩家态投影', () => {
  it('空钱包下发空数组（不是 undefined）', () => {
    const fixture = makeFixture();
    const dto = stateOf(fixture);
    expect(dto.wallet).toEqual([]);
  });

  it('通货掉落进入 wallet、不占 inventory，且带服务端算好的名称/类型', () => {
    const fixture = makeFixture();
    const inventoryBefore = fixture.player.inventory.filter((slot) => slot.key).length;
    expect(loot(fixture, 'currency.chaos', 3)).toBe(3);
    const dto = stateOf(fixture);
    expect(dto.wallet).toEqual([{ key: 'currency.chaos', count: 3, name: '混沌石', type: 'material' }]);
    expect(fixture.player.inventory.filter((slot) => slot.key).length).toBe(inventoryBefore);
    // 背包里不能出现通货。
    expect(dto.inventory.some((slot) => slot.key === 'currency.chaos')).toBe(false);
  });

  it('背包全满时通货仍能获得（门禁 §5.3 回归）', () => {
    const fixture = makeFixture();
    // 用不可堆叠的装备塞满每一格。
    for (const slot of fixture.player.inventory) {
      slot.fromJSON({ key: 'stickSword', count: 1, quality: 0 });
    }
    expect(loot(fixture, 'essence.atk', 4)).toBe(4);
    expect(loot(fixture, 'currency.mirror', 1)).toBe(1);
    const dto = stateOf(fixture);
    const wallet = new Map((dto.wallet ?? []).map((entry) => [entry.key, entry.count]));
    expect(wallet.get('essence.atk')).toBe(4);
    expect(wallet.get('currency.mirror')).toBe(1);
  });

  it('排序稳定：goodOrder 优先，其次 key', () => {
    const fixture = makeFixture();
    loot(fixture, 'currency.mirror', 1);
    loot(fixture, 'currency.alchemy', 2);
    loot(fixture, 'essence.atk', 5);
    const keys = (stateOf(fixture).wallet ?? []).map((entry) => entry.key);
    // 三者都没有 goodOrder → 按 key 字典序。
    expect(keys).toEqual([...keys].sort());
  });
});

describe('钱包 DTO：单格标记', () => {
  it('钱包物品的槽 DTO 带 wallet:true；普通材料不带', () => {
    const fixture = makeFixture();
    const walletSlot = new InventorySlot(fixture.tables, 'loot').fromJSON({ key: 'currency.chaos', count: 1 });
    const normalSlot = new InventorySlot(fixture.tables, 'loot').fromJSON({ key: 'mucus', count: 1 });
    expect(slotDtoOf(walletSlot, 0).wallet).toBe(true);
    expect(slotDtoOf(normalSlot, 0).wallet).toBeUndefined();
  });
});

describe('钱包 DTO：脏数据过滤', () => {
  it('walletDtoOf 丢弃 NaN / Infinity / 0 / 负数，未知 key 回落到 key 本身', () => {
    const fixture = makeFixture();
    fixture.player.wallet.set('currency.chaos', 2);
    fixture.player.wallet.set('essence.atk', Number.NaN);
    fixture.player.wallet.set('currency.mirror', Number.POSITIVE_INFINITY);
    fixture.player.wallet.set('currency.scour', 0);
    fixture.player.wallet.set('currency.exalt', -3);
    fixture.player.wallet.set('unknown.good', 1);
    const out = walletDtoOf(fixture.tables, fixture.player);
    expect(out.map((entry) => entry.key).sort()).toEqual(['currency.chaos', 'unknown.good']);
    expect(out.find((entry) => entry.key === 'unknown.good')).toEqual({
      key: 'unknown.good',
      count: 1,
      name: 'unknown.good',
      type: 'material',
    });
  });
});

describe('W3：巅峰字段已从线协议投影中删除（Q8）', () => {
  it('PlayerStateDto / CareerProgressDto / PlayerMetaDto 都不含 peak 字段', () => {
    const fixture = makeFixture();
    const state = stateOf(fixture);
    expect(JSON.stringify(state).toLowerCase().includes('peak')).toBe(false);
    expect(state.level).toBe(1);
    for (const progress of state.careers) {
      expect(Object.keys(progress).filter((k) => k.toLowerCase().includes('peak')), progress.key).toEqual([]);
      expect(progress.maxLevel).toBe(100);
    }
    const meta = playerMetaDtoOf(fixture.tables, fixture.player, false);
    expect(Object.keys(meta).filter((k) => k.toLowerCase().includes('peak'))).toEqual([]);
  });
});
