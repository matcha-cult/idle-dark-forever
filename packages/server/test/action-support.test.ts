import { describe, expect, it } from 'vitest';
import { FlowContext } from '@nbb-ionet/core-framework';
import { BusinessErrorCode } from '@idle-dark/protocol';
import {
  ActionError,
  dataOf,
  requireUserId,
  toBoolean,
  toFiniteInt,
  toFiniteNumber,
  toNonEmptyString,
  userIdOf,
} from '../src/common/kernel/action-support.js';

function authed(userId: bigint): FlowContext {
  const ctx = new FlowContext();
  ctx.bindingUserId(userId);
  return ctx;
}

describe('userIdOf / requireUserId（鉴权分支）', () => {
  it('未绑定（0n）→ userIdOf 返回 null，requireUserId 返回 UNAUTHORIZED 失败结果', () => {
    const ctx = new FlowContext();
    expect(userIdOf(ctx)).toBeNull();

    const result = requireUserId(ctx);
    expect(typeof result).not.toBe('number');
    expect(result.success).toBe(false);
    expect(result.data.code).toBe(BusinessErrorCode.UNAUTHORIZED);
    expect(result.message).toBeTruthy();
  });

  it('已绑定 → 返回安全整数 userId', () => {
    expect(userIdOf(authed(1n))).toBe(1);
    expect(userIdOf(authed(9_007_199_254_740_991n))).toBe(Number.MAX_SAFE_INTEGER);
    expect(requireUserId(authed(42n))).toBe(42);
  });

  it('超出安全整数范围的 bigint → null（不静默丢精度）', () => {
    expect(userIdOf(authed(9_007_199_254_740_992n))).toBeNull();
    expect(userIdOf(authed(-1n))).toBeNull();
  });

  it('返回值联合类型强制调用点分支（typeof 判定可用）', () => {
    const result = requireUserId(authed(7n));
    if (typeof result !== 'number') throw new Error('应为 number');
    expect(result).toBe(7);
  });
});

describe('dataOf（data 参数提取）', () => {
  it('普通对象原样返回', () => {
    expect(dataOf({ a: 1 })).toEqual({ a: 1 });
  });

  it('null / undefined / 标量 / 数组 → 空对象', () => {
    expect(dataOf(null)).toEqual({});
    expect(dataOf(undefined)).toEqual({});
    expect(dataOf(0)).toEqual({});
    expect(dataOf('')).toEqual({});
    expect(dataOf(false)).toEqual({});
    expect(dataOf([])).toEqual({});
    expect(dataOf([1, 2])).toEqual({});
  });

  it('不修改原对象（返回同一引用即可，但读取不抛错）', () => {
    const source = { nested: { deep: true } };
    expect(dataOf(source)).toBe(source);
  });
});

describe('ActionError（协议错误码收口）', () => {
  it('unauthorized', () => {
    const result = ActionError.unauthorized();
    expect(result.success).toBe(false);
    expect(result.data.code).toBe(BusinessErrorCode.UNAUTHORIZED);
    expect(result.message).toBe('登录已失效，请重新登录');
  });

  it('invalidParam 默认文案与自定义文案', () => {
    expect(ActionError.invalidParam().data.code).toBe(BusinessErrorCode.INVALID_PARAM);
    expect(ActionError.invalidParam().message).toBe('参数不合法');
    expect(ActionError.invalidParam('缺少角色名').message).toBe('缺少角色名');
  });

  it('notFound 默认落 PLAYER_NOT_FOUND，可显式覆盖领域码', () => {
    expect(ActionError.notFound().data.code).toBe(BusinessErrorCode.PLAYER_NOT_FOUND);
    expect(ActionError.notFound('物品不存在', BusinessErrorCode.ITEM_NOT_FOUND).data.code).toBe(
      BusinessErrorCode.ITEM_NOT_FOUND,
    );
    expect(ActionError.notFound('物品不存在', BusinessErrorCode.ITEM_NOT_FOUND).message).toBe(
      '物品不存在',
    );
  });

  it('internal', () => {
    const result = ActionError.internal();
    expect(result.data.code).toBe(BusinessErrorCode.INTERNAL);
    expect(result.message).toBeTruthy();
  });
});

describe('参数提取辅助（防御式，覆盖边界）', () => {
  it('toNonEmptyString', () => {
    expect(toNonEmptyString('  hi ')).toBe('hi');
    expect(toNonEmptyString('')).toBeUndefined();
    expect(toNonEmptyString('   ')).toBeUndefined();
    expect(toNonEmptyString(123)).toBeUndefined();
    expect(toNonEmptyString(null)).toBeUndefined();
  });

  it('toFiniteNumber（NaN / Infinity / 空串 / 非数字 → undefined）', () => {
    expect(toFiniteNumber('12.5')).toBe(12.5);
    expect(toFiniteNumber(12.5)).toBe(12.5);
    expect(toFiniteNumber('  ')).toBeUndefined();
    expect(toFiniteNumber('')).toBeUndefined();
    expect(toFiniteNumber('abc')).toBeUndefined();
    expect(toFiniteNumber(Number.NaN)).toBeUndefined();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(toFiniteNumber(null)).toBeUndefined();
    expect(toFiniteNumber(true)).toBeUndefined();
    expect(toFiniteNumber(1e308 * 10)).toBeUndefined();
  });

  it('toFiniteInt 向下取整', () => {
    expect(toFiniteInt('12.9')).toBe(12);
    expect(toFiniteInt(-12.1)).toBe(-13);
    expect(toFiniteInt('0')).toBe(0);
    expect(toFiniteInt('abc')).toBeUndefined();
    expect(toFiniteInt(undefined)).toBeUndefined();
  });

  it('toBoolean 只接受真 boolean（"false" 不当真）', () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean('false')).toBeUndefined();
    expect(toBoolean('')).toBeUndefined();
    expect(toBoolean(0)).toBeUndefined();
    expect(toBoolean(null)).toBeUndefined();
  });
});
