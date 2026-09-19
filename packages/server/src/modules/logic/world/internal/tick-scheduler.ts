/**
 * 预算驱动的 tick 调度（**纯函数**，07 T-A2 / 不变式 I1–I2）
 *
 * 背景：原实现用 `maxCharactersPerTick = 100` 做「每轮最多处理 N 个角色」的轮转，
 * 5000 人在线时每个角色 **10 秒才 tick 一次**、每次最多补 5 秒 ⇒ 世界时间只有真实时间的
 * ~50%（功能级损坏，且**静默**）。本模块把调度改成：
 *
 * 1. **轮转顺序** `planRound`：从 `cursor` 起绕一圈，返回本轮的访问顺序；
 * 2. **单角色时间记账** `planAdvance`：`elapsed`（真实经过，时钟回拨按 0）+ `carryMs`（上次没跑完的）
 *    = 本次要补的量；**只有**超过硬上限才**显式**截断（返回 `shedMs`，调用方计入 metric 并打日志）；
 * 3. **本轮是否收工** `shouldStopRound`：全局回调预算 / 单轮 CPU 预算，任一打满即停，
 *    剩余角色**顺延**到下一轮（`lastTickAt` 不变 ⇒ 下一轮补全 elapsed，时间不丢）。
 *
 * 所有函数对 `NaN / Infinity / 负数 / 0 / 非有限` 输入都给了显式回落，且**不会**让一轮处理 0 个角色。
 */

/** 全局回调预算缺省值（配置非法时回落；与 `WORLD_CONFIG.globalCallbackBudgetPerRound` 一致）。 */
export const DEFAULT_GLOBAL_CALLBACK_BUDGET = 50_000;
/** 单轮 CPU 预算缺省值（ms；与 `WORLD_CONFIG.maxRoundCpuMs` 一致）。 */
export const DEFAULT_MAX_ROUND_CPU_MS = 40;
/** 硬债务上限缺省值（ms；与 `WORLD_CONFIG.worldTimeDebtShedMs` 一致）。 */
export const DEFAULT_DEBT_SHED_MS = 5_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  const n = finite(value, fallback);
  return n >= 0 ? n : fallback;
}

function positiveOr(value: unknown, fallback: number): number {
  const n = finite(value, fallback);
  return n > 0 ? n : fallback;
}

// ────────────────────────────── 轮转顺序 ──────────────────────────────

export interface RotationPlan {
  /** 本轮访问顺序（从 `startCursor` 起绕一圈）。 */
  readonly order: readonly string[];
  /** 归一化后的起始游标（`0..total-1`；空集合为 0）。 */
  readonly startCursor: number;
}

/**
 * 计算本轮的角色访问顺序。
 *
 * - 空集合 → `order = []`、`startCursor = 0`；
 * - `cursor` 非有限 / 负数 / 越界 → 归一化到 `0`；
 * - 不做任何「最多 N 个」截断 —— 截断由 `shouldStopRound` 在**执行中**按预算决定。
 */
export function planRound(keys: readonly string[], cursor: number): RotationPlan {
  const total = keys.length;
  if (total === 0) return { order: [], startCursor: 0 };
  const raw = finite(cursor, 0);
  const startCursor = ((Math.trunc(raw) % total) + total) % total;
  const order: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const key = keys[(startCursor + i) % total];
    if (key !== undefined) order.push(key);
  }
  return { order, startCursor };
}

/** 处理 `processed` 个之后的下一个游标（`total <= 0` → 0）。 */
export function nextCursor(startCursor: number, processed: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const start = finite(startCursor, 0);
  const done = Math.max(0, finite(processed, 0));
  return ((Math.trunc(start + done) % total) + total) % total;
}

// ────────────────────────────── 单角色时间记账 ──────────────────────────────

export interface AdvanceInput {
  /** 本轮真实墙钟（ms）。 */
  readonly now: number;
  /** 该会话上次被 tick 的真实墙钟（ms）。 */
  readonly lastTickAt: number;
  /** 上次因回调预算没用完的虚拟毫秒（债务，>= 0）。 */
  readonly carryMs: number;
  /** 超过它就告警（不截断）。 */
  readonly debtWarnMs: number;
  /** 硬上限：超过它才显式截断。 */
  readonly debtShedMs: number;
}

export interface AdvancePlan {
  /** 真实经过的毫秒（时钟回拨 → 0）。 */
  readonly elapsedMs: number;
  /** 本次请求补的虚拟毫秒（`elapsedMs + carryMs`）。 */
  readonly requestedMs: number;
  /** 实际交给 `stepPaused` 的虚拟毫秒（`<= debtShedMs`）。 */
  readonly advanceMs: number;
  /** 被**显式截断**丢掉的虚拟毫秒（> 0 即 OVERLOAD，调用方必须记 metric + 日志）。 */
  readonly shedMs: number;
  /** 是否超过告警线（`requestedMs > debtWarnMs`）。 */
  readonly warn: boolean;
}

/**
 * 计算单角色本次要补的虚拟时间。
 *
 * 边界：
 * - `now < lastTickAt`（时钟回拨）→ `elapsedMs = 0`；
 * - `now` / `lastTickAt` 为 `NaN` → 视为 0 差值；
 * - `carryMs` 为 `NaN` / 负数 → 0；
 * - `debtShedMs` 非法（`NaN` / `<= 0`）→ 回落 `DEFAULT_DEBT_SHED_MS`（绝不静默丢弃）。
 */
export function planAdvance(input: AdvanceInput): AdvancePlan {
  const now = finite(input.now, 0);
  const last = finite(input.lastTickAt, now);
  const carryMs = finiteNonNegative(input.carryMs, 0);
  const elapsedMs = Math.max(0, now - last);
  const requestedMs = elapsedMs + carryMs;
  const shedCap = positiveOr(input.debtShedMs, DEFAULT_DEBT_SHED_MS);
  const advanceMs = Math.min(requestedMs, shedCap);
  const shedMs = Math.max(0, requestedMs - advanceMs);
  const warnMs = finiteNonNegative(input.debtWarnMs, 0);
  return { elapsedMs, requestedMs, advanceMs, shedMs, warn: requestedMs > warnMs };
}

// ────────────────────────────── 本轮是否收工 ──────────────────────────────

export interface RoundStopInput {
  /** 本轮已消耗的回调数（跨角色累加）。 */
  readonly callbacksUsed: number;
  /** 全局回调预算。 */
  readonly callbackBudget: number;
  /** 本轮已消耗的 CPU 墙钟（ms）。 */
  readonly elapsedCpuMs: number;
  /** 单轮 CPU 预算（ms）。 */
  readonly cpuBudgetMs: number;
}

/**
 * 是否应停止本轮（剩余角色顺延）。
 *
 * 预算非法（`NaN` / `<= 0`）时**回落缺省值**，避免「配置写错 → 整轮 0 处理 / 死循环」。
 */
export function shouldStopRound(input: RoundStopInput): boolean {
  const callbacksUsed = finiteNonNegative(input.callbacksUsed, 0);
  const callbackBudget = positiveOr(input.callbackBudget, DEFAULT_GLOBAL_CALLBACK_BUDGET);
  const elapsedCpuMs = finiteNonNegative(input.elapsedCpuMs, 0);
  const cpuBudgetMs = positiveOr(input.cpuBudgetMs, DEFAULT_MAX_ROUND_CPU_MS);
  return callbacksUsed >= callbackBudget || elapsedCpuMs >= cpuBudgetMs;
}
