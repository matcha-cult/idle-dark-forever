/**
 * 操作幂等（`opId` 去重）—— 消耗类操作的**重放防线**。
 *
 * 为什么必须有：前端每次点击都会发一个消耗类请求（分解 / 附魔 / 重铸 / 开包 / 兑换 / 购买）。
 * 网络重试、用户双击、断线重连后的重发都会造成**同一操作被执行两次**，
 * 在服务端权威模型下这就是「凭空多扣一次材料 / 多给一件装备」。
 *
 * 语义（**fail-closed 优先**）：
 * - `opId` 缺失 / 空白            → **不去重**（`deduped:false`），由限流兜底；
 *   这是为了兼容不带 `opId` 的旧客户端，而不是「允许重复扣费」。
 * - `opId` 超长 / 非字符串        → `kind:'invalid'`，调用方应返回 `INVALID_PARAM`（拒绝，不执行）；
 *   宁可让客户端重发一个合法 id，也不要在服务端权威模型下放过一次不受控的消耗。
 * - 首次 `begin`                  → `kind:'fresh'`（进入 in-flight），调用方必须**执行后**调 `settle`。
 * - 执行失败                      → 调用方必须调 `abort` 释放，否则客户端永远无法重试。
 * - 重复 `begin`（done）          → `kind:'duplicate'` 并**回放**上次结果（客户端重试得到同一答案）。
 * - 重复 `begin`（in-flight）     → `kind:'duplicate'` 且 `inFlight:true`（并发双击被挡住）。
 *
 * 存活期：条目在 `ttlMs` 后过期（默认 2 分钟，足够覆盖任何网络重试窗口），
 * 过期条目在 `begin`/`sweep` 时惰性清理，`sweep()` 供定时任务调用防内存无界增长。
 *
 * 本类**不使用 Nest 装饰器**：它是纯内存算法，通过 `GameModule` 的显式 token 工厂提供，
 * 既可被 Nest 注入，也可在单测里直接 `new`。
 */

/** `opId` 允许的最大长度（超出视为非法，fail-closed）。 */
export const MAX_OP_ID_LENGTH = 128;

/** 条目默认存活期（毫秒）。 */
export const DEFAULT_OP_TTL_MS = 120_000;

export type IdempotencyBegin =
  | { kind: 'fresh'; deduped: true }
  | { kind: 'fresh'; deduped: false }
  | { kind: 'duplicate'; inFlight: boolean; result?: unknown }
  | { kind: 'invalid'; reason: string };

interface Entry {
  expiresAt: number;
  /** `undefined` 表示仍在执行中（in-flight）。 */
  result?: unknown;
  done: boolean;
}

export class OpIdempotencyService {
  private readonly entries = new Map<string, Entry>();

  /** 可替换时钟（单测注入固定时间用）；生产保持 `Date.now`。 */
  now: () => number = Date.now;

  /**
   * 尝试占用一个操作位。
   *
   * 用法：
   * ```ts
   * const claim = this.opIds.begin(userId, data.opId);
   * if (claim.kind === 'invalid') return fail(BusinessErrorCode.INVALID_PARAM, claim.reason);
   * if (claim.kind === 'duplicate') {
   *   if (claim.inFlight) return fail(BusinessErrorCode.DUPLICATE_OPERATION, '操作正在处理中');
   *   return ok(claim.result as DecomposeResultDto); // 回放上次结果
   * }
   * try {
   *   const result = await doWork();
   *   this.opIds.settle(userId, data.opId, result);
   *   return ok(result);
   * } catch (e) {
   *   this.opIds.abort(userId, data.opId);   // 失败必须释放，否则无法重试
   *   throw e;
   * }
   * ```
   */
  begin(userId: number | string, opId: string | undefined | null, ttlMs: number = DEFAULT_OP_TTL_MS): IdempotencyBegin {
    const normalized = normalizeOpId(opId);
    if (normalized.kind === 'absent') return { kind: 'fresh', deduped: false };
    if (normalized.kind === 'invalid') return { kind: 'invalid', reason: normalized.reason };

    const key = this.keyOf(userId, normalized.value);
    const at = this.now();
    const existing = this.entries.get(key);

    if (existing !== undefined) {
      if (existing.expiresAt > at) {
        if (!existing.done) return { kind: 'duplicate', inFlight: true };
        return existing.result === undefined
          ? { kind: 'duplicate', inFlight: false }
          : { kind: 'duplicate', inFlight: false, result: existing.result };
      }
      this.entries.delete(key); // 已过期 → 视为新操作
    }

    this.entries.set(key, { expiresAt: at + effectiveTtl(ttlMs), done: false });
    return { kind: 'fresh', deduped: true };
  }

  /** 记录成功结果（供重复请求回放）。仅在条目存在且未过期时生效。 */
  settle(userId: number | string, opId: string, result: unknown): boolean {
    const normalized = normalizeOpId(opId);
    if (normalized.kind !== 'ok') return false;
    const key = this.keyOf(userId, normalized.value);
    const entry = this.entries.get(key);
    if (entry === undefined || entry.expiresAt <= this.now()) return false;
    entry.done = true;
    entry.result = result;
    return true;
  }

  /**
   * 释放操作位（执行失败时调用，允许客户端重试）。
   * 对未占用的 key 是 no-op（幂等）。
   */
  abort(userId: number | string, opId: string): boolean {
    const normalized = normalizeOpId(opId);
    if (normalized.kind !== 'ok') return false;
    return this.entries.delete(this.keyOf(userId, normalized.value));
  }

  /** 清理已过期条目，返回清理数量（供定时任务调用，防内存无界增长）。 */
  sweep(): number {
    const at = this.now();
    let removed = 0;
    for (const [key, entry] of [...this.entries]) {
      if (entry.expiresAt <= at) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** 清空全部（测试 / 运维用）。 */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private keyOf(userId: number | string, opId: string): string {
    // userId 与 opId 之间用不可出现在 opId 中的分隔符，避免 `1` + `2:x` 与 `12` + `:x` 撞键
    return `${String(userId)}\u0000${opId}`;
  }
}

type NormalizedOpId =
  | { kind: 'ok'; value: string }
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string };

function normalizeOpId(opId: string | undefined | null): NormalizedOpId {
  if (opId === undefined || opId === null) return { kind: 'absent' };
  if (typeof opId !== 'string') return { kind: 'invalid', reason: 'opId 必须是字符串' };
  const trimmed = opId.trim();
  if (trimmed === '') return { kind: 'absent' };
  if (trimmed.length > MAX_OP_ID_LENGTH) {
    return { kind: 'invalid', reason: `opId 长度不得超过 ${MAX_OP_ID_LENGTH}` };
  }
  return { kind: 'ok', value: trimmed };
}

function effectiveTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return DEFAULT_OP_TTL_MS;
  return Math.floor(ttlMs);
}
