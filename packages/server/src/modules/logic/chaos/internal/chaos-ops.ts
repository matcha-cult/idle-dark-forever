/**
 * 混沌仪纯逻辑（W6，§2.3 / §4 W6）—— **无 IO、可穷举单测**。
 *
 * 负责三件事：
 * 1. 钥石序列校验（≤16、每项合法、允许重复）；
 * 2. 解锁判据（全部野外 BOSS 已击杀）；
 * 3. 状态机 `nextChaosStep(state, outcome)` —— 给出下一步动作
 *    （`enter` 某一阶 / 触发 `stop`）。
 *
 * 服务端（`ChaosLogicService` 在线、`IdleService` 离线）**共用**本文件，
 * 保证在线与离线推进语义一致（AGENTS §11「只允许一处定义」）。
 *
 * 失败分支（§2.3 默认读法）：
 * - `normal`：任意失败 → **abort**（中断序列，回普通地图）；
 * - `continue`：失败 → **retry** 当前钥石；连续失败 `CHAOS_MAX_RETRY`(3) 次 → **skip** 下一把；
 * - 下一步所需的钥石不存在 / 序列走完 → `stop`（干净停止，**不跳读后续**）。
 */
import {
  CHAOS_MAX_RETRY,
  CHAOS_MAX_SEQUENCE,
  keystoneKeyOfTier,
  keystoneTierOfKey,
  type ChaosFailMode,
  type Player,
} from '@idle-dark/game-core';

/** 混沌仪一次挑战的结算结果（由 battle / 离线内核给出）。 */
export type ChaosOutcome = 'clear' | 'death';

/** 状态机输入（对应 `Player` 上的持久化字段）。 */
export interface ChaosRunState {
  readonly sequence: readonly string[];
  readonly index: number;
  readonly retry: number;
  readonly failMode: ChaosFailMode;
}

/** 停止原因（用于日志 / 测试断言；玩家可见文案由上层决定）。 */
export type ChaosStopReason = 'sequence-exhausted' | 'keystone-missing' | 'aborted';
/** 下一步动作。 */
export type ChaosStep =
  | {
      readonly action: 'enter';
      /** 新的序列下标。 */
      readonly index: number;
      /** 新的连续失败计数。 */
      readonly retry: number;
      /** 要挑战的 T 阶（1~16）。 */
      readonly tier: number;
      /** 要消耗的钥石 key。 */
      readonly keystone: string;
    }
  | { readonly action: 'stop'; readonly reason: ChaosStopReason };

/**
 * 序列校验（严格版）：必须是数组、长度 ≤ 16、每项都是合法 `keystone.tNN`。
 *
 * 空数组**合法**（= 清空序列）；允许重复项。
 */
export function isChaosSequenceValid(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > CHAOS_MAX_SEQUENCE) {
    return false;
  }
  return value.every((item) => typeof item === 'string' && keystoneTierOfKey(item) !== null);
}

/**
 * 序列规范化（宽松版）：丢弃非法项并截断到 16 条；非数组 → 空数组。
 *
 * 与 `Player.fromJSON` 的防御性解析同一口径（存档可能被手改）。
 */
export function normalizeChaosSequence(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= CHAOS_MAX_SEQUENCE) break;
    if (typeof item === 'string' && keystoneTierOfKey(item) !== null) {
      out.push(item);
    }
  }
  return out;
}

/**
 * 解锁判据：`required`（全部野外 BOSS 图 key）非空且全部命中 `killed`。
 *
 * `required` 为空 → `false`（数据缺失时 fail-closed）。
 */
export function isChaosUnlocked(
  killed: ReadonlySet<string> | readonly string[],
  required: readonly string[],
): boolean {
  if (required.length === 0) {
    return false;
  }
  const owned = killed instanceof Set ? killed : new Set(killed);
  return required.every((key) => owned.has(key));
}

/** 该钥石是否可投入（合法 key 且数量 > 0）。 */
function usable(keystone: string | undefined, counts: Readonly<Record<string, number>>): boolean {
  if (typeof keystone !== 'string' || keystoneTierOfKey(keystone) === null) {
    return false;
  }
  const count = counts[keystone];
  return typeof count === 'number' && Number.isFinite(count) && count > 0;
}

/**
 * 开始运行：从序列头开始找**第一把可用钥石**（数量 > 0），返回对应的 `enter`。
 *
 * - 序列为空 / 全不可用 → `stop`（空序列 → `sequence-exhausted`，有序列但缺钥石 → `keystone-missing`）。
 */
export function firstChaosStep(
  state: ChaosRunState,
  counts: Readonly<Record<string, number>>,
): ChaosStep {
  for (let index = 0; index < state.sequence.length; index += 1) {
    const keystone = state.sequence[index];
    const tier = typeof keystone === 'string' ? keystoneTierOfKey(keystone) : null;
    if (tier === null || !usable(keystone, counts)) {
      continue;
    }
    return { action: 'enter', index, retry: 0, tier, keystone: keystone as string };
  }
  return {
    action: 'stop',
    reason: state.sequence.length === 0 ? 'sequence-exhausted' : 'keystone-missing',
  };
}

/**
 * 一次挑战结算后的下一步。
 *
 * | outcome | failMode | 结果 |
 * |---|---|---|
 * | `clear` | 任意 | 前进到下一把 |
 * | `death` | `normal` | `stop(aborted)` |
 * | `death` | `continue` 且 retry+1 < 3 | 重试当前把（retry+1） |
 * | `death` | `continue` 且 retry+1 >= 3 | 跳到下一把（retry=0） |
 *
 * 前进 / 跳过之后，若下标越界 → `stop(sequence-exhausted)`；若目标钥石缺失 → `stop(keystone-missing)`。
 */
export function nextChaosStep(
  state: ChaosRunState,
  outcome: ChaosOutcome,
  counts: Readonly<Record<string, number>>,
): ChaosStep {
  if (outcome === 'death' && state.failMode === 'normal') {
    return { action: 'stop', reason: 'aborted' };
  }

  let index = state.index;
  let retry = state.retry;
  if (outcome === 'clear') {
    index += 1;
    retry = 0;
  } else {
    // continue：先重试当前把；连续失败达到阈值后跳下一把。
    retry += 1;
    if (retry >= CHAOS_MAX_RETRY) {
      index += 1;
      retry = 0;
    }
  }

  if (index < 0 || index >= state.sequence.length) {
    return { action: 'stop', reason: 'sequence-exhausted' };
  }
  const keystone = state.sequence[index];
  const tier = typeof keystone === 'string' ? keystoneTierOfKey(keystone) : null;
  if (tier === null || !usable(keystone, counts)) {
    return { action: 'stop', reason: 'keystone-missing' };
  }
  return { action: 'enter', index, retry, tier, keystone: keystone as string };
}

// ────────────────────────────── Player ↔ 状态机 适配 ──────────────────────────────

/** 读 `Player` 混沌状态为纯状态机入参。 */
export function stateOf(player: Player): ChaosRunState {
  return {
    sequence: player.chaosSequence,
    index: player.chaosIndex,
    retry: player.chaosRetry,
    failMode: player.chaosFailMode,
  };
}

/** 当前挑战阶（未运行 / 越界 → null）。 */
export function currentTierOf(player: Player): number | null {
  if (!player.chaosActive) return null;
  const key = player.chaosSequence[player.chaosIndex];
  return typeof key === 'string' ? keystoneTierOfKey(key) : null;
}

/** 背包里各钥石数量（混沌钥石是背包物品，不走钱包）。 */
export function countsOf(player: Player): Record<string, number> {
  const out: Record<string, number> = {};
  for (let tier = 1; tier <= CHAOS_MAX_SEQUENCE; tier += 1) {
    const key = keystoneKeyOfTier(tier);
    if (key !== null) out[key] = player.countGood(key);
  }
  return out;
}
