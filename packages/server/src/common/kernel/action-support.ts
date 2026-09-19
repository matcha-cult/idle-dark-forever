/**
 * Action 公共支撑：鉴权取值、参数提取、错误结果构造。
 *
 * 约定：Action **不抛业务异常**，统一返回 `ActionResult`（成功 `ok(...)` / 失败 `fail(...)`），
 * 由 ionet 的 `BarSkeleton.execute` 包进响应信封的 `data` 字段。
 * 错误码一律来自 `@idle-dark/protocol` 的 `BusinessErrorCode`（不在此处自造字面量）。
 *
 * ⚠️ 本文件不是被装饰的 Action，`FlowContext` 仅作类型使用，因此用 `import { type ... }`；
 *    但**Action 类的方法签名里必须值导入 `FlowContext`**（`import { FlowContext } from ...`），
 *    否则 `emitDecoratorMetadata` 会把它擦成 `Function`，框架认不出首参 = 鉴权静默失效。
 */
import { type FlowContext } from '@nbb-ionet/core-framework';
import { type ActionFail, BusinessErrorCode } from '@idle-dark/protocol';
import { failOf } from './result.js';

export const ActionError = {
  /** 未携带合法 token / token 过期 / 会话无效 */
  unauthorized: (): ActionFail => failOf(BusinessErrorCode.UNAUTHORIZED),

  /** 参数不合法（默认文案「参数不合法」） */
  invalidParam: (message?: string): ActionFail => failOf(BusinessErrorCode.INVALID_PARAM, message),

  /**
   * 资源不存在。
   *
   * 协议错误码表目前**没有通用 NOT_FOUND**，只有 PLAYER_NOT_FOUND / ITEM_NOT_FOUND /
   * STORY_NOT_FOUND 等领域码；因此这里把「具体码」作为可覆盖参数，默认落到
   * `PLAYER_NOT_FOUND`（当前唯一使用方是角色域）。领域接入时请显式传自己的码：
   * `ActionError.notFound('物品不存在', BusinessErrorCode.ITEM_NOT_FOUND)`。
   */
  notFound: (
    message?: string,
    code: BusinessErrorCode | string = BusinessErrorCode.PLAYER_NOT_FOUND,
  ): ActionFail => failOf(code, message),

  /** 服务端内部错误（DB 断连等意外异常的统一出口） */
  internal: (message?: string): ActionFail =>
    failOf(BusinessErrorCode.INTERNAL, message),
} as const;

/** 从 FlowContext 取已鉴权 userId（number）；未鉴权 / 非法 → null。 */
export function userIdOf(ctx: FlowContext): number | null {
  const raw = ctx.getUserId();
  if (raw === 0n) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * 受保护 Action 的统一入口：未鉴权直接返回 `UNAUTHORIZED`。
 *
 * 用法：`const userId = requireUserId(ctx); if (typeof userId !== 'number') return userId;`
 * （返回类型故意是联合类型，逼迫调用点处理失败分支，而不是静默把 userId 当 0 用。）
 */
export function requireUserId(ctx: FlowContext): number | ActionFail {
  return userIdOf(ctx) ?? ActionError.unauthorized();
}

// ────────────────────────── data 参数提取 ──────────────────────────
// 线协议只保证「data 是调用方给的任意 JSON」。HTTP fallback 还会有「裸 DTO」与
// 「{ data: {...} } 包装」两种到达形态（PROTOCOL §9），因此所有取值都必须是防御式的，
// 且**不使用 class-validator**（本工程未引入该依赖）。

/** 取 data 对象；非对象（含 null / 数组 / 标量）→ 空对象。 */
export function dataOf(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

/** 非空字符串；否则 undefined。 */
export function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text === '' ? undefined : text;
}

/** 字符串 / 数字 → 有限数值；非法 / 缺失 → undefined。 */
export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const parsed =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 字符串 / 数字 → 有限整数（向下取整）；非法 / 缺失 → undefined。 */
export function toFiniteInt(value: unknown): number | undefined {
  const parsed = toFiniteNumber(value);
  return parsed === undefined ? undefined : Math.floor(parsed);
}

/** 布尔透传（只接受真正的 boolean，避免 "false" 被当成真）。 */
export function toBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
