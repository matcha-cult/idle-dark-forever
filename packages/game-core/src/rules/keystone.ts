/**
 * 混沌钥石（W5）—— 阶位换算与掉落掷骰规则。
 *
 * 本期形态 = PoE 式「白图」：只做**物品 + 掉落 + 逐阶消耗**的数据支撑，
 * **不生成词缀、不接 `AffixInfo`、不提供任何加工入口**（13 号任务书 §1 R3 / §4 W5 / §7 A 组）。
 * 词缀化 + 加工随 A1 延后（§7 H4）。
 *
 * 阶位模型（Q5 读法 A）：地图 / 怪物等级 = `84 + T`（T1 = 85 … T16 = 100）。
 * 因此 `tier = clamp(level - 84, 1, 16)`；`level < 85` 无阶（不掉落）。
 *
 * 随机一律走注入的 {@link Rng} 端口（契约 [0, 1)），本文件**零** `Math.random()`。
 */

import type { Rng } from '../contracts/ports.js';

/** 阶位偏移：`level - KEYSTONE_TIER_OFFSET` = 阶。 */
export const KEYSTONE_TIER_OFFSET = 84;

/** 混沌钥石的最低掉落等级（只在 85+ 区域掉落）。 */
export const MIN_KEYSTONE_LEVEL = 85;

/** 最高阶（T16）。 */
export const MAX_KEYSTONE_TIER = 16;

/** 基础掉落率：每次 85+ 怪物击杀先掷一次；成功后再掷阶。 */
export const KEYSTONE_DROP_RATE = 0.05;

/**
 * 掉阶偏向：成功掷阶时有该概率**直接落在上限**（`怪阶 + 1`，最高 T16），
 * 其余概率在 `1..cap-1` 上均匀。分布：
 *
 * - `P(cap) = KEYSTONE_CAP_BIAS`（0.75）；
 * - `P(k) = (1 - KEYSTONE_CAP_BIAS) / (cap - 1)`，`k ∈ [1, cap - 1]`（cap > 1 时）；
 * - 合法怪阶下 `cap = min(16, 怪阶 + 1) ≥ 2`；`cap === 1` 仅为防御性分支（恒返回 1）。
 *
 * 即「大多数掉落贴着怪阶上限，偶尔低 1 阶以上」，避免 85 图疯狂产出满阶钥石。
 */
export const KEYSTONE_CAP_BIAS = 0.75;

/** `keystone.tNN` 的规范 key 形状。 */
const KEYSTONE_KEY_PATTERN = /^keystone\.t(\d{1,2})$/;

/**
 * 等级 → 阶（`clamp(level - 84, 1, 16)`）。
 *
 * - 非有限数 / `< 85` → `null`（不掉落）；
 * - `85 → 1`、`86 → 2`、`100 → 16`、`101+ → 16`（小数向下取整）。
 */
export function keystoneTierOfLevel(level: number): number | null {
  if (!Number.isFinite(level) || level < MIN_KEYSTONE_LEVEL) {
    return null;
  }
  const raw = Math.floor(level) - KEYSTONE_TIER_OFFSET;
  return Math.min(MAX_KEYSTONE_TIER, Math.max(1, raw));
}

/** 阶 → 规范 key（`keystone.t01..t16`）；非法阶返回 `null`。 */
export function keystoneKeyOfTier(tier: number): string | null {
  if (!Number.isInteger(tier) || tier < 1 || tier > MAX_KEYSTONE_TIER) {
    return null;
  }
  return `keystone.t${String(tier).padStart(2, '0')}`;
}

/** 规范 key → 阶；非法 / 越界 key 返回 `null`。 */
export function keystoneTierOfKey(key: string): number | null {
  if (typeof key !== 'string') {
    return null;
  }
  const match = KEYSTONE_KEY_PATTERN.exec(key);
  if (!match) {
    return null;
  }
  const tier = Number(match[1]);
  if (!Number.isInteger(tier) || tier < 1 || tier > MAX_KEYSTONE_TIER) {
    return null;
  }
  return tier;
}

/**
 * 怪物阶 → 本次允许掉落的最高阶 = `min(16, 怪阶 + 1)`。
 *
 * 非法怪阶（非正整数）fail-closed 返回 `0`（= 无可用阶）。
 */
export function maxKeystoneDropTier(monsterTier: number): number {
  if (!Number.isInteger(monsterTier) || monsterTier < 1) {
    return 0;
  }
  return Math.min(MAX_KEYSTONE_TIER, monsterTier + 1);
}

/**
 * 掷出本次掉落的具体阶（`1..maxKeystoneDropTier(怪阶)`）。
 *
 * - 非法怪阶（非有限 / 非整数 / `<= 0` / `> 16`）→ `null`，且**不消耗随机数**；
 * - 同一 `Rng` 序列下结果可重放（离线结算可审计）。
 */
export function pickKeystoneTier(monsterTier: number, rng: Rng): number | null {
  if (!Number.isInteger(monsterTier) || monsterTier < 1 || monsterTier > MAX_KEYSTONE_TIER) {
    return null;
  }
  const cap = maxKeystoneDropTier(monsterTier);
  if (cap < 1) {
    return null;
  }
  const roll = rng.next();
  if (cap === 1 || roll < KEYSTONE_CAP_BIAS) {
    return cap;
  }
  // `rng.next()` 契约 [0, 1) ⇒ floor 取值为 0..cap-2 ⇒ lower 落在 1..cap-1。
  return 1 + Math.floor(rng.next() * (cap - 1));
}
