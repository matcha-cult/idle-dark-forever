import { describe, expect, it, beforeEach } from 'vitest';

import {
  DEFAULT_OP_TTL_MS,
  MAX_OP_ID_LENGTH,
  OpIdempotencyService,
} from '../src/modules/game/op-idempotency.service.js';

describe('OpIdempotencyService', () => {
  let svc: OpIdempotencyService;
  let clock: number;
  const USER = 42;

  beforeEach(() => {
    svc = new OpIdempotencyService();
    clock = 1_000_000;
    svc.now = () => clock;
  });

  describe('首次占用', () => {
    it('合法 opId 首次 begin → fresh + deduped', () => {
      const r = svc.begin(USER, 'op-1');
      expect(r).toEqual({ kind: 'fresh', deduped: true });
      expect(svc.size).toBe(1);
    });

    it('in-flight 期间重复 begin → duplicate 且 inFlight=true（挡住并发双击）', () => {
      svc.begin(USER, 'op-1');
      const r = svc.begin(USER, 'op-1');
      expect(r).toEqual({ kind: 'duplicate', inFlight: true });
    });
  });

  describe('结果回放', () => {
    it('settle 后重复 begin → duplicate 并回放结果', () => {
      svc.begin(USER, 'op-1');
      svc.settle(USER, 'op-1', { gold: 7 });
      const r = svc.begin(USER, 'op-1');
      expect(r).toEqual({ kind: 'duplicate', inFlight: false, result: { gold: 7 } });
    });

    it('settle 一个不存在的 opId 返回 false', () => {
      expect(svc.settle(USER, 'never-begun', 1)).toBe(false);
    });

    it('settle 过期条目返回 false（不允许复活）', () => {
      svc.begin(USER, 'op-1');
      clock += DEFAULT_OP_TTL_MS + 1;
      expect(svc.settle(USER, 'op-1', 1)).toBe(false);
    });

    it('settle 的结果允许为 undefined（用 inFlight 区分执行中与已完成）', () => {
      svc.begin(USER, 'op-1');
      svc.settle(USER, 'op-1', undefined);
      expect(svc.begin(USER, 'op-1')).toEqual({ kind: 'duplicate', inFlight: false });
    });
  });

  describe('abort（失败释放）', () => {
    it('abort 后可再次 begin 为 fresh（允许客户端重试）', () => {
      svc.begin(USER, 'op-1');
      expect(svc.abort(USER, 'op-1')).toBe(true);
      expect(svc.begin(USER, 'op-1')).toEqual({ kind: 'fresh', deduped: true });
    });

    it('abort 不存在的 opId 是 no-op（不抛错）', () => {
      expect(svc.abort(USER, 'nope')).toBe(false);
    });
  });

  describe('边界：非法 / 缺失 opId（fail-closed）', () => {
    it('opId 为 undefined / null / 空串 / 纯空白 → 不去重（兼容旧客户端，由限流兜底）', () => {
      for (const opId of [undefined, null, '', '   ', '\t\n']) {
        expect(svc.begin(USER, opId)).toEqual({ kind: 'fresh', deduped: false });
      }
      expect(svc.size).toBe(0);
    });

    it('opId 超长 → invalid（拒绝执行，不静默放行）', () => {
      const tooLong = 'x'.repeat(MAX_OP_ID_LENGTH + 1);
      const r = svc.begin(USER, tooLong);
      expect(r.kind).toBe('invalid');
      expect(svc.size).toBe(0);
    });

    it('opId 恰好等于上限 → 合法', () => {
      expect(svc.begin(USER, 'x'.repeat(MAX_OP_ID_LENGTH))).toEqual({ kind: 'fresh', deduped: true });
    });

    it('opId 两端空白会被 trim（" op-1 " 与 "op-1" 视为同一操作）', () => {
      svc.begin(USER, 'op-1');
      expect(svc.begin(USER, '  op-1  ')).toEqual({ kind: 'duplicate', inFlight: true });
    });
  });

  describe('键空间隔离', () => {
    it('同一 opId 在不同 userId 下互不影响', () => {
      svc.begin(1, 'op-1');
      expect(svc.begin(2, 'op-1')).toEqual({ kind: 'fresh', deduped: true });
    });

    it('不会因拼接歧义撞键（userId=1 + opId="2:x" vs userId=12 + opId=":x"）', () => {
      svc.begin(1, '2:x');
      expect(svc.begin(12, ':x')).toEqual({ kind: 'fresh', deduped: true });
    });

    it('userId 支持 string（与 preset-logic 的 UserId 归一化一致）', () => {
      svc.begin('u-1', 'op-1');
      expect(svc.begin('u-1', 'op-1')).toEqual({ kind: 'duplicate', inFlight: true });
    });
  });

  describe('TTL 与清理', () => {
    it('过期后同一 opId 可重新占用', () => {
      svc.begin(USER, 'op-1');
      clock += DEFAULT_OP_TTL_MS + 1;
      expect(svc.begin(USER, 'op-1')).toEqual({ kind: 'fresh', deduped: true });
    });

    it('ttlMs 为 0 / 负数 / NaN → 回落默认 TTL（不产生立即过期的条目）', () => {
      for (const ttl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const s = new OpIdempotencyService();
        s.now = () => clock;
        s.begin(USER, `op-${String(ttl)}`, ttl);
        expect(s.begin(USER, `op-${String(ttl)}`), `ttl=${String(ttl)}`).toEqual({
          kind: 'duplicate',
          inFlight: true,
        });
      }
    });

    it('自定义 ttl 生效', () => {
      svc.begin(USER, 'op-1', 10);
      clock += 11;
      expect(svc.begin(USER, 'op-1')).toEqual({ kind: 'fresh', deduped: true });
    });

    it('sweep 只清过期条目并返回数量', () => {
      svc.begin(1, 'a', 10);
      svc.begin(2, 'b', 10_000);
      clock += 11;
      expect(svc.sweep()).toBe(1);
      expect(svc.size).toBe(1);
    });

    it('sweep 在无过期条目时返回 0', () => {
      svc.begin(1, 'a');
      expect(svc.sweep()).toBe(0);
    });

    it('clear 清空全部', () => {
      svc.begin(1, 'a');
      svc.begin(2, 'b');
      svc.clear();
      expect(svc.size).toBe(0);
    });
  });
});
