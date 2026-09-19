/** `format/number.ts` 纯函数边界测试（NaN / Infinity / 负数 / 超大值 / 精度）。 */
import { describe, expect, it } from 'vitest';
import { formatAmount, formatCompact, formatPercent } from './number.js';

describe('formatAmount', () => {
  it('千分位整数', () => {
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(999)).toBe('999');
    expect(formatAmount(1000)).toBe('1,000');
    expect(formatAmount(1234567)).toBe('1,234,567');
  });

  it('负数保留符号且分组正确', () => {
    expect(formatAmount(-1234567)).toBe('-1,234,567');
    expect(formatAmount(-1)).toBe('-1');
  });

  it('小数截断（资源只显示整数）', () => {
    expect(formatAmount(12.9)).toBe('12');
    expect(formatAmount(0.99)).toBe('0');
    expect(formatAmount(-0.5)).toBe('0');
  });

  it('NaN / Infinity / undefined 一律 0', () => {
    expect(formatAmount(Number.NaN)).toBe('0');
    expect(formatAmount(Number.POSITIVE_INFINITY)).toBe('0');
    expect(formatAmount(Number.NEGATIVE_INFINITY)).toBe('0');
    expect(formatAmount(undefined as unknown as number)).toBe('0');
    expect(formatAmount(null as unknown as number)).toBe('0');
  });

  it('超大值不丢精度（在 Number 安全范围内）', () => {
    expect(formatAmount(Number.MAX_SAFE_INTEGER)).toBe('9,007,199,254,740,991');
  });
});

describe('formatPercent', () => {
  it('保留 1 位小数并去掉多余的 .0', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(33.333)).toBe('33.3%');
    expect(formatPercent(50.05)).toBe('50.1%');
  });

  it('非法值 0%', () => {
    expect(formatPercent(Number.NaN)).toBe('0%');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('0%');
  });
});

describe('formatCompact', () => {
  it('万 / 亿 分档', () => {
    expect(formatCompact(9999)).toBe('9,999');
    expect(formatCompact(10000)).toBe('1.0万');
    expect(formatCompact(123456)).toBe('12.3万');
    expect(formatCompact(1e8)).toBe('1.0亿');
    expect(formatCompact(-1e8)).toBe('-1.0亿');
  });

  it('非法值 0', () => {
    expect(formatCompact(Number.NaN)).toBe('0');
    expect(formatCompact(undefined as unknown as number)).toBe('0');
  });
});
