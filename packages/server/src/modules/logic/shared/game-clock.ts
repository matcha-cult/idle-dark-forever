/**
 * 时间 / 数据表的注入令牌（逻辑域共享）
 *
 * 硬约束（`AGENTS.md` §1.5）：业务逻辑里**禁止裸 `Date.now()`**。
 * 需要时间的服务一律注入 `GAME_CLOCK`；组合根（`LogicSharedModule`）只在这一处提供
 * `() => Date.now()`，测试可覆盖为固定时间源。
 */

/** 注入「毫秒时间源」的令牌：`() => number`。 */
export const GAME_CLOCK = Symbol('GAME_CLOCK');

/** 时间源类型。 */
export type NowSource = () => number;

/** 注入只读 `DataTables` 单例的令牌（`createDefaultTables()` 的产物）。 */
export const DATA_TABLES = Symbol('DATA_TABLES');
