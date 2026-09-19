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
