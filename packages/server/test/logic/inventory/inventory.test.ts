import { describe, expect, it } from 'vitest';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { InventorySlot, SeededRngFactory } from '@idle-dark/game-core';
import { OpIdempotencyService } from '../../../src/modules/game/op-idempotency.service.js';
import { RateLimiterService } from '../../../src/common/services/rate-limiter.service.js';
import { InventoryLogicService } from '../../../src/modules/logic/inventory/inventory.logic.service.js';
import { OpError } from '../../../src/modules/logic/shared/op-error.js';
import { listPanelSlots, resolvePanelSlot } from '../../../src/modules/logic/shared/slot-ref.js';
import {
  opEquip,
  opExpand,
  opSell,
  opUnequip,
  opUsePackage,
} from '../../../src/modules/logic/inventory/internal/inventory-ops.js';
import {
  FIXED_NOW,
  giveInventory,
  giveWeapon,
  makeFakeBatcher,
  makeFakeCharacters,
  makeFakeContexts,
  makeFixture,
} from '../_helpers.js';

function codeOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof OpError) return error.code;
    throw error;
  }
  throw new Error('expected throw');
}

function makeService(fixture: ReturnType<typeof makeFixture>) {
  const opIds = new OpIdempotencyService();
  const rateLimiter = new RateLimiterService();
  const service = new InventoryLogicService(
    makeFakeContexts(fixture),
    makeFakeCharacters(),
    opIds,
    rateLimiter,
    makeFakeBatcher(),
    () => FIXED_NOW,
  );
  return { service, opIds, rateLimiter };
}

describe('inventory 内部逻辑', () => {
  it('list 返回扁平数组，装备栏 id 唯一且可解析', () => {
    const fixture = makeFixture();
    const slots = listPanelSlots(fixture.tables, fixture.player);
    const equip = slots.filter((slot) => slot.position === 'equip');
    expect(equip).toHaveLength(4);
    expect(new Set(equip.map((slot) => slot.id)).size).toBe(4);
    expect(equip.find((slot) => slot.equipPosition === 'weapon')?.key).toBe('stickSword');
    expect(slots.some((slot) => slot.position === 'inventory')).toBe(true);
  });

  it('装备需求等级不足 → LEVEL_TOO_LOW', () => {
    const fixture = makeFixture();
    giveWeapon(fixture, { level: 200 }, 0);
    expect(codeOf(() => opEquip(fixture.player, 'inventory', fixture.player.inventory[0]!))).toBe(
      BusinessErrorCode.LEVEL_TOO_LOW,
    );
  });

  it('职业不允许的装备 → CLASS_NOT_ALLOWED', () => {
    const fixture = makeFixture('Eyer', 'warrior');
    giveInventory(fixture, { key: 'boneWand', level: 1, count: 1, quality: 0 }, 0);
    expect(codeOf(() => opEquip(fixture.player, 'inventory', fixture.player.inventory[0]!))).toBe(
      BusinessErrorCode.CLASS_NOT_ALLOWED,
    );
  });

  it('非装备 → ITEM_NOT_EQUIPPABLE', () => {
    const fixture = makeFixture();
    giveInventory(fixture, { key: 'dust1', count: 3 }, 0);
    expect(codeOf(() => opEquip(fixture.player, 'inventory', fixture.player.inventory[0]!))).toBe(
      BusinessErrorCode.ITEM_NOT_EQUIPPABLE,
    );
  });

  it('卸下时背包已满 → INVENTORY_FULL', () => {
    const fixture = makeFixture();
    for (let i = 0; i < fixture.player.inventory.length; i++) {
      giveInventory(fixture, { key: 'dust1', count: 1 }, i);
    }
    const weapon = fixture.player.careerInfo!.equipments.weapon;
    expect(codeOf(() => opUnequip(fixture.player, 'equip', weapon))).toBe(
      BusinessErrorCode.INVENTORY_FULL,
    );
  });

  it('出售：锁定 / 数量越界 / 装备中 分别报错', () => {
    const fixture = makeFixture();
    giveWeapon(fixture, { level: 10, locked: true }, 0);
    expect(codeOf(() => opSell(fixture.player, 'inventory', fixture.player.inventory[0]!, 1))).toBe(
      BusinessErrorCode.ITEM_LOCKED,
    );

    giveWeapon(fixture, { level: 10, locked: false, count: 2 }, 1);
    expect(codeOf(() => opSell(fixture.player, 'inventory', fixture.player.inventory[1]!, 5))).toBe(
      BusinessErrorCode.INVALID_PARAM,
    );

    const weapon = fixture.player.careerInfo!.equipments.weapon;
    expect(codeOf(() => opSell(fixture.player, 'equip', weapon, 1))).toBe(
      BusinessErrorCode.INVALID_PARAM,
    );
  });

  it('出售成功增加金币并按数量扣减', () => {
    const fixture = makeFixture();
    const slot = giveInventory(fixture, { key: 'dust1', count: 3 }, 0);
    const gold = fixture.player.gold;
    opSell(fixture.player, 'inventory', slot, 2);
    expect(fixture.player.gold).toBe(gold + slot.price * 2);
    expect(slot.count).toBe(1);
  });

  it('开包：非包裹 → INVALID_PARAM', () => {
    const fixture = makeFixture();
    const slot = giveInventory(fixture, { key: 'dust1', count: 1 }, 0);
    const rng = new SeededRngFactory().create(1);
    expect(codeOf(() => opUsePackage(fixture.player, fixture.tables, slot, rng))).toBe(
      BusinessErrorCode.INVALID_PARAM,
    );
  });

  it('扩容：神力不足 → NOT_ENOUGH_DIAMONDS；足够则加格并扣费', () => {
    const fixture = makeFixture();
    fixture.account.diamonds = 0;
    expect(codeOf(() => opExpand(fixture.player, fixture.account, fixture.tables, 1))).toBe(
      BusinessErrorCode.NOT_ENOUGH_DIAMONDS,
    );

    const before = fixture.player.inventory.length;
    const cost = fixture.tables.upgrades.inventoryByDiamonds[fixture.player.inventoryDiamondLevel]!;
    fixture.account.diamonds = cost;
    opExpand(fixture.player, fixture.account, fixture.tables, 1);
    expect(fixture.player.inventory.length).toBe(before + 1);
    expect(fixture.account.diamonds).toBe(0);
  });

  it('id 解析：非法 / 越界 → null', () => {
    const fixture = makeFixture();
    expect(resolvePanelSlot(fixture.player, 'inventory:999')).toBeNull();
    expect(resolvePanelSlot(fixture.player, 'nope:0')).toBeNull();
    expect(resolvePanelSlot(fixture.player, 'equip:nope')).toBeNull();
    expect(resolvePanelSlot(fixture.player, 'equip:weapon')?.position).toBe('equip');
  });
});

describe('InventoryLogicService（限流 / 幂等 / 落库）', () => {
  it('opId 重复提交 → DUPLICATE_OPERATION，且不重复扣费', async () => {
    const fixture = makeFixture();
    fixture.account.diamonds = 100_000;
    const { service } = makeService(fixture);

    const first = await service.expand(1, 1, 'op-1');
    expect(first.success).toBe(true);
    const afterFirst = fixture.player.inventory.length;

    const second = await service.expand(1, 1, 'op-1');
    expect(second.success).toBe(false);
    if (second.success) throw new Error('unreachable');
    expect(second.data.code).toBe(BusinessErrorCode.DUPLICATE_OPERATION);
    expect(fixture.player.inventory.length).toBe(afterFirst);
  });

  it('装备成功返回最新扁平数组', async () => {
    const fixture = makeFixture();
    giveWeapon(fixture, {}, 0);
    const { service } = makeService(fixture);
    const result = await service.equip(1, 'inventory:0');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.find((slot) => slot.id === 'equip:weapon')?.key).toBe('stickSword');
  });

  it('未知 id → ITEM_NOT_FOUND', async () => {
    const fixture = makeFixture();
    const { service } = makeService(fixture);
    const result = await service.equip(1, 'inventory:999');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.data.code).toBe(BusinessErrorCode.ITEM_NOT_FOUND);
  });

  it('高频扩容触发限流 → RATE_LIMITED', async () => {
    const fixture = makeFixture();
    fixture.account.diamonds = Number.MAX_SAFE_INTEGER;
    const { service } = makeService(fixture);
    let last = await service.expand(1, 1);
    for (let i = 0; i < 30; i++) {
      last = await service.expand(1, 1);
      if (!last.success && last.data.code === BusinessErrorCode.RATE_LIMITED) break;
    }
    expect(last.success).toBe(false);
    if (last.success) return;
    expect(last.data.code).toBe(BusinessErrorCode.RATE_LIMITED);
  });

  it('空背包装备槽不可被卸下（空槽 → ITEM_NOT_FOUND）', () => {
    const fixture = makeFixture();
    const empty = new InventorySlot(fixture.tables, 'equip');
    expect(codeOf(() => opUnequip(fixture.player, 'equip', empty))).toBe(
      BusinessErrorCode.ITEM_NOT_FOUND,
    );
  });
});
