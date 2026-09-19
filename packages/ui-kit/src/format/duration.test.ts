/** `format/duration.ts` 纯函数边界测试。 */
import { describe, expect, it } from 'vitest';
import { formatDuration, formatDurationCn } from './duration.js';

describe('formatDuration', () => {
  it('分:秒，补零', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(5_000)).toBe('00:05');
    expect(formatDuration(59_000)).toBe('00:59');
    expect(formatDuration(60_000)).toBe('01:00');
    expect(formatDuration(3_599_000)).toBe('59:59');
  });

  it('超过 1 小时补小时段', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_661_000)).toBe('1:01:01');
  });

  it('负数 / NaN / Infinity / undefined 归零', () => {
    expect(formatDuration(-1)).toBe('00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('00:00');
    expect(formatDuration(undefined as unknown as number)).toBe('00:00');
  });

  it('向下取整（毫秒不满 1 秒不计）', () => {
    expect(formatDuration(1_999)).toBe('00:01');
  });
});

describe('formatDurationCn', () => {
  it('秒 / 分钟 / 小时', () => {
    expect(formatDurationCn(0)).toBe('0 秒');
    expect(formatDurationCn(59_999)).toBe('59 秒');
    expect(formatDurationCn(60_000)).toBe('1 分钟');
    expect(formatDurationCn(3_600_000)).toBe('1 小时');
    expect(formatDurationCn(3_900_000)).toBe('1 小时 5 分钟');
  });

  it('非法值 0 秒', () => {
    expect(formatDurationCn(Number.NaN)).toBe('0 秒');
    expect(formatDurationCn(-100)).toBe('0 秒');
  });
});
