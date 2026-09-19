import { describe, expect, it } from 'vitest';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { SeededRngFactory } from '@idle-dark/game-core';
import { OpError } from '../../../src/modules/logic/shared/op-error.js';
import {
  PLAYER_SLOT_MAX,
  opBuyPlayerSlot,
  opExchange,
  playerSlotPrice,
  shopStateOf,
} from '../../../src/modules/logic/shop/internal/shop-ops.js';
import { totalMedicineLevel } from '../../../src/modules/logic/produce/internal/medicine.js';
import { makeFixture } from '../_helpers.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof OpError) return error.code;
    throw error;
  }
  throw new Error('expected throw');
}

const rng = () => new SeededRngFactory().create(9);

describe('shop 状态与购买', () => {
  it('栏位价格 = 400 + 500n² + 100n³', () => {
    expect(playerSlotPrice(1)).toBe(1000);
    expect(playerSlotPrice(2)).toBe(400 + 2000 + 800);
  });

  it('state 返回服务端算好的价格与兑换项', () => {
    const fixture = makeFixture();
    const state = shopStateOf(3, fixture.player);
    expect(state.playerSlotCount).toBe(3);
    expect(state.playerSlotMax).toBe(PLAYER_SLOT_MAX);
    expect(state.nextSlotPrice).toBe(playerSlotPrice(3));
    expect(state.exchangeOptions.length).toBeGreaterThan(0);
  });

  it('神力不足 / 已满 → NOT_ENOUGH_DIAMONDS / PLAYER_SLOT_FULL', () => {
    const fixture = makeFixture();
    expect(codeOf(() => opBuyPlayerSlot(fixture.player, 1))).toBe(
      BusinessErrorCode.NOT_ENOUGH_DIAMONDS,
    );

    fixture.account.diamonds = 10_000_000;
    expect(codeOf(() => opBuyPlayerSlot(fixture.player, PLAYER_SLOT_MAX))).toBe(
      BusinessErrorCode.PLAYER_SLOT_FULL,
    );
  });

  it('购买成功扣神力并返回新栏位数', () => {
    const fixture = makeFixture();
    fixture.account.diamonds = 5000;
    const next = opBuyPlayerSlot(fixture.player, 1);
    expect(next).toBe(2);
    expect(fixture.account.diamonds).toBe(5000 - playerSlotPrice(1));
  });
});

describe('shop 神力搬运', () => {
  it('不支持的兑换方向 / 数量非法 → INVALID_PARAM', () => {
    const fixture = makeFixture();
    fixture.account.diamonds = 1000;
    expect(
      codeOf(() => opExchange(fixture.player, fixture.extras, fixture.tables, 'gold', 'diamonds', 1, rng())),
    ).toBe(BusinessErrorCode.INVALID_PARAM);
    expect(
      codeOf(() => opExchange(fixture.player, fixture.extras, fixture.tables, 'diamonds', 'gold', 0, rng())),
    ).toBe(BusinessErrorCode.INVALID_PARAM);
  });

  it('神力不足 → NOT_ENOUGH_DIAMONDS', () => {
    const fixture = makeFixture();
    fixture.account.diamonds = 0;
    expect(
      codeOf(() => opExchange(fixture.player, fixture.extras, fixture.tables, 'diamonds', 'gold', 1, rng())),
    ).toBe(BusinessErrorCode.NOT_ENOUGH_DIAMONDS);
  });

  it('diamonds → gold 成功', () => {
    const fixture = makeFixture();
    fixture.account.diamonds = 10;
    const gold = fixture.player.gold;
    opExchange(fixture.player, fixture.extras, fixture.tables, 'diamonds', 'gold', 2, rng());
    expect(fixture.account.diamonds).toBe(8);
    expect(fixture.player.gold).toBeGreaterThan(gold);
  });

  it('diamonds → medicine 提升药剂总等级', () => {
    const fixture = makeFixture();
    fixture.account.diamonds = 1000;
    opExchange(fixture.player, fixture.extras, fixture.tables, 'diamonds', 'medicine', 1, rng());
    expect(totalMedicineLevel(fixture.tables, fixture.extras.medicineLevel)).toBe(1);
  });
});
