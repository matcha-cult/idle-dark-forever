import { describe, expect, it } from 'vitest';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { InventorySlot } from '@idle-dark/game-core';
import { OpIdempotencyService } from '../../../src/modules/game/op-idempotency.service.js';
import { RateLimiterService } from '../../../src/common/services/rate-limiter.service.js';
import { BankLogicService } from '../../../src/modules/logic/bank/bank.logic.service.js';
import { OpError } from '../../../src/modules/logic/inventory/internal/op-error.js';
import { canAccept, listBankSlots, opBankExpand, resolveBankSlot } from '../../../src/modules/logic/bank/internal/bank-ops.js';
import { giveInventory, makeFakeBatcher, makeFakeCharacters, makeFakeContexts, makeFixture } from '../_helpers.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof OpError) return error.code;
    throw error;
  }
  throw new Error('expected throw');
}

function makeService(fixture: ReturnType<typeof makeFixture>) {
  const service = new BankLogicService(
    makeFakeContexts(fixture),
    makeFakeCharacters(),
    new OpIdempotencyService(),
    new RateLimiterService(),
    makeFakeBatcher(),
  );
  return service;
}

describe('bank 纯逻辑', () => {
  it('银行 id 解析与列表', () => {
    const fixture = makeFixture();
    fixture.account.bank.push(new InventorySlot(fixture.tables, 'bank').fromJSON({ key: 'dust1', count: 3 }));
    const slots = listBankSlots(fixture.account.bank);
    expect(slots[0]?.id).toBe('bank:0');
    expect(resolveBankSlot(fixture.account.bank, 'bank:0')?.index).toBe(0);
    expect(resolveBankSlot(fixture.account.bank, 'bank:9')).toBeNull();
    expect(resolveBankSlot(fixture.account.bank, 'inventory:0')).toBeNull();
  });

  it('容量判定：不可堆叠需要空格；可堆叠按剩余容量累加', () => {
    const fixture = makeFixture();
    const bank: InventorySlot[] = [];
    expect(canAccept(bank, fixture.tables, 'dust1', null, 1)).toBe(false);
    bank.push(new InventorySlot(fixture.tables, 'bank').fromJSON({ key: 'dust1', count: 9999 }));
    expect(canAccept(bank, fixture.tables, 'dust1', null, 1)).toBe(false);
    expect(canAccept(bank, fixture.tables, 'gold', null, 10 ** 9)).toBe(true);
  });

  it('扩容：神力不足 → NOT_ENOUGH_DIAMONDS', () => {
    const fixture = makeFixture();
    fixture.account.diamonds = 0;
    expect(codeOf(() => opBankExpand(fixture.account, fixture.tables, 1))).toBe(
      BusinessErrorCode.NOT_ENOUGH_DIAMONDS,
    );
  });

  it('扩容成功加格并扣费', () => {
    const fixture = makeFixture();
    const cost = fixture.tables.upgrades.bankByDiamonds[0]!;
    fixture.account.diamonds = cost;
    opBankExpand(fixture.account, fixture.tables, 1);
    expect(fixture.account.bank.length).toBe(1);
    expect(fixture.account.diamonds).toBe(0);
  });
});

describe('BankLogicService', () => {
  it('存入：空银行 → INVENTORY_FULL；非背包 id → INVALID_PARAM；未知 id → ITEM_NOT_FOUND', async () => {
    const fixture = makeFixture();
    giveInventory(fixture, { key: 'dust1', count: 3 }, 0);
    const service = makeService(fixture);

    const full = await service.deposit(1, 'inventory:0', 1);
    expect(full.success).toBe(false);
    if (full.success) return;
    expect(full.data.code).toBe(BusinessErrorCode.INVENTORY_FULL);

    const equip = await service.deposit(1, 'equip:weapon', 1);
    expect(equip.success).toBe(false);
    if (equip.success) return;
    expect(equip.data.code).toBe(BusinessErrorCode.INVALID_PARAM);

    const missing = await service.deposit(1, 'inventory:99', 1);
    expect(missing.success).toBe(false);
    if (missing.success) return;
    expect(missing.data.code).toBe(BusinessErrorCode.ITEM_NOT_FOUND);
  });

  it('存入 / 取出按数量转移', async () => {
    const fixture = makeFixture();
    const source = giveInventory(fixture, { key: 'dust1', count: 3 }, 0);
    fixture.account.bank.push(new InventorySlot(fixture.tables, 'bank'));
    const service = makeService(fixture);

    const deposited = await service.deposit(1, 'inventory:0', 2);
    expect(deposited.success).toBe(true);
    expect(source.count).toBe(1);
    expect(fixture.account.bank[0]?.count).toBe(2);

    const withdrawn = await service.withdraw(1, 'bank:0', 1);
    expect(withdrawn.success).toBe(true);
    expect(fixture.account.bank[0]?.count).toBe(1);
    expect(source.count).toBe(2);
  });

  it('取出未知 id → ITEM_NOT_FOUND', async () => {
    const fixture = makeFixture();
    const service = makeService(fixture);
    const result = await service.withdraw(1, 'bank:9', 1);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.data.code).toBe(BusinessErrorCode.ITEM_NOT_FOUND);
  });
});
