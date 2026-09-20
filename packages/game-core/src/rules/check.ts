/**
 * `checkRequirement` —— 原版 `src/logics/check.js` 的移植（117 行）。
 *
 * 去掉了单例依赖：原版读 `world.player` / `world.map` 两个全局，
 * 移植后统一由 `RequirementContext` 显式传入（`Player` 结构上天然满足 `player` 形状）。
 */

import type { Requirement } from '../contracts/data.js';
import { asNumberOrNull, asStringOrNull } from './player-meta.js';

/** 判定条件所需的最小世界状态（结构类型，避免与 `Player` 互相 import）。 */
export interface RequirementContext {
  player: {
    readonly role: string;
    readonly currentCareer: string | null;
    readonly level: number;
    readonly maxLevel: number;
  } | null;
  /** 当前所在地图 key（原版 `world.map`）。 */
  map: string | null;
}

/**
 * 需求条件的最大递归深度。
 *
 * 数据表里的 `requirement` 是 JSON，正常远小于该值；**自引用 / 循环构造**（程序化构造的
 * `$or: [自身]`）会让递归永不终止。超过深度一律判定为「条件不成立」（fail-closed），
 * 而不是抛栈溢出。
 */
export const MAX_REQUIREMENT_DEPTH = 64;

/**
 * 原版 `checkRequirement({...} = {})`：逐条 AND 判定，$or / $and 递归。
 *
 * 加固点（原版会抛 TypeError 的情形改为「该条件不成立 / 跳过」）：
 * - `$or` / `$and` 非数组 → 跳过（原版 `.some` 抛）；
 * - 递归深度 > {@link MAX_REQUIREMENT_DEPTH} → 判定不成立（循环 / 超深条件不再爆栈）。
 */
export function checkRequirement(
  requirement: Requirement | null | undefined,
  context: RequirementContext,
): boolean {
  return checkRequirementAtDepth(requirement, context, 0);
}

function checkRequirementAtDepth(
  requirement: Requirement | null | undefined,
  context: RequirementContext,
  depth: number,
): boolean {
  if (depth > MAX_REQUIREMENT_DEPTH) return false;
  const req = requirement ?? {};
  const player = context.player;

  const role = asStringOrNull(req.role);
  if (role && (!player || player.role !== role)) {
    return false;
  }
  const career = asStringOrNull(req.career);
  if (career && (!player || player.currentCareer !== career)) {
    return false;
  }
  const level = asNumberOrNull(req.level);
  if (level && (!player || player.level < level)) {
    return false;
  }
  const atMostMaxLevel = asNumberOrNull(req.atMostMaxLevel);
  if (atMostMaxLevel && (!player || player.maxLevel > atMostMaxLevel)) {
    return false;
  }
  const atLeastMaxLevel = asNumberOrNull(req.atLeastMaxLevel);
  if (atLeastMaxLevel && (!player || player.maxLevel < atLeastMaxLevel)) {
    return false;
  }
  const map = asStringOrNull(req.map);
  if (map && context.map !== map) {
    return false;
  }
  if (Array.isArray(req.$or)) {
    if (!req.$or.some((item) => checkRequirementAtDepth(item, context, depth + 1))) {
      return false;
    }
  }
  if (Array.isArray(req.$and)) {
    if (!req.$and.every((item) => checkRequirementAtDepth(item, context, depth + 1))) {
      return false;
    }
  }
  return true;
}
