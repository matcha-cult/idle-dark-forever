import { describe, expect, it } from 'vitest';
import {
  MAX_SAFE_BIGINT,
  MIN_SAFE_BIGINT,
  bigintToSafeNumber,
} from '../src/common/utils/safe-bigint.js';

describe('bigintToSafeNumber', () => {
  it('接受 pg 返回的十进制字符串', () => {
    expect(bigintToSafeNumber('42', 'x')).toBe(42);
    expect(bigintToSafeNumber(' 42 ', 'x')).toBe(42);
    expect(bigintToSafeNumber('-7', 'x')).toBe(-7);
    expect(bigintToSafeNumber('0', 'x')).toBe(0);
  });

  it('接受 number 与 bigint', () => {
    expect(bigintToSafeNumber(42, 'x')).toBe(42);
    // -0 与 +0 数值等价（Object.is 会区分，这里按数值断言）
    expect(bigintToSafeNumber(-0, 'x') === 0).toBe(true);
    expect(bigintToSafeNumber(42n, 'x')).toBe(42);
    expect(bigintToSafeNumber(0n, 'x')).toBe(0);
  });

  it('null / undefined 按 0 处理（LEFT JOIN 未命中）', () => {
    expect(bigintToSafeNumber(null, 'x')).toBe(0);
    expect(bigintToSafeNumber(undefined, 'x')).toBe(0);
  });

  it('安全边界：±(2^53-1) 精确，超出即抛 RangeError', () => {
    expect(bigintToSafeNumber(MAX_SAFE_BIGINT, 'x')).toBe(Number.MAX_SAFE_INTEGER);
    expect(bigintToSafeNumber(MIN_SAFE_BIGINT, 'x')).toBe(Number.MIN_SAFE_INTEGER);
    expect(() => bigintToSafeNumber(MAX_SAFE_BIGINT + 1n, 'x')).toThrow(RangeError);
    expect(() => bigintToSafeNumber(MIN_SAFE_BIGINT - 1n, 'x')).toThrow(RangeError);
  });

  it('number 输入超出安全整数范围 → RangeError（含超大值）', () => {
    expect(() => bigintToSafeNumber(Number.MAX_SAFE_INTEGER + 1, 'x')).toThrow(RangeError);
    expect(() => bigintToSafeNumber(Number.MAX_SAFE_INTEGER * 10, 'x')).toThrow(RangeError);
    expect(() => bigintToSafeNumber(Infinity, 'x')).toThrow(RangeError);
    expect(() => bigintToSafeNumber(Number.NaN, 'x')).toThrow(RangeError);
    expect(() => bigintToSafeNumber(1.5, 'x')).toThrow(RangeError);
  });

  it('非十进制字符串 → RangeError', () => {
    expect(() => bigintToSafeNumber('', 'x')).toThrow(RangeError);
    expect(() => bigintToSafeNumber('12.5', 'x')).toThrow(RangeError);
    expect(() => bigintToSafeNumber('1e3', 'x')).toThrow(RangeError);
    expect(() => bigintToSafeNumber('abc', 'x')).toThrow(RangeError);
    expect(() => bigintToSafeNumber('0x10', 'x')).toThrow(RangeError);
    expect(() => bigintToSafeNumber('  ', 'x')).toThrow(RangeError);
  });

  it('不支持的类型 → RangeError（错误信息带字段名）', () => {
    expect(() => bigintToSafeNumber({} as never, 'characters.user_id')).toThrow(RangeError);
    expect(() => bigintToSafeNumber(true as never, 'characters.user_id')).toThrow(
      /characters\.user_id/,
    );
  });

  it('错误信息带字段名，便于定位精度债', () => {
    expect(() => bigintToSafeNumber('99999999999999999999', 'characters.user_id')).toThrow(
      /characters\.user_id/,
    );
  });
});
