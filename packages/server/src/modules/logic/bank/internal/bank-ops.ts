/**
 * 储藏箱域纯逻辑（原版 `player.loot(slot, game.bank)` / `Bank.js#purchaseBankByDiamond`）。
 *
 * 银行是**账号级**共享容器（`PlayerAccountState.bank`），因此落库走 `flushAccount`。
 */
import {
  InventorySlot,
  MAX_TICKET_STACK,
  type DataTables,
  type PlayerAccountState,
} from '@idle-dark/game-core';
import type { InventorySlotDto } from '@idle-dark/protocol';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { slotDtoOf } from '../../shared/index.js';
import { OpError } from '../../inventory/internal/op-error.js';

export interface ResolvedBankSlot {
  slot: InventorySlot;
  index: number;
}

/** 银行全量格子（id `bank:${index}`，由 `slotDtoOf` 生成）。 */
export function listBankSlots(bank: readonly InventorySlot[]): InventorySlotDto[] {
  return bank.map((slot, index) => slotDtoOf(slot, index));
}

/** 解析 `bank:${index}` id。 */
export function resolveBankSlot(bank: readonly InventorySlot[], id: string): ResolvedBankSlot | null {
  const match = /^bank:(\d+)$/.exec(id);
  if (!match) return null;
  const index = Number(match[1]);
  const slot = bank[index];
  if (!slot) return null;
  return { slot, index };
}

/** 目标容器能否再容纳 `take` 个 `key`。 */
export function canAccept(
  target: readonly InventorySlot[],
  tables: DataTables,
  key: string,
  dungeonKey: string | null,
  take: number,
): boolean {
  if (key === 'gold' || key === 'diamonds') return true;
  const limit = key === 'ticket' ? MAX_TICKET_STACK : tables.goods[key]?.stack;
  let capacity = 0;
  if (!limit || limit <= 0) {
    for (const slot of target) if (slot.empty) capacity += 1;
    return capacity >= take;
  }
  for (const slot of target) {
    if (slot.empty) {
      capacity += limit;
      continue;
    }
    if (slot.key !== key) continue;
    if (key === 'ticket' && slot.dungeonKey !== dungeonKey) continue;
    capacity += Math.max(0, limit - (slot.count ?? 0));
  }
  return capacity >= take;
}

function normalizeTake(slot: InventorySlot, count: number): number {
  if (slot.empty) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  const owned = slot.count ?? 0;
  if (!Number.isInteger(count) || count <= 0 || count > owned) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '转移数量非法');
  }
  return count;
}

/** 背包 → 银行。 */
export function opDeposit(
  player: { loot: (slot: InventorySlot, target?: InventorySlot[]) => void },
  account: PlayerAccountState,
  tables: DataTables,
  slot: InventorySlot,
  count: number,
): void {
  const take = normalizeTake(slot, count);
  const key = slot.key;
  if (key === null) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  if (!canAccept(account.bank, tables, key, slot.dungeonKey, take)) {
    throw new OpError(BusinessErrorCode.INVENTORY_FULL, '储藏箱已满');
  }
  moveInto(player, account.bank, tables, slot, take);
}

/** 银行 → 背包。 */
export function opWithdraw(
  player: { loot: (slot: InventorySlot, target?: InventorySlot[]) => void; inventory: InventorySlot[] },
  account: PlayerAccountState,
  tables: DataTables,
  slot: InventorySlot,
  count: number,
): void {
  const take = normalizeTake(slot, count);
  const key = slot.key;
  if (key === null) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  if (!canAccept(player.inventory, tables, key, slot.dungeonKey, take)) {
    throw new OpError(BusinessErrorCode.INVENTORY_FULL, '包裹已满');
  }
  moveInto(player, player.inventory, tables, slot, take);
}

function moveInto(
  player: { loot: (slot: InventorySlot, target?: InventorySlot[]) => void },
  target: InventorySlot[],
  tables: DataTables,
  source: InventorySlot,
  take: number,
): void {
  const owned = source.count ?? 0;
  const temp = new InventorySlot(tables, 'loot').fromJSON(source.toJSON());
  temp.count = take;
  player.loot(temp, target);
  const moved = take - (temp.count ?? 0);
  const rest = owned - moved;
  if (rest <= 0) source.clear();
  else source.count = rest;
}

/** 银行扩容（仅神力路径，原版 `bankByDiamonds`）。 */
export function opBankExpand(
  account: PlayerAccountState,
  tables: DataTables,
  count: number,
): void {
  if (!Number.isInteger(count) || count <= 0) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '扩容数量非法');
  }
  const costTable = tables.upgrades.bankByDiamonds;
  let total = 0;
  let level = account.bank.length;
  for (let i = 0; i < count; i++) {
    const cost = costTable[level];
    if (typeof cost !== 'number' || !Number.isFinite(cost)) {
      throw new OpError(BusinessErrorCode.INVALID_PARAM, '储藏箱已达扩容上限');
    }
    total += cost;
    level += 1;
  }
  if (account.diamonds < total) {
    throw new OpError(BusinessErrorCode.NOT_ENOUGH_DIAMONDS, undefined, { required: total });
  }
  account.diamonds -= total;
  for (let i = 0; i < count; i++) account.bank.push(new InventorySlot(tables, 'bank'));
}
