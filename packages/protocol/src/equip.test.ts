/**
 * 副手判定表（§2.3）—— 前后端共用同一份真相的边界测试。
 *
 * 这张表是 P2 的核心：主手放什么，决定副手允许放什么。任何一侧再写一份实现都会漂移，
 * 因此这里把「主手类别 × 副手类别」的全组合钉死（含 undefined / null / 非法值）。
 */
import { describe, expect, it } from 'vitest';

import {
  EQUIP_POSITION_NAMES,
  EQUIP_POSITION_ORDER,
  EQUIP_POSITIONS,
  canEquipOffHand,
  isOffHandCategory,
  isTwoHanded,
  type EquipCategory,
} from './equip.js';

const ALL: Array<EquipCategory | null | undefined> = [
  'oneHand',
  'twoHandMelee',
  'bow',
  'shield',
  'quiver',
  null,
  undefined,
];

describe('canEquipOffHand（§2.3 判定表）', () => {
  it('主手空：只允许盾 / 箭袋', () => {
    expect(canEquipOffHand(null, 'shield')).toBe(true);
    expect(canEquipOffHand(null, 'quiver')).toBe(true);
    expect(canEquipOffHand(undefined, 'shield')).toBe(true);
    expect(canEquipOffHand(null, 'oneHand')).toBe(false);
    expect(canEquipOffHand(null, 'twoHandMelee')).toBe(false);
    expect(canEquipOffHand(null, 'bow')).toBe(false);
    expect(canEquipOffHand(null, null)).toBe(false);
    expect(canEquipOffHand(null, undefined)).toBe(false);
  });

  it('单手主手：可双持、可盾、禁箭袋', () => {
    expect(canEquipOffHand('oneHand', 'oneHand')).toBe(true);
    expect(canEquipOffHand('oneHand', 'shield')).toBe(true);
    expect(canEquipOffHand('oneHand', 'quiver')).toBe(false);
    expect(canEquipOffHand('oneHand', 'twoHandMelee')).toBe(false);
    expect(canEquipOffHand('oneHand', 'bow')).toBe(false);
  });

  it('双手近战主手：副手锁定', () => {
    expect(canEquipOffHand('twoHandMelee', 'shield')).toBe(false);
    expect(canEquipOffHand('twoHandMelee', 'quiver')).toBe(false);
    expect(canEquipOffHand('twoHandMelee', 'oneHand')).toBe(false);
    expect(canEquipOffHand('twoHandMelee', null)).toBe(false);
  });

  it('弓主手：只允许箭袋、禁盾', () => {
    expect(canEquipOffHand('bow', 'quiver')).toBe(true);
    expect(canEquipOffHand('bow', 'shield')).toBe(false);
    expect(canEquipOffHand('bow', 'oneHand')).toBe(false);
  });

  it('主手是副手专属类别时一律拒绝（不构成合法武器）', () => {
    expect(canEquipOffHand('shield', 'shield')).toBe(false);
    expect(canEquipOffHand('quiver', 'quiver')).toBe(false);
    expect(canEquipOffHand('shield', 'oneHand')).toBe(false);
  });

  it('全组合不抛错且返回值恒为布尔', () => {
    for (const main of ALL) {
      for (const off of ALL) {
        expect(typeof canEquipOffHand(main, off)).toBe('boolean');
      }
    }
  });
});

describe('isTwoHanded / isOffHandCategory', () => {
  it('双手类别', () => {
    expect(isTwoHanded('twoHandMelee')).toBe(true);
    expect(isTwoHanded('bow')).toBe(true);
    expect(isTwoHanded('oneHand')).toBe(false);
    expect(isTwoHanded(null)).toBe(false);
    expect(isTwoHanded(undefined)).toBe(false);
  });

  it('副手专属类别', () => {
    expect(isOffHandCategory('shield')).toBe(true);
    expect(isOffHandCategory('quiver')).toBe(true);
    expect(isOffHandCategory('oneHand')).toBe(false);
    expect(isOffHandCategory(undefined)).toBe(false);
  });
});

describe('槽位常量', () => {
  it('恰好 9 槽且 names / order 全覆盖、不重复', () => {
    expect(EQUIP_POSITIONS).toHaveLength(9);
    expect(new Set(EQUIP_POSITIONS).size).toBe(9);
    for (const position of EQUIP_POSITIONS) {
      expect(typeof EQUIP_POSITION_NAMES[position]).toBe('string');
      expect(Number.isFinite(EQUIP_POSITION_ORDER[position])).toBe(true);
    }
    expect(new Set(EQUIP_POSITIONS.map((p) => EQUIP_POSITION_ORDER[p])).size).toBe(9);
  });
});
