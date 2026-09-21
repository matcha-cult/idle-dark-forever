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
      // R4 / W11：锁定原因**区分缺失条件**（此前恒为一句「尚未满足进入条件」，
      // 玩家无法判断自己差的是等级还是 BOSS —— 那正是"怀疑判定有误"的来源）。
      lockedReason: unlocked ? null : lockedReasonOf(map.requirement, context, tables),
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

/**
 * 把「未满足的进入条件」翻译成**玩家可读的**锁定原因（R4 / W11）。
 *
 * 为什么需要：此前 `lockedReason` 恒为一句「尚未满足进入条件」，玩家无法判断自己差的是
 * **等级**还是**守关 BOSS** —— 用户报「挂机 25 波仍未解锁」时，根本不知道自己在等什么。
 *
 * 规则：
 * - 只**描述实际缺失**的条件（已满足的一律不提）；
 * - 多个条件同时缺失 → 用「；」串起来；
 * - BOSS 条件优先用人话 + 地图名（「需先击杀「迷雾林间」的守关 BOSS」）；
 * - `$and` 递归取子条件；`$or` 各分支都不满足时列出「需满足其一：…」；
 * - **一个字都分析不出来**（如 `debug` 之类的未支持字段）→ 回落通用文案，
 *   绝不返回空串（前端会把它当作"没有原因"）。
 *
 * ⚠️ 本函数只做**展示**，绝不参与放行判定 —— 判定唯一入口仍是 `checkRequirement`
 * （fail-closed）。两者不一致时以判定为准。
 */
export function lockedReasonOf(
  requirement: Requirement | null | undefined,
  context: RequirementContext,
  tables: DataTables,
): string {
  const reasons = missingReasonTexts(requirement, context, tables, 0);
  return reasons.length > 0 ? reasons.join('；') : '尚未满足进入条件';
}

/** 递归收集缺失条件（深度上限防循环条件爆炸）。 */
function missingReasonTexts(
  requirement: Requirement | null | undefined,
  context: RequirementContext,
  tables: DataTables,
  depth: number,
): string[] {
  if (depth > MAX_REASON_DEPTH) return ['尚未满足进入条件'];
  const req = requirement ?? {};
  const player = context.player;
  const out: string[] = [];

  const role = textOrNull(req.role);
  if (role && (!player || player.role !== role)) {
    out.push(`需要职业 ${role}`);
  }
  const career = textOrNull(req.career);
  if (career && (!player || player.currentCareer !== career)) {
    out.push(`需要转职 ${career}`);
  }
  const level = numberOrNull(req.level);
  if (level !== null && (!player || player.level < level)) {
    out.push(`需要等级 ${level}（当前 ${player ? player.level : '未知'}）`);
  }
  const atLeastMaxLevel = numberOrNull(req.atLeastMaxLevel);
  if (atLeastMaxLevel !== null && (!player || player.maxLevel < atLeastMaxLevel)) {
    out.push(`需要等级上限 ≥ ${atLeastMaxLevel}`);
  }
  const atMostMaxLevel = numberOrNull(req.atMostMaxLevel);
  if (atMostMaxLevel !== null && (!player || player.maxLevel > atMostMaxLevel)) {
    out.push(`需要等级上限 ≤ ${atMostMaxLevel}`);
  }
  const map = textOrNull(req.map);
  if (map && context.map !== map) {
    out.push(`需要在「${tables.maps[map]?.name ?? map}」`);
  }
  const bossKilled = textOrNull(req.bossKilled);
  if (bossKilled && !context.bossKilled?.has(bossKilled)) {
    const name = tables.maps[bossKilled]?.name;
    out.push(name ? `需先击杀「${name}」的守关 BOSS` : `需先击杀「${bossKilled}」的守关 BOSS`);
  }

  if (Array.isArray(req.$and)) {
    for (const child of req.$and) {
      out.push(...missingReasonTexts(child, context, tables, depth + 1));
    }
  }
  if (Array.isArray(req.$or)) {
    const branches = req.$or;
    const anyOk = branches.some((child) => {
      try {
        return checkRequirement(child, context);
      } catch {
        return false;
      }
    });
    if (!anyOk) {
      const texts = branches
        .map((child) => missingReasonTexts(child, context, tables, depth + 1).join('且'))
        .filter((t) => t !== '');
      if (texts.length > 0) out.push(`需满足其一：${texts.join('，或 ')}`);
    }
  }
  return [...new Set(out)];
}

/** `$or` / `$and` 递归深度上限（与 `check.ts` 的判定上限同量级，防循环条件）。 */
const MAX_REASON_DEPTH = 8;

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
