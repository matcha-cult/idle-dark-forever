/**
 * `combat/` —— 战斗模拟内核的公共出口。
 *
 * 依赖方向：`combat` → `contracts` + `rng` + `sim`（不依赖 server / web / MobX）。
 * 数据表通过构造器注入（`BattleWorldOptions.tables`），因此单测可用内联 fixture 独立运行。
 */

export * from './camps.js';
export * from './util.js';
export * from './skill-state.js';
export * from './buff-state.js';
export * from './unit.js';
export * from './player-unit.js';
export * from './enemy-unit.js';
export * from './battle-world.js';
export * from './spawner.js';
