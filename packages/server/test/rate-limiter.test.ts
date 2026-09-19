import { beforeEach, describe, expect, it } from 'vitest';
import { BusinessErrorCode } from '@idle-dark/protocol';
import {
  RATE_LIMIT_DEFAULT_WINDOW_MS,
  RateLimiterService,
} from '../src/common/services/rate-limiter.service.js';

describe('RateLimiterService', () => {
  let limiter: RateLimiterService;
  let now: number;

  beforeEach(() => {
    limiter = new RateLimiterService();
    now = 1_000_000;
    limiter.now = () => now;
  });

  it('窗口内放行到上限，之后拒绝并给出 retryAfterMs', () => {
    for (let i = 0; i < 3; i++) {
      const decision = limiter.check('k', 3);
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(2 - i);
    }
    const denied = limiter.check('k', 3);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBe(RATE_LIMIT_DEFAULT_WINDOW_MS);
    // 被拒的调用不应占用额度
    now += RATE_LIMIT_DEFAULT_WINDOW_MS;
    expect(limiter.check('k', 3).allowed).toBe(true);
  });

  it('窗口滑动后额度恢复（拨快时钟到窗口边界）', () => {
    expect(limiter.check('k', 1).allowed).toBe(true);
    expect(limiter.check('k', 1).allowed).toBe(false);
    now += RATE_LIMIT_DEFAULT_WINDOW_MS - 1;
    expect(limiter.check('k', 1).allowed).toBe(false);
    now += 1;
    expect(limiter.check('k', 1).allowed).toBe(true);
  });

  it('retryAfterMs 随窗口推进递减，永不为负', () => {
    limiter.check('k', 1, 1_000);
    now += 400;
    const denied = limiter.check('k', 1, 1_000);
    expect(denied.retryAfterMs).toBe(600);
    now += 10_000;
    const again = limiter.check('k', 1, 1_000);
    expect(again.allowed).toBe(true);
  });

  it('不同 key 额度互不影响', () => {
    expect(limiter.check('a', 1).allowed).toBe(true);
    expect(limiter.check('a', 1).allowed).toBe(false);
    expect(limiter.check('b', 1).allowed).toBe(true);
    expect(limiter.check(7, 1).allowed).toBe(true);
    expect(limiter.check('7', 1).allowed).toBe(false); // number / string 同键
  });

  it('边界：limit=0 / 负数 / NaN → 恒拒绝（fail-closed）', () => {
    for (const limit of [0, -1, -1e9, Number.NaN]) {
      const decision = limiter.check('k', limit);
      expect(decision.allowed).toBe(false);
      expect(decision.remaining).toBe(0);
    }
  });

  it('边界：limit=Infinity → 恒放行（显式不限流）', () => {
    for (let i = 0; i < 100; i++) {
      expect(limiter.check('k', Number.POSITIVE_INFINITY).allowed).toBe(true);
    }
    expect(limiter.check('k', Number.POSITIVE_INFINITY).remaining).toBe(Number.POSITIVE_INFINITY);
  });

  it('边界：超大 limit（1e9）在安全整数内按次放行', () => {
    const decision = limiter.check('k', 1e9);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(1e9 - 1);
  });

  it('边界：limit 小数向下取整', () => {
    expect(limiter.check('k', 1.9).allowed).toBe(true);
    expect(limiter.check('k', 1.9).allowed).toBe(false);
  });

  it('边界：windowMs=0 / 负数 / NaN → 等价不限流', () => {
    for (const window of [0, -1, Number.NaN]) {
      for (let i = 0; i < 5; i++) {
        expect(limiter.check(`w${String(window)}`, 1, window).allowed).toBe(true);
      }
    }
  });

  it('allow() 是 check().allowed 的便捷形态', () => {
    expect(limiter.allow('k', 1)).toBe(true);
    expect(limiter.allow('k', 1)).toBe(false);
  });

  it('consumeOrFail：放行返回 null，超限返回 fail(RATE_LIMITED)', () => {
    expect(limiter.consumeOrFail('k', 1)).toBeNull();
    const limited = limiter.consumeOrFail('k', 1);
    expect(limited).not.toBeNull();
    expect(limited?.success).toBe(false);
    expect(limited?.data.code).toBe(BusinessErrorCode.RATE_LIMITED);
    expect(limited?.message).toBeTruthy();
  });

  it('reset / sweep / size', () => {
    limiter.check('a', 1);
    limiter.check('b', 1);
    expect(limiter.size).toBe(2);
    limiter.reset('a');
    expect(limiter.size).toBe(1);
    limiter.reset();
    expect(limiter.size).toBe(0);

    limiter.check('c', 1, 100);
    now += 101;
    expect(limiter.sweep(100)).toBe(1);
    expect(limiter.size).toBe(0);
  });
});
