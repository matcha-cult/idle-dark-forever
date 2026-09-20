/**
 * 伤害类型与元素分类 —— **唯一显式真相**（P6/P7，任务书 §2.2 / §1 R5）。
 *
 * 现状（改造前）没有分类表：元素性完全靠「有没有对应的 `{type}Resist` getter」隐式决定，
 * `dark` 事实上是第四元素。R5 要求把它显式化：
 *
 * - **物理** = `melee`（本仓沿用原版的写法，不新增 `physical`）；
 * - **元素** = `fire` / `cold`（冰霜）/ `lightning`；
 * - **混沌** = `chaos`（P7：原名 `dark`）：**不算元素**，`allResist` 不作用于它，
 *   但它有独立的 `chaosResist` / `chaosAbsorb`；
 * - 其余（`magic` / `holy` / `real` / `water` / `poison`）为**无减免**类型（无对应 getter）。
 *
 * ⚠️ 本期**不实装**附加元素伤害与物理→闪电/冰霜→火焰转换（P6）。
 */

/** 元素三系。 */
export type ElementType = 'fire' | 'cold' | 'lightning';

/** 全量伤害类型（`damageType` 目前仍以字符串在数据层流动，这里给出权威取值）。 */
export type DamageType =
  | 'melee'
  | 'fire'
  | 'cold'
  | 'lightning'
  | 'chaos'
  | 'magic'
  | 'holy'
  | 'real'
  | 'water'
  | 'poison';

/** 元素类型集合（唯一真相）。 */
export const ELEMENT_TYPES: readonly ElementType[] = ['fire', 'cold', 'lightning'];

/** 物理伤害的类型字面量（原版写 `melee`）。 */
export const PHYSICAL_DAMAGE_TYPE = 'melee';

/** `chaos`（混沌）——非元素、无属性。 */
export const CHAOS_DAMAGE_TYPE = 'chaos';

/** 是否为元素（只有冰 / 火 / 闪电）。 */
export function isElement(damageType: string): damageType is ElementType {
  return (ELEMENT_TYPES as readonly string[]).includes(damageType);
}

/** 是否为物理伤害。 */
export function isPhysical(damageType: string): boolean {
  return damageType === PHYSICAL_DAMAGE_TYPE;
}

/** 是否为混沌（非元素）。 */
export function isChaos(damageType: string): boolean {
  return damageType === CHAOS_DAMAGE_TYPE;
}

/**
 * 减免口径：`physical` 走护甲（`def`），`resisted` 走 `{type}Resist`，`none` 无减免。
 *
 * 注意 `resisted` 只保证**读取** `{type}Resist`；若该类型没有对应 getter（如 `magic`），
 * `readAttr` 得到 0，等价无减免 —— 这正是原版 `default` 分支的行为，只是现在显式化了。
 */
export type MitigationKind = 'physical' | 'resisted' | 'none';

export function mitigationKindOf(damageType: string): MitigationKind {
  if (isPhysical(damageType)) {
    return 'physical';
  }
  if (isElement(damageType) || isChaos(damageType)) {
    return 'resisted';
  }
  return 'none';
}

/** 抗性 getter / hook 的 key（`fire` → `fireResist`）。 */
export function resistAttrKey(damageType: string): string {
  return `${damageType}Resist`;
}

/** 吸收 getter / hook 的 key（`fire` → `fireAbsorb`）。 */
export function absorbAttrKey(damageType: string): string {
  return `${damageType}Absorb`;
}
