/**
 * 离线结算时长阈值 ——**共享层**
 *
 * 在线（battle 的 `world.service` 用它算 `pendingOfflineMs` 上限）与离线编排
 * （dungeon 的 `idle-logic.service`）都要用；放这里避免 dungeon → battle 的反向依赖。
 */

/** 离线结算硬上限（保持原版 72h 语义）。 */
export const OFFLINE_MAX_MS = 72 * 60 * 60 * 1000;
/** 超过该离线时长即标记 `pausedByMaxOffline`（产品阈值 24h）。 */
export const OFFLINE_PAUSE_AFTER_MS = 24 * 60 * 60 * 1000;
