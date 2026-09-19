/**
 * `checkRequirement` / `checkStory` —— 原版 `src/logics/check.js` 的移植（117 行）。
 *
 * 去掉了单例依赖：原版读 `world.player` / `world.map` / `game.storiesMap` 三个全局，
 * 移植后统一由 `RequirementContext` 显式传入（`Player` 结构上天然满足 `player` 形状）。
 *
 * 未移植：`onStoryDone`（原版在里面直接 `game.save()` / `player.save()`，属于 IO，
 * 且依赖 `InventorySlot` 的构造与奖励发放；奖励发放应由服务端故事门面负责）。
 */

import type { Requirement } from '../contracts/data.js';
import { asNumberOrNull, asStringArray, asStringOrNull } from './player-meta.js';

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
  /** 剧情三态：不存在 / `'task'` / `'done'`（原版 `game.storiesMap`）。 */
  storiesMap: ReadonlyMap<string, string>;
}

/**
 * 原版 `checkRequirement({...} = {})`：逐条 AND 判定，$or / $and 递归。
 *
 * 加固点（原版会抛 TypeError 的情形改为「该条件不成立 / 跳过」）：
 * - `stories` / `beforeStories` 非数组 → 跳过（原版 `for...of` 抛）；
 * - `$or` / `$and` 非数组 → 跳过（原版 `.some` 抛）。
 */
export function checkRequirement(
  requirement: Requirement | null | undefined,
  context: RequirementContext,
): boolean {
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
  if (Array.isArray(req.stories)) {
    for (const story of asStringArray(req.stories)) {
      if (context.storiesMap.get(story) !== 'done') {
        return false;
      }
    }
  }
  if (Array.isArray(req.beforeStories)) {
    for (const story of asStringArray(req.beforeStories)) {
      if (context.storiesMap.get(story) === 'done') {
        return false;
      }
    }
  }
  if (Array.isArray(req.$or)) {
    if (!req.$or.some((item) => checkRequirement(item, context))) {
      return false;
    }
  }
  if (Array.isArray(req.$and)) {
    if (!req.$and.every((item) => checkRequirement(item, context))) {
      return false;
    }
  }
  return true;
}

/** 原版 `checkStory`（未导出）：已完结的剧情不再可开启。 */
export function checkStory(
  story: { key: string; requirement?: Requirement },
  context: RequirementContext,
): boolean {
  if (context.storiesMap.get(story.key) === 'done') {
    return false;
  }
  return checkRequirement(story.requirement, context);
}
