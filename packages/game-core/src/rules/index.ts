/**
 * `rules/` —— 持久化模型与规则（原版 `src/logics/player.js` + `goods.js` + `check.js` 的移植）。
 *
 * 设计约束（全部已满足）：
 * - 无 MobX / React / DOM：普通 class + 显式 `toJSON()` / `fromJSON()`；
 * - 无裸 `Math.random()`：随机一律经 `Rng` 端口（`generateEquip` / `randomEquip` / `randomAffixes`…）；
 * - 无裸 `Date.now()`：时间由注入的 `now` 源提供（见 `Player` 构造参数）；
 * - 规则函数第一参数是 `DataTables`，**不** import `src/data/`；
 * - 保留原版 `fromJS` 的隐式兼容语义（缺失字段兜底 / `DEFAULT_LEVEL` / `dungeonTickets` 补齐 / `skillExp.level ≤ 70`）。
 *
 * 导出面：
 * - `PlayerMeta` + 存档兜底 helper + 等级换算（`transformEquipLevel` 等）
 * - `AffixInfo` / `InventorySlot`
 * - `CareerInfo`
 * - `Player`
 * - 拾取规则编码与判定（`lootRuleKeyOf` / `lootRuleActionOf` …，跨域唯一定义）
 * - `randomAffixValue` / `randomAffixes` / `isValidAffix` / `generateEquip` / `randomEquip`
 *   / `getMaterialLevel` / `getDecomposeMatrials`
 * - `checkRequirement`
 */

export * from './player-meta.js';
export * from './inventory-slot.js';
export * from './career-info.js';
export * from './goods.js';
export * from './loot-rule.js';
export * from './damage.js';
export * from './check.js';
export * from './combat-area.js';
export * from './dungeon.js';
export * from './player.js';
