/**
 * 装备槽 / 武器类别 / 副手判定 —— **前后端共用的唯一真相**（P2 + 任务书 §2.3）。
 *
 * 为什么放在 `protocol`：本仓依赖图里只有 `protocol` 同时被 `game-core`（→server）与
 * `web` 依赖，`web` 又不得依赖 `game-core`。判定表若各写一份必然漂移（AGENTS §11 的教训），
 * 因此把**纯函数 + 常量**放在这个叶子包里，两侧都只消费，不复制。
 */

/** 9 个装备槽（P2：箭袋属副手，不是第 10 槽）。 */
export type EquipPosition =
  | 'weapon'
  | 'offHand'
  | 'plastron'
  | 'gloves'
  | 'belt'
  | 'boots'
  | 'amulet'
  | 'ring1'
  | 'ring2';

/** 槽位顺序（存档遍历 / 前端展示 / 面板槽位解析共用）。 */
export const EQUIP_POSITIONS: readonly EquipPosition[] = [
  'weapon',
  'offHand',
  'plastron',
  'gloves',
  'belt',
  'boots',
  'amulet',
  'ring1',
  'ring2',
];

/** 槽位中文名。 */
export const EQUIP_POSITION_NAMES: Readonly<Record<EquipPosition, string>> = {
  weapon: '主手',
  offHand: '副手',
  plastron: '胸甲',
  gloves: '手套',
  belt: '腰带',
  boots: '鞋子',
  amulet: '项链',
  ring1: '戒指',
  ring2: '戒指',
};

/** 排序权重（背包整理；主手在前）。 */
export const EQUIP_POSITION_ORDER: Readonly<Record<EquipPosition, number>> = {
  weapon: 0,
  offHand: 1,
  plastron: 2,
  gloves: 3,
  belt: 4,
  boots: 5,
  amulet: 6,
  ring1: 7,
  ring2: 8,
};

/**
 * 装备类别（用于「主手 → 副手允许什么」判定）。
 *
 * - 主手武器：`oneHand`（单手）/ `twoHandMelee`（双手近战）/ `bow`（远程双手）；
 * - 副手专属：`shield`（盾牌）/ `quiver`（箭袋）。
 */
export type EquipCategory = 'oneHand' | 'twoHandMelee' | 'bow' | 'shield' | 'quiver';

/**
 * §2.3 副手判定表（已定稿）：
 *
 * | 主手 | 副手允许 |
 * |---|---|
 * | 空 | 盾牌 / 箭袋 |
 * | 单手武器 | 单手武器（双持）/ 盾牌（禁箭袋） |
 * | 双手近战武器 | 锁定（不可装备） |
 * | 弓 | 箭袋（禁盾） |
 *
 * `main` 为 `null` / `undefined` 表示主手空槽。`off` 是**欲放入副手**那件装备的类别。
 */
export function canEquipOffHand(
  main: EquipCategory | null | undefined,
  off: EquipCategory | null | undefined,
): boolean {
  if (off !== 'oneHand' && off !== 'shield' && off !== 'quiver') {
    return false;
  }
  switch (main) {
    case 'twoHandMelee':
      return false;
    case 'bow':
      return off === 'quiver';
    case 'oneHand':
      return off === 'oneHand' || off === 'shield';
    case 'shield':
    case 'quiver':
      // 主手不能是「副手专属」类别（不构成合法武器）。
      return false;
    default:
      // 主手空：只允许副手专属。
      return off === 'shield' || off === 'quiver';
  }
}

/** 是否双手武器（占据副手位；弓额外允许箭袋）。 */
export function isTwoHanded(category: EquipCategory | null | undefined): boolean {
  return category === 'twoHandMelee' || category === 'bow';
}

/** 是否为副手专属类别。 */
export function isOffHandCategory(category: EquipCategory | null | undefined): boolean {
  return category === 'shield' || category === 'quiver';
}
