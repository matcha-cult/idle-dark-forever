/**
 * `combat/` —— 战斗模拟内核的公共出口。
 *
 * 依赖方向：`combat` → `contracts` + `rng` + `sim`（不依赖 server / web / MobX）。
 * 数据表通过构造器注入（`BattleWorldOptions.tables`），因此单测可用内联 fixture 独立运行。
 */

export * from './camps.js';
/**
 * `util.ts` 改为**显式导出**：其中 `transformEquipLevel` / `untransformEquipLevel` 与
 * `rules/` 导出的同名函数冲突（`game-core/src/index.ts` 同时 `export *` 两者会产生
 * TS2308 歧义）。装备等级换算的**权威实现归 `rules/`**；combat 内部仍直接用 `./util.js`
 * （内部 import 不受本文件影响），对外不再重复暴露这两个名字。
 */
export {
  camelCase,
  toNumber,
  readAttr,
  readNumField,
  readBoolField,
  clampResource,
} from './util.js';
export * from './skill-state.js';
export * from './buff-state.js';
export * from './unit.js';
export * from './player-unit.js';
export * from './enemy-unit.js';
export * from './battle-world.js';
export * from './spawner.js';
