/**
 * 世界运行参数（集中配置；不要在业务代码里散落魔数）
 *
 * 依据 `ai-docs/00-重写总方案.md` §8.2（tick 形态）与 §8.3（离线结算）。
 */
export const WORLD_CONFIG = {
  /** 全局心跳间隔（ms）。方案建议 100~200；取 200 = 5Hz，与 batcher 默认 flush 周期一致。 */
  tickIntervalMs: 200,
  /**
   * 单 tick 最多推进的虚拟毫秒（防止一次事件循环停顿后补跑巨量回调）。
   * 超出部分丢弃（在线实时性优先；离线收益由 idle 域单独结算）。
   */
  maxCatchUpMs: 5_000,
  /**
   * 单角色单 tick 的事件预算：`Clock.stepPaused(rest, budget)` 的 budget。
   * 预算耗尽时剩余毫秒进入下一 tick，避免单个角色阻塞事件循环。
   */
  callbackBudgetPerCharacterPerTick: 2_000,
  /** 单 tick 最多处理的角色数（在线角色很多时的公平轮转粒度）。 */
  maxCharactersPerTick: 100,
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
