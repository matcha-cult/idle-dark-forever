/**
 * E5：显式伤害分类表（P6/P7）+ 混沌非元素 + 元素分类收口。
 */
import { describe, expect, it } from 'vitest';

import {
  CHAOS_DAMAGE_TYPE,
  ELEMENT_TYPES,
  absorbAttrKey,
  isChaos,
  isElement,
  isPhysical,
  mitigationKindOf,
  resistAttrKey,
} from './damage.js';

describe('伤害分类表', () => {
  it('元素 = 冰 / 火 / 闪电，且唯一', () => {
    expect(ELEMENT_TYPES).toEqual(['fire', 'cold', 'lightning']);
    expect(new Set(ELEMENT_TYPES).size).toBe(3);
    for (const type of ELEMENT_TYPES) {
      expect(isElement(type)).toBe(true);
      expect(mitigationKindOf(type)).toBe('resisted');
    }
  });

  it('物理 = melee；混沌 = chaos 且非元素', () => {
    expect(isPhysical('melee')).toBe(true);
    expect(mitigationKindOf('melee')).toBe('physical');
    expect(isChaos(CHAOS_DAMAGE_TYPE)).toBe(true);
    expect(isElement(CHAOS_DAMAGE_TYPE)).toBe(false);
    expect(mitigationKindOf(CHAOS_DAMAGE_TYPE)).toBe('resisted');
  });

  it('其余类型无减免（magic / holy / real / water / poison / 未知）', () => {
    for (const type of ['magic', 'holy', 'real', 'water', 'poison', '', 'nonsense']) {
      expect(isElement(type)).toBe(false);
      expect(isPhysical(type)).toBe(false);
      expect(mitigationKindOf(type)).toBe('none');
    }
  });

  it('attr key 拼装', () => {
    expect(resistAttrKey('fire')).toBe('fireResist');
    expect(absorbAttrKey('chaos')).toBe('chaosAbsorb');
  });

  it('边界：undefined / null / 非字符串不抛错（按字符串比较）', () => {
    for (const value of [undefined, null, 0, {}] as unknown[]) {
      expect(() => mitigationKindOf(value as string)).not.toThrow();
      expect(mitigationKindOf(value as string)).toBe('none');
    }
  });
});
