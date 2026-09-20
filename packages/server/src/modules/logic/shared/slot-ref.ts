/**
 * 面板域通用的「物品实例 id → 背包格子」解析（服务端权威）。
 *
 * 线协议 `InventorySlotDto.id` 由 `shared/player-dto.ts` 的 `slotIdOf(position, index)`
 * 合成（`${position}:${index}`）。本文件把它扩展成一个**面板域自洽**的 id 方案：
 *
 * - 背包 / 建造 / 奖励：`inventory:0` / `build:0` / `award:0`（与 shared 一致）；
 * - 装备栏：`equip:<槽名>`（P2 的 9 个槽，见 `@idle-dark/protocol` 的 `EQUIP_POSITIONS`）。
 *
 * ⚠️ 为什么装备栏不用 `equip:0`：`shared/player-dto.ts` 的 `equipmentsDtoOf` 对每个装备槽
 * 都调用 `slotDtoOf(slot, 0)`，会产出**多个相同 id** `equip:0`，单件操作无法区分。
 * 本域一律使用 `${position}:${equipSlot}`，`inventory.list` / 写操作返回的 DTO 都用它。
 */
import type { InventorySlotDto, ItemPosition } from '@idle-dark/protocol';
import {
  EQUIP_SLOTS,
  InventorySlot,
  type DataTables,
  type EquipSlot,
  type Player,
} from '@idle-dark/game-core';
import { slotDtoOf } from './player-dto.js';

export interface ResolvedPanelSlot {
  position: ItemPosition;
  slot: InventorySlot;
  index: number;
  /** 装备栏专属：命中的部位；非装备容器为 null。 */
  equip: EquipSlot | null;
}

/** 装备栏实例 id。 */
export function equipSlotId(equip: EquipSlot): string {
  return `equip:${equip}`;
}

function isEquipSlot(value: string): value is EquipSlot {
  return (EQUIP_SLOTS as readonly string[]).includes(value);
}

/** 容器 position → 数组（仅背包 / 建造 / 奖励；装备栏与银行不走这里）。 */
export function panelContainerOf(player: Player, position: string): InventorySlot[] | null {
  switch (position) {
    case 'inventory':
      return player.inventory;
    case 'build':
      return player.buildInventory;
    case 'award':
      return player.awardInventory;
    default:
      return null;
  }
}

/**
 * `inventory.list` 的扁平载荷：装备栏(4) + 背包 + 建造 + 奖励。
 *
 * 前端 `InventoryStore` 按每项的 `position` 分组、按 `equipPosition` 定位装备槽，
 * 因此这里必须把全部容器放进去（**没有**容器分组 DTO，见任务书附录 A）。
 */
export function listPanelSlots(tables: DataTables, player: Player): InventorySlotDto[] {
  const out: InventorySlotDto[] = [];
  const career = player.careerInfo;
  for (const key of EQUIP_SLOTS) {
    const slot = career?.equipments[key] ?? new InventorySlot(tables, 'equip');
    const dto = slotDtoOf(slot, 0);
    dto.id = equipSlotId(key);
    dto.equipPosition = key;
    out.push(dto);
  }
  player.inventory.forEach((slot, index) => out.push(slotDtoOf(slot, index)));
  player.buildInventory.forEach((slot, index) => out.push(slotDtoOf(slot, index)));
  player.awardInventory.forEach((slot, index) => out.push(slotDtoOf(slot, index)));
  return out;
}

/** 解析面板 id；非法格式 / 越界 / 空槽位不存在 → null。 */
export function resolvePanelSlot(player: Player, id: string): ResolvedPanelSlot | null {
  const sep = id.indexOf(':');
  if (sep <= 0 || sep === id.length - 1) return null;
  const head = id.slice(0, sep);
  const rest = id.slice(sep + 1);

  if (head === 'equip') {
    if (!isEquipSlot(rest)) return null;
    const slot = player.careerInfo?.equipments[rest];
    if (!slot) return null;
    return { position: 'equip', slot, index: 0, equip: rest };
  }

  const container = panelContainerOf(player, head);
  if (!container) return null;
  if (!/^\d+$/.test(rest)) return null;
  const index = Number(rest);
  const slot = container[index];
  if (!slot) return null;
  return { position: head as ItemPosition, slot, index, equip: null };
}

/** 反向查 id（附魔 / 重铸改动了实例内容后仍能返回同一实例的 id）。 */
export function panelSlotIdOf(player: Player, slot: InventorySlot): string | null {
  const career = player.careerInfo;
  if (career) {
    for (const key of EQUIP_SLOTS) {
      if (career.equipments[key] === slot) return equipSlotId(key);
    }
  }
  const containers: Array<[ItemPosition, InventorySlot[]]> = [
    ['inventory', player.inventory],
    ['build', player.buildInventory],
    ['award', player.awardInventory],
  ];
  for (const [position, list] of containers) {
    const index = list.indexOf(slot);
    if (index >= 0) return `${position}:${index}`;
  }
  return null;
}

/** 解析结果 → DTO（id 与容器正确）。 */
export function dtoOfResolved(resolved: ResolvedPanelSlot): InventorySlotDto {
  const dto = slotDtoOf(resolved.slot, resolved.index);
  if (resolved.equip) {
    dto.id = equipSlotId(resolved.equip);
    dto.equipPosition = resolved.equip;
  }
  return dto;
}
