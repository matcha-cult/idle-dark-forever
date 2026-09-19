/**
 * `sim/` —— 虚拟时钟与调度器（原版 `Timeline.js` + `PrivQueue.js` 的移植）。
 *
 * 导出面：
 * - `PrivQueue`            最小二叉堆（比较函数可注入）
 * - `ClockBase`            虚拟时钟引擎（rate / pause / stepPaused）
 * - `Timeline`             以父时钟为源的从属时钟（原版 `new Timeline(parent)`）
 * - `RealClock`            注入时间源的真实时钟
 * - `VirtualClock`         手动 `advanceBy(ms)` 的虚拟时钟
 * - `SystemClockFactory` / `VirtualClockFactory`  `ClockFactory` 端口实现
 */

export * from './priv-queue.js';
export * from './timeline.js';
export * from './clocks.js';
