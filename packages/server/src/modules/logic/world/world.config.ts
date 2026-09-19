/**
 * 世界运行参数（集中配置；不要在业务代码里散落魔数）
 *
 * 依据 `ai-docs/00-重写总方案.md` §8.2（tick 形态）、§8.3（离线结算）与
 * `ai-docs/07-容量限定与迁移任务书.md` T-A2（预算驱动调度）。
 *
 * ⚠️ **不变式 I1/I2**（07 §0）：世界时间必须等于真实时间；任何「每轮处理 N 个」的循环
 * 都必须同时给出**全局预算**与**超载行为**。因此这里**没有** `maxCharactersPerTick`
 * 这类人数语义的上限 —— 调度按「每轮跑满 CPU/回调预算」推进，剩余角色顺延到下一轮
 * 且**不丢时间**（债务记账，见 `internal/tick-scheduler.ts`）。
 */
const TICK_INTERVAL_MS = 200;
/** 单角色硬债务上限：待补虚拟时间超过它才**显式**截断（计入 metric + `[OVERLOAD]` 日志）。 */
const DEBT_SHED_MS = 5_000;

export const WORLD_CONFIG = {
  /** 全局心跳间隔（ms）。200 = 5Hz，与 batcher 默认 flush 周期一致。 */
  tickIntervalMs: TICK_INTERVAL_MS,
  /**
   * 单轮 tick 的**全局 CPU 墙钟上限**（ms）。
   * 到点即停止本轮、剩余角色顺延到下一轮（`world_time_ratio` 不变）。
   */
  maxRoundCpuMs: 40,
  /**
   * 单轮 tick 的**全局回调预算**（跨角色累加，实际用量来自 `Clock.callbacksUsed()`）。
   * 到点即停止本轮、剩余角色顺延。
   */
  globalCallbackBudgetPerRound: 50_000,
  /**
   * 单角色单次 `stepPaused` 的事件预算：预算耗尽时剩余毫秒进入下一 tick（`carryMs`），
   * 避免单个角色阻塞事件循环。
   */
  callbackBudgetPerCharacterPerTick: 2_000,
  /** 单角色待补时间超过它就告警（`[OVERLOAD]`，但不截断）。 */
  worldTimeDebtWarnMs: 2_000,
  /** 硬债务上限：待补时间超过它才显式截断并计入 `world_truncated_ms_total`（>0 即缺陷信号）。 */
  worldTimeDebtShedMs: DEBT_SHED_MS,
  /** @deprecated 旧名；语义已改为「硬债务上限（不再静默丢弃）」，等于 `worldTimeDebtShedMs`。 */
  maxCatchUpMs: DEBT_SHED_MS,
  /** 定时落库间隔（ms）：只在关键节点 + 这个周期落库，**不每 tick 写库**。 */
  persistIntervalMs: 30_000,
} as const;

/** 单角色一次 tick 的调度参数。 */
export interface TickBudget {
  /** 本次要推进的虚拟毫秒。 */
  restMs: number;
  /** 本次最多执行的回调数。 */
  callbackBudget: number;
}

/** 离线结算硬上限（保持原版 72h 语义）。 */
export const OFFLINE_MAX_MS = 72 * 60 * 60 * 1000;
/** 超过该离线时长即标记 `pausedByMaxOffline`（产品阈值 24h）。 */
export const OFFLINE_PAUSE_AFTER_MS = 24 * 60 * 60 * 1000;

/** 经验倍率允许的上限（防止 env 写成天文数字把数值体系打崩）。 */
export const EXP_RATE_MAX = 1000;

/**
 * 解析角色经验倍率（`EXP_RATE` 环境变量）。
 *
 * - 缺省 / 空串 → `1`（原版）；
 * - 只接受**有限、> 0、≤ `EXP_RATE_MAX`** 的数，其余一律回落 `1`
 *   （配错一个 0 或 NaN 不该让全服经验归零或爆炸）；
 * - 本地开发由 `dev.config.json` 的 `expRate` 经 `scripts/dev.mjs` 注入该变量，
 *   **生产不设即为 1**。
 *
 * ⚠️ 只作用于**角色经验**（在线战斗与离线结算都走 `BattleWorld.gotExp`），
 * 不影响技能经验与掉落数量（掉落数量归 `updateRate`）。
 */
export function parseExpRate(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 1;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value) || value <= 0 || value > EXP_RATE_MAX) return 1;
  return value;
}

/** 当前进程的角色经验倍率（启动时读一次环境变量）。 */
export const EXP_RATE = parseExpRate(process.env.EXP_RATE);
