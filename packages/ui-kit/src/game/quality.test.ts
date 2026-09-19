/** 品质契约的纯函数与常量边界测试（7 档）。 */
import { describe, expect, it } from 'vitest';
import {
  clampQuality,
  MAX_QUALITY,
  QUALITY_COLOR_TOKEN_NAMES,
  QUALITY_LABELS,
  qualityColorTokenName,
  qualityLabel,
} from './quality.js';

describe('QUALITY_LABELS', () => {
  it('7 档且顺序与协议一致', () => {
    expect(QUALITY_LABELS).toEqual(['普通', '优秀', '精良', '史诗', '传说', '远古', '神器']);
  });

  it('色 token 名 7 个且互不重复', () => {
    expect(QUALITY_COLOR_TOKEN_NAMES).toHaveLength(7);
    expect(new Set(QUALITY_COLOR_TOKEN_NAMES).size).toBe(7);
  });
});

describe('clampQuality', () => {
  it('合法档位原样返回', () => {
    expect(clampQuality(0)).toBe(0);
    expect(clampQuality(3)).toBe(3);
    expect(clampQuality(MAX_QUALITY)).toBe(6);
  });

  it('小数截断', () => {
    expect(clampQuality(2.9)).toBe(2);
    expect(clampQuality(-0.4)).toBe(0);
  });

  it('负值 / 越界夹取', () => {
    expect(clampQuality(-5)).toBe(0);
    expect(clampQuality(99)).toBe(6);
  });

  it('NaN / Infinity / undefined → 0', () => {
    expect(clampQuality(Number.NaN)).toBe(0);
    expect(clampQuality(Number.POSITIVE_INFINITY)).toBe(6);
    expect(clampQuality(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(clampQuality(undefined as unknown as number)).toBe(0);
  });
});

describe('qualityLabel', () => {
  it('缺省用内置文案', () => {
    expect(qualityLabel(0)).toBe('普通');
    expect(qualityLabel(6)).toBe('神器');
  });

  it('labels 覆盖，缺位回退内置文案', () => {
    expect(qualityLabel(0, ['白', '绿'])).toBe('白');
    expect(qualityLabel(1, ['白', '绿'])).toBe('绿');
    expect(qualityLabel(5, ['白', '绿'])).toBe('远古');
  });

  it('越界夹取后取文案', () => {
    expect(qualityLabel(42)).toBe('神器');
    expect(qualityLabel(-1)).toBe('普通');
  });
});

describe('qualityColorTokenName', () => {
  it('7 档各自映射到不同 token 名', () => {
    const names = Array.from({ length: 7 }, (_, index) => qualityColorTokenName(index));
    expect(names).toEqual([...QUALITY_COLOR_TOKEN_NAMES]);
  });

  it('越界夹取', () => {
    expect(qualityColorTokenName(99)).toBe(QUALITY_COLOR_TOKEN_NAMES[6]);
    expect(qualityColorTokenName(Number.NaN)).toBe(QUALITY_COLOR_TOKEN_NAMES[0]);
  });
});
