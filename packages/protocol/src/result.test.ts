import { describe, expect, it } from 'vitest';

import { BusinessErrorCode, BUSINESS_ERROR_MESSAGE, businessErrorMessage } from './error-codes.js';
import { businessCodeOf, fail, isOk, ok } from './result.js';

describe('ActionResult 构造', () => {
  it('ok() 产出 success:true 且携带 data', () => {
    const result = ok({ gold: 10 });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ gold: 10 });
    expect(isOk(result)).toBe(true);
  });

  it('ok() 在无 message 时不写入 message 键（保持线路精简）', () => {
    expect(Object.keys(ok(1))).toEqual(['success', 'data']);
    expect(Object.keys(ok(1, '好的'))).toEqual(['success', 'message', 'data']);
  });

  it('fail() 产出 success:false 且 code 在 data.code', () => {
    const result = fail(BusinessErrorCode.INVENTORY_FULL, '包裹满了');
    expect(result.success).toBe(false);
    expect(result.data.code).toBe('INVENTORY_FULL');
    expect(result.message).toBe('包裹满了');
    expect(businessCodeOf(result)).toBe('INVENTORY_FULL');
  });

  it('fail() 无 detail 时不写入 detail 键', () => {
    expect(Object.keys(fail('X').data)).toEqual(['code']);
    expect(Object.keys(fail('X', undefined, { need: 3 }).data)).toEqual(['code', 'detail']);
  });

  it('fail() 的 detail 可携带补充信息', () => {
    const result = fail(BusinessErrorCode.NOT_ENOUGH_MATERIAL, undefined, { need: ['dust1', 3] });
    expect(result.data.detail).toEqual({ need: ['dust1', 3] });
  });

  it('isOk() 对失败结果为 false', () => {
    expect(isOk(fail('X'))).toBe(false);
  });
});

describe('业务错误码表', () => {
  it('每个错误码都有中文兜底文案（新增码必须同步补文案）', () => {
    for (const code of Object.values(BusinessErrorCode)) {
      expect(BUSINESS_ERROR_MESSAGE[code], `缺少 ${code} 的文案`).toBeTruthy();
    }
  });

  it('错误码取值与键名一致（防止复制粘贴写错）', () => {
    for (const [key, value] of Object.entries(BusinessErrorCode)) {
      expect(value).toBe(key);
    }
  });

  it('businessErrorMessage 对未知码返回通用兜底而非 undefined', () => {
    expect(businessErrorMessage('NOT_EXIST_CODE')).toBe('操作失败');
    expect(businessErrorMessage('')).toBe('操作失败');
  });

  it('businessErrorMessage 对已知码返回对应文案', () => {
    expect(businessErrorMessage(BusinessErrorCode.UNAUTHORIZED)).toBe('登录已失效，请重新登录');
  });
});
