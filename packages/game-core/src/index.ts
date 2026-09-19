/**
 * @idle-dark/game-core —— 公共出口
 *
 * ⚠️ 本文件是**并行开发的冻结契约**：只做 re-export，不写实现。
 * 各子模块的 `index.ts` 必须提供此处列出的导出面。
 *
 * 依赖约束（硬性）：本包**不得** import MobX / React / DOM 类型，
 * 也不得直接使用 `Math.random()` / `Date.now()`（一律经 `contracts/ports.ts` 的端口）。
 */

// 冻结契约：时间 / 随机 / 战斗事件 端口
export * from './contracts/ports.js';
// 冻结契约：数据表类型
export * from './contracts/data.js';

// 可重放随机源
export * from './rng/index.js';
// 虚拟时钟与调度器
export * from './sim/index.js';
// 数据表（TS 化的 data/**）
export * from './data/index.js';
// 规则层：物品 / 掉落 / 成长 / 条件
export * from './rules/index.js';
// 存档编解码（导入《永夜2016典藏重置版》本地存档）
export * from './serialize/index.js';
// 战斗模拟内核（BattleWorld / Unit / EnemyBorn …）
export * from './combat/index.js';
