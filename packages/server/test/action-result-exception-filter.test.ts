import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

// ⚠️ 必须别名导入：本文件同时用了 vitest 的 `describe`（测试套件），直接用会把它当成被测函数。
import {
  classify,
  describe as describeException,
} from '../src/common/filters/action-result-exception.filter.js';

describe('ActionResultExceptionFilter.classify', () => {
  it('HttpException 400 → INVALID_PARAM', () => {
    expect(classify(new BadRequestException('坏参数'))).toEqual({ status: 400, code: 'INVALID_PARAM' });
  });

  it('HttpException 401 / 403 → UNAUTHORIZED（两者对客户端都是「没有有效身份」）', () => {
    expect(classify(new HttpException('unauthorized', 401))).toEqual({ status: 401, code: 'UNAUTHORIZED' });
    expect(classify(new ForbiddenException('forbidden'))).toEqual({ status: 403, code: 'UNAUTHORIZED' });
  });

  it('HttpException 404 → NOT_FOUND', () => {
    expect(classify(new NotFoundException('没有'))).toEqual({ status: 404, code: 'NOT_FOUND' });
  });

  it('HttpException 429 → RATE_LIMITED', () => {
    expect(classify(new HttpException('too many', 429))).toEqual({ status: 429, code: 'RATE_LIMITED' });
  });

  it('HttpException 5xx 与其他状态 → INTERNAL（保留原状态码）', () => {
    expect(classify(new HttpException('boom', 503))).toEqual({ status: 503, code: 'INTERNAL' });
    expect(classify(new HttpException('teapot', 418))).toEqual({ status: 418, code: 'INTERNAL' });
  });

  it('非 HttpException（如数据库 ECONNREFUSED）→ 500 + INTERNAL', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    expect(classify(error)).toEqual({ status: 500, code: 'INTERNAL' });
  });

  it('边界：非 Error 的抛出物（字符串 / null / undefined / 数字）一律 500 + INTERNAL', () => {
    for (const thrown of ['oops', null, undefined, 42, { weird: true }]) {
      expect(classify(thrown)).toEqual({ status: 500, code: 'INTERNAL' });
    }
  });

  it('边界：非法状态码（NaN / 0 / -1 / 999 / 非整数）被规整为 500', () => {
    for (const status of [Number.NaN, 0, -1, 999, 200.5]) {
      expect(classify(new HttpException('bad status', status)).status).toBe(500);
    }
  });
});

describe('ActionResultExceptionFilter.describe', () => {
  it('HttpException 的字符串响应直接回显', () => {
    expect(describeException(new HttpException('直接原因', 400))).toBe('直接原因');
  });

  it('HttpException 的对象响应取 message 字段', () => {
    expect(describeException(new BadRequestException('字段不合法'))).toContain('字段不合法');
  });

  it('Error 取 message', () => {
    expect(describeException(new Error('连接被拒绝'))).toBe('连接被拒绝');
  });

  it('边界：超长信息被截断到 300 字符（防日志/响应体被灌爆）', () => {
    const long = 'x'.repeat(5000);
    expect(describeException(new Error(long)).length).toBe(300);
    expect(describeException(new HttpException(long, 400)).length).toBe(300);
  });

  it('边界：非 Error 抛出物给出可读兜底，且不抛错', () => {
    expect(describeException(undefined)).toBe('未知错误');
    expect(describeException(null)).toBe('未知错误');
    expect(describeException({})).toBe('未知错误');
    expect(describeException('字符串抛出')).toBe('字符串抛出');
    expect(describeException(42)).toBe('未知错误');
  });

  it('不泄漏堆栈（describe 的返回值不含 "at " 栈帧）', () => {
    const error = new Error('boom');
    expect(describeException(error)).not.toContain('at ');
    expect(describeException(error)).not.toContain('.ts:');
  });
});
