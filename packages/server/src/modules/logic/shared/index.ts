/**
 * `modules/logic/shared` —— 逻辑域共享件出口。
 *
 * 08 §阶段1「解环与公共层上移」：面板域通用的横切件（当前角色解析 / 推送助手 /
 * 业务失败异常 / Action 参数解析 / 背包格子解析 / opId 幂等 / 随机源）**不属于任何单一
 * 业务逻辑服**，集中在本目录，供各域单向引用 —— 否则 `world/inventory/career` 之间
 * 会经由 `inventory/internal/*` 形成环（见 09 §0.3 环快照）。
 */
export * from './game-clock.js';
export * from './exp-rate.js';
export * from './offline.js';
export * from './player-dto.js';
export * from './world-map-state.js';
export * from './battle-command.js';
export * from './map-dto.js';
export * from './battle-collector.js';
export * from './loot-service.js';
export * from './player-like.js';
export * from './headless.js';
export * from './player-context.service.js';
export * from './logic-shared.module.js';
export * from './events.js';
export * from './event-bus.js';
export * from './panel-character.service.js';
export * from './panel-character.module.js';
export * from './notify.js';
export * from './op-error.js';
export * from './action-parse.js';
export * from './slot-ref.js';
export * from './idempotency.js';
export * from './rng.js';
