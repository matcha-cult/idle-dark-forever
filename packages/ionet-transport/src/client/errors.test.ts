/**
 * 两级错误判定（硬契约）单测。
 *
 * 覆盖：
 * - ① `errorCode !== 0` → `TransportError`（400/404/500/429）；
 * - ② `errorCode === 0`（或缺失）但 `data.success === false` → `BusinessError`（业务码取 `data.data.code`）；
 * - ③ 其余 → 成功；
 * - 边界：`code` 缺失 / 空串 → `UNKNOWN`；`success` 非布尔；`data` 非对象。
 */
import { describe, expect, it } from 'vitest';
import {
  assertResponseOk,
  assertTransportOk,
  businessCodeOf,
  businessMessageOf,
  BusinessError,
  classifyResponse,
  isBusinessFailure,
  ProtocolError,
  TransportError,
  UNKNOWN_BUSINESS_CODE,
} from '../client/errors.js';

describe('classifyResponse —— 两级判定', () => {
  it('① errorCode 非 0 → transport 分支（TransportError，携带 errorCode）', () => {
    for (const errorCode of [400, 404, 429, 500]) {
      const verdict = classifyResponse({ errorCode, errorMessage: 'boom' });
      expect(verdict.ok).toBe(false);
      if (verdict.ok || verdict.kind !== 'transport') throw new Error('期望 transport 分支');
      expect(verdict.error).toBeInstanceOf(TransportError);
      expect(verdict.error.errorCode).toBe(errorCode);
      expect(verdict.error.message).toBe('boom');
    }
  });

  it('② errorCode === 0 且 data.success === false → business 分支（BusinessError）', () => {
    const verdict = classifyResponse({
      errorCode: 0,
      data: { success: false, message: '金币不足', data: { code: 'NOT_ENOUGH_GOLD' } },
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok || verdict.kind !== 'business') throw new Error('期望 business 分支');
    expect(verdict.error).toBeInstanceOf(BusinessError);
    expect(verdict.error.code).toBe('NOT_ENOUGH_GOLD');
    expect(verdict.error.message).toBe('金币不足');
    expect(verdict.error.serverMessage).toBe('金币不足');
  });

  it('② errorCode 缺失（undefined）同样进入 business 分支', () => {
    const verdict = classifyResponse({ data: { success: false, data: { code: 'INVENTORY_FULL' } } });
    expect(verdict.ok).toBe(false);
    if (verdict.ok || verdict.kind !== 'business') throw new Error('期望 business 分支');
    expect(verdict.error.code).toBe('INVENTORY_FULL');
  });

  it('② 业务码缺失 → UNKNOWN；空串同样 → UNKNOWN', () => {
    const missing = classifyResponse({ data: { success: false } });
    const empty = classifyResponse({ data: { success: false, data: { code: '' } } });
    if (missing.ok || missing.kind !== 'business') throw new Error('期望 business 分支');
    if (empty.ok || empty.kind !== 'business') throw new Error('期望 business 分支');
    expect(missing.error.code).toBe(UNKNOWN_BUSINESS_CODE);
    expect(empty.error.code).toBe(UNKNOWN_BUSINESS_CODE);
  });

  it('② 只判 errorCode 会把业务失败当成功 —— 显式反例', () => {
    const response = { errorCode: 0, data: { success: false, data: { code: 'NO_TICKET' } } };
    // 天真判定（只看 errorCode）会认为成功：
    expect(response.errorCode === 0).toBe(true);
    // 正确判定：
    expect(classifyResponse(response).ok).toBe(false);
  });

  it('③ success: true / 无 success / data 非对象 → 成功', () => {
    expect(classifyResponse({ data: { success: true, data: { hp: 1 } } }).ok).toBe(true);
    expect(classifyResponse({ data: { hp: 1 } }).ok).toBe(true);
    expect(classifyResponse({ data: null }).ok).toBe(true);
    expect(classifyResponse({ data: [1, 2, 3] }).ok).toBe(true);
    expect(classifyResponse({ data: 'raw' }).ok).toBe(true);
    expect(classifyResponse({}).ok).toBe(true);
    expect(classifyResponse({ errorCode: 0, data: { success: undefined } }).ok).toBe(true);
  });
});

describe('assertResponseOk / assertTransportOk', () => {
  it('assertResponseOk：传输层失败抛 TransportError', () => {
    expect(() => assertResponseOk({ errorCode: 500 })).toThrow(TransportError);
  });

  it('assertResponseOk：业务失败抛 BusinessError', () => {
    expect(() =>
      assertResponseOk({ errorCode: 0, data: { success: false, data: { code: 'ITEM_LOCKED' } } }),
    ).toThrow(BusinessError);
  });

  it('assertTransportOk：业务失败**不抛**（只判传输层）', () => {
    const response = { errorCode: 0, data: { success: false, data: { code: 'ITEM_LOCKED' } } };
    expect(assertTransportOk(response)).toBe(response);
    expect(() => assertTransportOk({ errorCode: 404 })).toThrow(TransportError);
  });

  it('成功响应原样返回', () => {
    const response = { errorCode: 0, data: { success: true, data: 1 } };
    expect(assertResponseOk(response)).toBe(response);
  });
});

describe('isBusinessFailure / businessCodeOf / businessMessageOf', () => {
  it('严格只认 success === false', () => {
    expect(isBusinessFailure({ success: false })).toBe(true);
    expect(isBusinessFailure({ success: true })).toBe(false);
    expect(isBusinessFailure({ success: undefined })).toBe(false);
    expect(isBusinessFailure(42)).toBe(false);
    expect(isBusinessFailure(null)).toBe(false);
    expect(isBusinessFailure(undefined)).toBe(false);
    expect(isBusinessFailure('false')).toBe(false);
  });

  it('businessCodeOf / businessMessageOf 的缺失与类型兜底', () => {
    expect(businessCodeOf({ data: { code: 'X' } })).toBe('X');
    expect(businessCodeOf({ data: { code: 123 } })).toBe(UNKNOWN_BUSINESS_CODE);
    expect(businessCodeOf({})).toBe(UNKNOWN_BUSINESS_CODE);
    expect(businessCodeOf(null)).toBe(UNKNOWN_BUSINESS_CODE);
    expect(businessMessageOf({ message: ' hi ' })).toBe(' hi ');
    expect(businessMessageOf({ message: '' })).toBeUndefined();
    expect(businessMessageOf({ message: 5 })).toBeUndefined();
    expect(businessMessageOf({})).toBeUndefined();
  });
});

describe('错误类型可判别性', () => {
  it('各错误类的 name / instanceof 稳定', () => {
    expect(new TransportError(500).name).toBe('TransportError');
    expect(new BusinessError('X').name).toBe('BusinessError');
    expect(new ProtocolError('bad').name).toBe('ProtocolError');
    expect(new BusinessError('X') instanceof BusinessError).toBe(true);
  });

  it('BusinessError 保留原始失败体供 UI 取上下文', () => {
    const body = { success: false as const, data: { code: 'NOT_ENOUGH_MATERIAL', detail: { key: 'iron' } } };
    const error = new BusinessError('NOT_ENOUGH_MATERIAL', undefined, undefined, body);
    expect(error.body).toBe(body);
    expect(error.serverMessage).toBeUndefined();
  });
});
