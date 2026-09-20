/**
 * 混沌仪（W6）—— 无尽 T 阶的纯规则：阶位换算、地图 key、解锁判据。
 *
 * 规格（13 号任务书 §1 R3 / §2.1 Q5 / §2.3）：
 * - **T1~T16**；地图等级 = `84 + T`（T1=85 … T16=100）；
 * - **解锁** = 通关**全部野外地图 BOSS**（`Player.worldBossKilled` 覆盖所有非混沌战斗图）；
 * - 混沌图**不出现在普通 `map.list`**，只能由混沌仪的钥石序列进入。
 *
 * 本文件是**纯函数**，不依赖任何数据表实例：地图 / 击杀集合由调用方注入。
 */

import type { MapData } from '../contracts/data.js';
import { KEYSTONE_TIER_OFFSET, MAX_KEYSTONE_TIER, keystoneTierOfKey } from './keystone.js';

/** 混沌仪最高阶（T16）。 */
export const CHAOS_MAX_TIER = MAX_KEYSTONE_TIER;

/** 混沌图 key 前缀。 */
export const CHAOS_MAP_PREFIX = 'chaos.';

/** 挑战失败选项（§2.3）：`normal` = 回普通地图挂机；`continue` = 继续挑战（重试当前钥石）。 */
export type ChaosFailMode = 'normal' | 'continue';

/** 钥石序列上限（= T 阶数；可重复放同阶钥石）。 */
export const CHAOS_MAX_SEQUENCE = CHAOS_MAX_TIER;

/** 「继续挑战」连续失败多少次后跳到下一把（§2.3 默认 N=3）。 */
export const CHAOS_MAX_RETRY = 3;

/** 失败选项的合法值集合。 */
export function isChaosFailMode(value: unknown): value is ChaosFailMode {
  return value === 'normal' || value === 'continue';
}

/** 序列合法性：数组、长度 ≤ 16、每项都是合法 `keystone.tNN`（允许重复）。 */
export function isChaosSequence(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > CHAOS_MAX_SEQUENCE) {
    return false;
  }
  return value.every((item) => typeof item === 'string' && keystoneTierOfKey(item) !== null);
}

/** `chaos.tNN` 的规范 key 形状。 */
const CHAOS_MAP_PATTERN = /^chaos\.t(\d{1,2})$/;

/** 阶 → 地图等级（`84 + T`）；非法阶返回 `null`。 */
export function chaosLevelOfTier(tier: number): number | null {
  if (!Number.isInteger(tier) || tier < 1 || tier > CHAOS_MAX_TIER) {
    return null;
  }
  return KEYSTONE_TIER_OFFSET + tier;
}

/** 阶 → 混沌图 key（`chaos.t01..t16`）；非法阶返回 `null`。 */
export function chaosMapKeyOfTier(tier: number): string | null {
  if (!Number.isInteger(tier) || tier < 1 || tier > CHAOS_MAX_TIER) {
    return null;
  }
  return `${CHAOS_MAP_PREFIX}t${String(tier).padStart(2, '0')}`;
}

/** 混沌图 key → 阶；非法 / 越界 key 返回 `null`。 */
export function chaosTierOfMapKey(key: string): number | null {
  if (typeof key !== 'string') {
    return null;
  }
  const match = CHAOS_MAP_PATTERN.exec(key);
  if (!match) {
    return null;
  }
  const tier = Number(match[1]);
  if (!Number.isInteger(tier) || tier < 1 || tier > CHAOS_MAX_TIER) {
    return null;
  }
  return tier;
}

/** 是否混沌图（只看 `chaos` 阶是否为合法 1~16 整数）。 */
export function isChaosMap(map: Pick<MapData, 'chaos'> | null | undefined): boolean {
  if (map === null || map === undefined) {
    return false;
  }
  const tier = map.chaos;
  return typeof tier === 'number' && Number.isInteger(tier) && tier >= 1 && tier <= CHAOS_MAX_TIER;
}

/**
 * 是否「野外守关 BOSS 图」——有 `boss` 且**不是**混沌图。
 *
 * 混沌图的 BOSS 可重复刷、不计入解锁链，因此**不**属于解锁判据要求集合。
 */
export function isWorldBossMap(
  map: (Pick<MapData, 'boss'> & Pick<MapData, 'chaos'>) | null | undefined,
): boolean {
  if (map === null || map === undefined) {
    return false;
  }
  return typeof map.boss === 'string' && map.boss.length > 0 && !isChaosMap(map);
}

/** 全部野外 BOSS 图 key（稳定顺序 = 表插入序）。 */
export function worldBossMapKeys<T extends Pick<MapData, 'boss'> & Pick<MapData, 'chaos'>>(
  maps: Readonly<Record<string, T>>,
): string[] {
  return Object.keys(maps).filter((key) => isWorldBossMap(maps[key]));
}

/**
 * 解锁判据：**全部**野外 BOSS 图都已被击杀。
 *
 * - 要求集合为空（无数据 / 未注册地图）→ `false`（fail-closed，绝不放行）；
 * - `killed` 里出现非字符串 / 空串 → 忽略（由 `Player` 侧防御性解析兜底）。
 */
export function hasAllWorldBossesKilled<T extends Pick<MapData, 'boss'> & Pick<MapData, 'chaos'>>(
  maps: Readonly<Record<string, T>>,
  killed: ReadonlySet<string> | readonly string[],
): boolean {
  const required = worldBossMapKeys(maps);
  if (required.length === 0) {
    return false;
  }
  const owned = killed instanceof Set ? killed : new Set(killed);
  return required.every((key) => owned.has(key));
}
