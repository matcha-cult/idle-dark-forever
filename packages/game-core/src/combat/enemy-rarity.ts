/**
 * 怪物稀有度四阶（W11）—— **唯一定义**。
 *
 * ```
 * 0 普通   1 稀有   2 精英   3 传奇（守关 BOSS）
 * ```
 *
 * ## 为什么是四阶、为什么绑 `quality`
 *
 * 本仓库此前**没有**「怪物稀有度」这条轴：`EnemyUnit.quality` 是**敌人词缀条数**
 * （⚠️ 与装备品质 `Quality` 同名不同义，后者只有 3 档且不含「精英」/「守关 BOSS」）。
 * W11 把四阶直接绑在既有的 `quality` + `boss` 标记上：
 *
 * | 档位 | 来源 | 词缀 | HP / exp 倍率 |
 * |---|---|---|---|
 * | 普通 | `quality 0` | 0 条 | ×1 |
 * | 稀有 | `quality 1` | 1 条 | ×2 |
 * | 精英 | `quality 2`（每 10 波定时保底一只） | 2 条 | ×4 |
 * | 传奇 | 守关 BOSS（`EnemyUnit.worldBoss`） | — | 由 BOSS 数据决定 |
 *
 * 这样「精英」**白拿**现成的词缀前缀（`displayName` 会拼出「强壮的小史莱姆」）、
 * `maxHp *= 2 ** quality`、`exp *= 2 ** quality`，且不需要新枚举 / 新随机源 ——
 * 1% 概率自然刷出的双词缀怪本来就存在，精英只是把它变成**定时保底**。
 *
 * ## 纪律
 *
 * - 「档位」由**服务端**派生下发（`UnitStateDto.rarity`），前端**零推导** ——
 *   与 `alive`（服务端按 `camp === 'ghost'` 派生）同一个先例。
 *   **禁止前端拿 `boss` / `elite` / `quality` 自己拼档位**：`quality` 是词缀条数、可 > 2，
 *   正是最容易拼错的地方。
 * - 等级偏移与档位**共用同一个夹取**（{@link clampEnemyQuality}），保证「精英 = +2 级」
 *   与「精英 = 第 2 档」不会各自漂移。
 */

/** 档位常量（索引即 `UnitStateDto.rarity`）。 */
export const ENEMY_RARITY = {
  common: 0,
  rare: 1,
  elite: 2,
  legendary: 3,
} as const;

/** 档位上限（`legendary`）。 */
export const ENEMY_RARITY_MAX = ENEMY_RARITY.legendary;

/**
 * 敌人词缀条数的**安全上限**。
 *
 * 为什么需要：`EnemyUnit` 构造器会 `for (let i = 0; i < quality; i++) this.affixes.push(…)`，
 * 而 `quality` 直接来自调用方 —— 脏数据（`Infinity` / `1e9`）会一直 push 到
 * `RangeError: Invalid array length`（实测 `quality = Infinity` 时单测挂 14 秒后抛错）。
 * 词缀池只有 3 条，8 已经远超任何真实需求。
 */
export const MAX_ENEMY_QUALITY = 8;

/**
 * **字段级**安全化敌人 `quality`：非有限 / 非数字 / 负数 → `0`；否则向下取整并夹到
 * `[0, {@link MAX_ENEMY_QUALITY}]`。
 *
 * ⚠️ 与 {@link clampEnemyQuality}（夹到 `0..2`，用于**等级偏移与稀有度**）分工不同：
 * 本函数只保证「不会撑爆内存 / 不会算出 `Infinity` 属性」，**不**主张四阶语义。
 * 协议里 `UnitStateDto.quality` 仍允许 `> 2`（它是词缀条数，不是装备品质）。
 */
export function normalizeEnemyQuality(quality: number | null | undefined): number {
  if (typeof quality !== 'number' || !Number.isFinite(quality) || quality <= 0) return 0;
  return Math.min(MAX_ENEMY_QUALITY, Math.floor(quality));
}

/**
 * 把敌人 `quality`（**词缀条数**）夹到 `0..2` —— 这是**稀有度档位与等级偏移**的口径。
 *
 * 边界一律 `0`：`undefined` / `null`（经 `?? 0` 后不会到这）/ `NaN` / `±Infinity` / 非数字；
 * 负数与小数向安全方向收（`<= 0 → 0`，`>= 2 → 2`，其余 `Math.floor`）。
 *
 * ⚠️ **必须夹取**：`quality` 一旦异常（如 `Infinity`），`mapLevel + quality` 会把怪物等级
 * 推到无穷，进而毁掉掉落等级门槛（`min(怪物等级, 地图等级)`）与展示。
 */
export function clampEnemyQuality(quality: number | null | undefined): number {
  if (typeof quality !== 'number' || !Number.isFinite(quality)) return 0;
  if (quality <= 0) return 0;
  if (quality >= 2) return 2;
  return Math.floor(quality);
}

/** 派生稀有度所需的**最小**单位视图（避免与 `EnemyUnit` 形成类型环）。 */
export interface RaritySource {
  /** `EnemyUnit.worldBoss`：守关 BOSS。 */
  worldBoss?: boolean;
  /** `EnemyUnit.elite`：每 10 波定时刷出的精英。 */
  elite?: boolean;
  /** `EnemyUnit.quality`：敌人词缀条数（可 > 2）。 */
  quality?: number;
}

/**
 * 派生怪物稀有度档位。
 *
 * 优先级：**守关 BOSS(3) > 精英标记(2) > `clampEnemyQuality(quality)`（0/1/2）**。
 *
 * ⚠️ 注意最后一项是 `quality` **本身**（夹到 0..2），不是「`quality >= 1` → 稀有」：
 * 档位表是逐级对应的 —— `quality 0/1/2` = 普通/稀有/精英。
 * 把 `quality 2` 也归到「稀有」会让**自然刷出的 1% 双词缀怪**与定时保底的精英同档，
 * 四阶就退化回三阶了。
 *
 * 只看这几个布尔 / 数字，不做数值运算 —— 因此可以在每帧差分里低成本复用。
 */
export function enemyRarityOf(unit: RaritySource): number {
  if (unit.worldBoss === true) return ENEMY_RARITY.legendary;
  if (unit.elite === true) return ENEMY_RARITY.elite;
  return clampEnemyQuality(unit.quality ?? 0);
}
