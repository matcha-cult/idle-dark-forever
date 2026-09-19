/**
 * 神力商店纯逻辑（原版 `game.js` 的 `purchaseSlotPrice` / IAP 商品函数）。
 *
 * 数值来源：
 * - 角色栏位价格 `400 + 500n² + 100n³`（`n = playerSlotCount`，原版 `purchaseSlotPrice`）；
 * - `purchaseSlotMax`：原版**没有上限**，本工程取 `PLAYER_SLOT_MAX` 作为 UI 上限（见交付报告）；
 * - 神力搬运比例：原版内购函数（`gold(value)` / `medicine(value)`）没有存档化定价，
 *   本工程给出显式常量表（见交付报告「假设」）。
 */
import type { DataTables, Player, Rng } from '@idle-dark/game-core';
import type { ShopStateDto } from '@idle-dark/protocol';
import { BusinessErrorCode } from '@idle-dark/protocol';
import type { AccountExtras } from '../../shared/index.js';
import { OpError } from '../../shared/op-error.js';
import { grantMedicineExp, maxMedicineExp, totalMedicineLevel } from '../../produce/internal/medicine.js';

/** 角色栏位上限（原版无上限；本工程用于 UI 与越界拒绝）。 */
export const PLAYER_SLOT_MAX = 24;

/** 神力搬运比例。 */
export const DIAMONDS_PER_GOLD_UNIT = 1;
export const GOLD_PER_UNIT = 100;
export const DIAMONDS_PER_MEDICINE_LEVEL = 50;

export interface ExchangeOption {
  from: string;
  to: string;
  cost: number;
}

/** 可兑换项（`shop.state.exchangeOptions`）。 */
export function exchangeOptions(): ExchangeOption[] {
  return [
    { from: 'diamonds', to: 'gold', cost: DIAMONDS_PER_GOLD_UNIT },
    { from: 'diamonds', to: 'medicine', cost: DIAMONDS_PER_MEDICINE_LEVEL },
  ];
}

/** 下一个角色栏位价格。 */
export function playerSlotPrice(count: number): number {
  const n = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 1;
  return 400 + 500 * n ** 2 + 100 * n ** 3;
}

export function shopStateOf(playerSlotCount: number, player: Player): ShopStateDto {
  const count = Number.isFinite(playerSlotCount) && playerSlotCount > 0 ? Math.trunc(playerSlotCount) : 1;
  return {
    playerSlotCount: count,
    playerSlotMax: PLAYER_SLOT_MAX,
    nextSlotPrice: playerSlotPrice(count),
    diamonds: player.account.diamonds,
    exchangeOptions: exchangeOptions(),
  };
}

/** 购买角色栏位（返回新的栏位数）。 */
export function opBuyPlayerSlot(player: Player, playerSlotCount: number): number {
  const count = Number.isFinite(playerSlotCount) && playerSlotCount > 0 ? Math.trunc(playerSlotCount) : 1;
  if (count >= PLAYER_SLOT_MAX) {
    throw new OpError(BusinessErrorCode.PLAYER_SLOT_FULL, '角色栏位已达上限');
  }
  const cost = playerSlotPrice(count);
  if (player.account.diamonds < cost) {
    throw new OpError(BusinessErrorCode.NOT_ENOUGH_DIAMONDS, undefined, { required: cost });
  }
  player.account.diamonds -= cost;
  return count + 1;
}

/** 神力搬运：`diamonds → gold | medicine`。 */
export function opExchange(
  player: Player,
  extras: AccountExtras,
  tables: DataTables,
  from: string,
  to: string,
  count: number,
  rng: Rng,
): void {
  const option = exchangeOptions().find((item) => item.from === from && item.to === to);
  if (!option) throw new OpError(BusinessErrorCode.INVALID_PARAM, '不支持的兑换方向');
  if (!Number.isInteger(count) || count <= 0) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '兑换数量非法');
  }
  const total = option.cost * count;
  if (player.account.diamonds < total) {
    throw new OpError(BusinessErrorCode.NOT_ENOUGH_DIAMONDS, undefined, { required: total });
  }

  player.account.diamonds -= total;

  if (to === 'gold') {
    player.gold += GOLD_PER_UNIT * count;
    return;
  }

  if (to === 'medicine') {
    for (let i = 0; i < count; i++) {
      const current = totalMedicineLevel(tables, extras.medicineLevel);
      grantMedicineExp(tables, extras, maxMedicineExp(current), rng);
    }
    return;
  }

  throw new OpError(BusinessErrorCode.INVALID_PARAM, '不支持的兑换目标');
}
