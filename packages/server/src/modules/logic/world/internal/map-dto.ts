/**
 * 地图列表投影（`WorldSnapshotDto.maps`）
 *
 * 解锁判定在服务端（`checkRequirement`），客户端只渲染 `lockedReason`。
 */
import type { MapDto, PlayerStateDto } from '@idle-dark/protocol';
import { checkRequirement, Player, type DataTables, type RequirementContext } from '@idle-dark/game-core';
import type { AccountExtras } from '../../shared/index.js';

/** 当前玩家所在地图（原版 `world.map`，不在 `Player` 存档里）。 */
export function requirementContextOf(
  player: Player,
  map: string,
  extras: AccountExtras,
): RequirementContext {
  const storiesMap = new Map<string, string>();
  for (const key of Object.keys(extras.storiesMap)) {
    const value = extras.storiesMap[key];
    if (value !== undefined) storiesMap.set(key, value);
  }
  return {
    player: {
      role: player.role,
      currentCareer: player.currentCareer,
      level: player.level,
      maxLevel: player.maxLevel,
    },
    map,
    storiesMap,
  };
}

export function mapListDtoOf(
  tables: DataTables,
  player: Player,
  extras: AccountExtras,
  currentMap: string,
): MapDto[] {
  const context = requirementContextOf(player, currentMap, extras);
  const out: MapDto[] = [];
  for (const key of Object.keys(tables.maps)) {
    const map = tables.maps[key];
    if (!map) continue;
    const unlocked = checkRequirement(map.requirement, context);
    const isDungeon = !!map.isDungeon;
    const ticketGroup = map.group;
    const dto: MapDto = {
      key,
      name: map.name,
      isDungeon,
      level: typeof map.level === 'number' && Number.isFinite(map.level) ? map.level : 0,
      lockedReason: unlocked ? null : '尚未满足进入条件',
      ticketCount: isDungeon && ticketGroup ? safeTicketCount(player, ticketGroup) : 0,
    };
    if (map.hint) dto.hint = map.hint;
    if (ticketGroup) dto.ticketGroup = ticketGroup;
    dto.unlocked = unlocked;
    out.push(dto);
  }
  // 可进入的排前面：数据表里有 47 张图，早期全部平铺时玩家很难在 45 张锁定的卡片里
  // 找到那唯一一张能进的（这是实际被反馈过的问题）。同组内保持数据表顺序（地图推进是有序的）。
  return out.sort((a, b) => Number(b.unlocked === true) - Number(a.unlocked === true));
}

function safeTicketCount(player: Player, group: string): number {
  try {
    const count = player.countTicket(group);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

/** `PlayerStateDto` 里 `map` / `endlessLevel` 由 world 运行时提供。 */
export interface WorldPosition {
  map: string;
  endlessLevel: number;
}

export function pendingOfflineMsOf(player: Player, now: number, capMs: number): number {
  const delta = now - player.timestamp;
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return Math.min(delta, capMs);
}

/** 类型占位（避免 `PlayerStateDto` 在本文件被 tree-shake 掉类型导入）。 */
export type PlayerStateRef = PlayerStateDto;
