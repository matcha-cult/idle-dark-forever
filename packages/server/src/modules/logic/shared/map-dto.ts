/**
 * 地图列表投影（`WorldSnapshotDto.maps`）
 *
 * 解锁判定在服务端（`checkRequirement`），客户端只渲染 `lockedReason`。
 */
import type { MapDto, PlayerStateDto } from '@idle-dark/protocol';
import { checkRequirement, Player, type DataTables, type Requirement, type RequirementContext } from '@idle-dark/game-core';

/** 当前玩家所在地图（原版 `world.map`，不在 `Player` 存档里）。 */
export function requirementContextOf(player: Player, map: string): RequirementContext {
  return {
    player: {
      role: player.role,
      currentCareer: player.currentCareer,
      level: player.level,
      maxLevel: player.maxLevel,
    },
    map,
    bossKilled: player.worldBossKilled,
  };
}

export function mapListDtoOf(
  tables: DataTables,
  player: Player,
  currentMap: string,
): MapDto[] {
  const context = requirementContextOf(player, currentMap);
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
  // 按等级段排序：`level` 升序，同级再按 `key` 升序（W3）。
  // 旧的「已解锁排前面」在等级段模型下会把高段图打乱顺序（0/5/15/… 的推进链必须是列表顺序）。
  // `unlocked` / `lockedReason` 语义不变，客户端仍按这两个字段渲染。
  return out.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    if (a.key === b.key) return 0;
    return a.key < b.key ? -1 : 1;
  });
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

/**
 * 把持久化位置解析成可用位置（09 §2.2 map 控制器 / battle 会话宿主共用）。
 *
 * - `stored` 缺失 → `home` / 0；
 * - 未知 mapKey → `home`（存档漂移时不让玩家卡死在不存在的地图）；
 * - `endlessLevel` 非有限值 → 0（RC1：无尽暂缓，但字段必须不产生 NaN）。
 */
export function resolveWorldPosition(
  tables: DataTables,
  stored: { map: string; endlessLevel: number } | undefined,
): WorldPosition {
  if (!stored) return { map: 'home', endlessLevel: 0 };
  const map = tables.maps[stored.map] ? stored.map : 'home';
  const endlessLevel =
    typeof stored.endlessLevel === 'number' && Number.isFinite(stored.endlessLevel)
      ? Math.trunc(stored.endlessLevel)
      : 0;
  return { map, endlessLevel };
}

/**
 * 地图解锁判定（**唯一入口**，09 §6.1 同源纪律）。
 *
 * `requirement` 为空 → 解锁；判定抛错 → **不解锁**（fail-closed），
 * 绝不让异常把玩家放进不该进的地图。
 */
export function evaluateMapUnlock(
  requirement: Requirement | null | undefined,
  player: Player,
  currentMap: string,
): boolean {
  try {
    return checkRequirement(requirement, requirementContextOf(player, currentMap));
  } catch {
    return false;
  }
}

/**
 * 挑战队列耗尽后的「非秘境战斗图」选择（RD4，09 §10.2）。
 *
 * 优先级：`candidate`（= `run.outside`）→ 角色持久化开放世界位置 → `home`。
 * **只接受非秘境图**；候选非法 / 是秘境 / 不存在 → 落到下一档，最终兜底 `home`。
 */
export function pickOpenWorldMap(
  tables: DataTables,
  candidate: string | null | undefined,
  persisted: string | null | undefined,
): string {
  const usable = (key: string | null | undefined): string | null => {
    if (typeof key !== 'string' || key === '') return null;
    const map = tables.maps[key];
    if (!map || map.isDungeon === true) return null;
    return key;
  };
  return usable(candidate) ?? usable(persisted) ?? 'home';
}
