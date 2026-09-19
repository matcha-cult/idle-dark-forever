/**
 * 滑动窗口限流器（内存实现，自建）
 *
 * 为什么自建而不用框架的 `RateLimitInOut`（已实证的框架约束）：
 *   `RateLimitInOut.fuckIn` 触发限流时只做 `ctx.setErrorCode(429)` + `setErrorMessage(...)`，
 *   而 `BarSkeleton.execute` 在 `inOutChain.fuckInAll(ctx)` 之后**不读** `ctx.errorCode`，
 *   直接进入 `invokeAction` —— 也就是说「超限」不会短路，Action 照常执行、返回 success。
 *   因此真正可用的限流必须由应用侧自建，并以**返回 `fail(RATE_LIMITED)`**（或抛错）的方式短路。
 *
 * 语义边界（fail-closed 优先）：
 * - `limit === Infinity`            → 恒放行（显式不限流）
 * - `limit` 为 NaN / <= 0 / 非数字  → 恒拒绝（0 = 禁用该操作；NaN = 配置错误 → 拒绝而非放行）
 * - `limit` 为有限正数              → 向下取整后作为窗口内上限
 * - `windowMs` 非有限 / <= 0        → 窗口长度按 0 处理，等价于「不限流」（只记录戳）
 *
 * 无状态依赖、无构造参数（因此不存在「普通对象构造参数缺少 DI token」的 Nest 解析问题）。
 */
import { Injectable } from '@nestjs/common';
import { BusinessErrorCode, businessErrorMessage, type ActionFail, fail } from '@idle-dark/protocol';

export const RATE_LIMIT_DEFAULT_WINDOW_MS = 60_000;

export interface RateLimitDecision {
  allowed: boolean;
  /** 本窗口内剩余可用次数（`Infinity` 表示不限流）。 */
  remaining: number;
  /** 被拒时距最早一次调用滑出窗口的毫秒数（>= 0）。 */
  retryAfterMs: number;
}

@Injectable()
export class RateLimiterService {
  /** `key → 窗口内调用时间戳（ms，升序）`。 */
  private readonly buckets = new Map<string, number[]>();

  /** 可替换时钟（单测注入固定时间用）；生产保持 `Date.now`。 */
  now: () => number = Date.now;

  /**
   * 判定并记账一次调用。
   *
   * @param key 限流键（如 `craft:${userId}`）；同键共享额度
   * @param limit 窗口内上限
   * @param windowMs 窗口长度，默认 60s
   */
  check(key: string | number, limit: number, windowMs: number = RATE_LIMIT_DEFAULT_WINDOW_MS): RateLimitDecision {
    const allowedLimit = normalizeLimit(limit);
    if (allowedLimit === Number.POSITIVE_INFINITY) {
      return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterMs: 0 };
    }

    const window = Number.isFinite(windowMs) && windowMs > 0 ? Math.floor(windowMs) : 0;
    const at = this.now();
    const bucketKey = String(key);
    const fresh = (this.buckets.get(bucketKey) ?? []).filter((stamp) => at - stamp < window);

    if (allowedLimit === 0 || fresh.length >= allowedLimit) {
      this.buckets.set(bucketKey, fresh);
      const oldest = fresh[0];
      const retryAfterMs =
        window > 0 && oldest !== undefined ? Math.max(0, window - (at - oldest)) : window;
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    fresh.push(at);
    this.buckets.set(bucketKey, fresh);
    return { allowed: true, remaining: allowedLimit - fresh.length, retryAfterMs: 0 };
  }

  /** 便捷布尔判定（命中即记账）。 */
  allow(key: string | number, limit: number, windowMs: number = RATE_LIMIT_DEFAULT_WINDOW_MS): boolean {
    return this.check(key, limit, windowMs).allowed;
  }

  /**
   * Action 用的限流闸：超限返回 `fail(RATE_LIMITED)`，放行返回 null。
   *
   * 用法：`const limited = this.rateLimiter.consumeOrFail(key, limit); if (limited) return limited;`
   */
  consumeOrFail(
    key: string | number,
    limit: number,
    windowMs: number = RATE_LIMIT_DEFAULT_WINDOW_MS,
  ): ActionFail | null {
    const decision = this.check(key, limit, windowMs);
    if (decision.allowed) return null;
    return fail(
      BusinessErrorCode.RATE_LIMITED,
      businessErrorMessage(BusinessErrorCode.RATE_LIMITED),
    );
  }

  /** 清空全部（`key` 省略）或某个键的窗口。 */
  reset(key?: string | number): void {
    if (key === undefined) {
      this.buckets.clear();
      return;
    }
    this.buckets.delete(String(key));
  }

  /** 清理已滑出窗口的键（防内存无界增长）。返回清理的键数量。 */
  sweep(windowMs: number = RATE_LIMIT_DEFAULT_WINDOW_MS): number {
    const window = Number.isFinite(windowMs) && windowMs > 0 ? Math.floor(windowMs) : 0;
    const at = this.now();
    let removed = 0;
    for (const [key, stamps] of [...this.buckets]) {
      const fresh = stamps.filter((stamp) => at - stamp < window);
      if (fresh.length === 0) {
        this.buckets.delete(key);
        removed++;
      } else {
        this.buckets.set(key, fresh);
      }
    }
    return removed;
  }

  /** 当前追踪的键数量（运维 / 测试可见）。 */
  get size(): number {
    return this.buckets.size;
  }
}

function normalizeLimit(limit: number): number {
  if (limit === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.floor(limit);
}
