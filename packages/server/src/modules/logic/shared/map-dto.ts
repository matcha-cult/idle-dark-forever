/**
 * 地图列表投影（`WorldSnapshotDto.maps`）
 *
 * 解锁判定在服务端（`checkRequirement`），客户端只渲染 `lockedReason`。
 */
import type { MapDto, PlayerStateDto } from '@idle-dark/protocol';
import {
  checkRequirement,
  isChaosMap,
  Player,
  type DataTables,
  type Requirement,
  type RequirementContext,
} from '@idle-dark/game-core';

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
    // W6：混沌图**不出现在普通地图列表**（开图 UI 只显示 T 阶，由混沌仪面板渲染）。
    if (isChaosMap(map)) continue;
    const unlocked = checkRequirement(map.requirement, context);
    const dto: MapDto = {
      key,
      name: map.name,
      level: typeof map.level === 'number' && Number.isFinite(map.level) ? map.level : 0,
      lockedReason: unlocked ? null : '尚未满足进入条件',
    };
    if (map.hint) dto.hint = map.hint;
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

/** `PlayerStateDto` 里 `map` 由 world 运行时提供。 */
export interface WorldPosition {
  map: string;
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
 * - `stored` 缺失 → `home`；
 * - 未知 mapKey → `home`（存档漂移时不让玩家卡死在不存在的地图）。
 */
export function resolveWorldPosition(
  tables: DataTables,
  stored: { map: string } | undefined,
): WorldPosition {
  if (!stored) return { map: 'home' };
  const map = tables.maps[stored.map] ? stored.map : 'home';
  return { map };
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
