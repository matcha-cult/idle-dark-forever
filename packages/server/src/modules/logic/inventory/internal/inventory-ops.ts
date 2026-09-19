/**
 * 背包域纯逻辑（不依赖 Nest / IO，便于单测覆盖边界）。
 *
 * 全部改动都在传入的 `Player` 上就地完成；调用方负责 `markDirty` / `flush`。
 * 失败一律抛 `OpError`（服务层转成协议 `ActionFail`）。
 */
import {
  InventorySlot,
  transformEquipLevel,
  type DataTables,
  type Player,
  type PlayerAccountState,
  type Rng,
} from '@idle-dark/game-core';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { OpError } from '../../shared/op-error.js';
import { rollLoots } from './loots.js';

/** 装备需求校验（原版 `PlayerUnit.canEquip`）。 */
export function equipBlockReason(player: Player, slot: InventorySlot): string | null {
  const good = slot.goodData;
  if (!good || good.type !== 'equip') return BusinessErrorCode.ITEM_NOT_EQUIPPABLE;
  if (player.level < transformEquipLevel(slot.level)) return BusinessErrorCode.LEVEL_TOO_LOW;
  const available = player.careerData?.availableClasses ?? {};
  if (!available[good.class ?? '']) return BusinessErrorCode.CLASS_NOT_ALLOWED;
  return null;
}

/** 装备一件背包中的装备（与当前装备槽互换）。 */
export function opEquip(player: Player, position: string, slot: InventorySlot): void {
  if (position !== 'inventory') {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '只能装备背包中的物品');
  }
  if (slot.empty) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  const reason = equipBlockReason(player, slot);
  if (reason !== null) throw new OpError(reason);
  player.equip(slot);
}

/** 卸下装备到第一个背包空位（无空位 → INVENTORY_FULL）。 */
export function opUnequip(player: Player, position: string, slot: InventorySlot): void {
  if (position !== 'equip') {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '该物品不在装备栏');
  }
  if (slot.empty) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  if (player.emptySlot(player.inventory) < 0) {
    throw new OpError(BusinessErrorCode.INVENTORY_FULL, '包裹已满，无法卸下');
  }
  player.unequip(slot);
}

/** 出售（装备栏物品不可出售；锁定 / 无价物品拒绝）。 */
export function opSell(
  player: Player,
  position: string,
  slot: InventorySlot,
  count: number,
): void {
  if (slot.empty) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  if (position === 'equip') throw new OpError(BusinessErrorCode.INVALID_PARAM, '装备中的物品无法出售');
  if (slot.locked) throw new OpError(BusinessErrorCode.ITEM_LOCKED);
  if (slot.price <= 0) throw new OpError(BusinessErrorCode.INVALID_PARAM, '该物品无法出售');
  const owned = slot.count ?? 0;
  if (!Number.isInteger(count) || count <= 0 || count > owned) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '出售数量非法');
  }
  player.sellItem(slot, count);
}

/** 锁定 / 解锁（空槽拒绝）。 */
export function opLock(slot: InventorySlot, locked: boolean): void {
  if (slot.empty) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  slot.locked = locked;
}

/** 整理背包（原版顺序）。 */
export function opSort(player: Player): void {
  player.sortInventory(player.inventory);
}

/**
 * 用神力扩容背包。
 *
 * 原版 `upgrades.inventoryByDiamonds[player.inventoryDiamondLevel]` 逐级计价；
 * 超出表长即「已达上限」（本工程不实现金币 / 材料扩容路径，见交付报告）。
 */
export function opExpand(
  player: Player,
  account: PlayerAccountState,
  tables: DataTables,
  count: number,
): void {
  if (!Number.isInteger(count) || count <= 0) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '扩容数量非法');
  }
  const costTable = tables.upgrades.inventoryByDiamonds;
  let total = 0;
  let level = player.inventoryDiamondLevel;
  for (let i = 0; i < count; i++) {
    const cost = costTable[level];
    if (typeof cost !== 'number' || !Number.isFinite(cost)) {
      throw new OpError(BusinessErrorCode.INVALID_PARAM, '背包已达扩容上限');
    }
    total += cost;
    level += 1;
  }
  if (account.diamonds < total) {
    throw new OpError(BusinessErrorCode.NOT_ENOUGH_DIAMONDS, undefined, { required: total });
  }
  account.diamonds -= total;
  for (let i = 0; i < count; i++) {
    player.inventory.push(new InventorySlot(tables, 'inventory'));
  }
  player.inventoryDiamondLevel += count;
}

/**
 * 打开包裹类道具（原版 `world.usePackage`）。
 *
 * 需要 `goodData.requireInventory` 个背包空位；不足即拒绝（不扣道具）。
 */
export function opUsePackage(
  player: Player,
  tables: DataTables,
  slot: InventorySlot,
  rng: Rng,
): void {
  if (slot.empty) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  const good = slot.goodData;
  if (!good || good.type !== 'package') {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '该物品不是包裹');
  }
  const require = typeof good.requireInventory === 'number' ? good.requireInventory : 0;
  const emptyCount = player.inventory.reduce((sum, item) => (item.empty ? sum + 1 : sum), 0);
  if (emptyCount < require) {
    throw new OpError(BusinessErrorCode.INVENTORY_FULL, `至少需要 ${require} 个空位才能打开`);
  }

  slot.count = (slot.count ?? 0) - 1;
  if ((slot.count ?? 0) <= 0) slot.clear();

  let lootLevel = good.lootLevel;
  if (lootLevel === undefined) {
    if (player.level < 60) lootLevel = player.level * 2;
    else if (player.level < 70) lootLevel = player.level * 3;
    else lootLevel = 280;
  } else if (Array.isArray(lootLevel)) {
    const lo = typeof lootLevel[0] === 'number' ? lootLevel[0] : 0;
    const hi = typeof lootLevel[1] === 'number' ? lootLevel[1] : lo;
    const p = rng.next();
    lootLevel = p * lo + (1 - p) * hi;
  }
  const level = typeof lootLevel === 'number' && Number.isFinite(lootLevel) ? lootLevel : 1;

  const loots = good.loots ?? [];
  if (loots.length === 0) return;
  rollLoots(player, tables, loots, level, rng);
}
