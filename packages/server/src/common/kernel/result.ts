/**
 * 业务结果内核：把协议层 `ActionFail` 转成 Action 方法返回值。
 *
 * 两级错误判定（协议唯一真相，见 @idle-dark/protocol/result.ts）：
 *   ① 传输层 `errorCode !== 0` → TransportError
 *   ② `errorCode === 0` 且 `data.success === false` → BusinessError（码在 data.data.code）
 *
 * Action **不抛业务异常**：统一返回 `fail(...)`。本文件负责在协议结果与
 * Action 方法签名（`ActionResult<T>`）之间做显式转换，并收口「业务码 → 中文文案」。
 */
import {
  type ActionResult,
  type ActionFail,
  BusinessErrorCode,
  businessErrorMessage,
  fail,
} from '@idle-dark/protocol';

/** 业务码 → 失败结果；未显式给 message 时用协议文案兜底。 */
export function failOf(
  code: BusinessErrorCode | string,
  message?: string,
  detail?: Record<string, unknown>,
): ActionFail {
  return fail(code, message ?? businessErrorMessage(code), detail);
}

/**
 * `ActionFail` → Action 返回值。
 *
 * Action 的返回类型是 `ActionResult<T>`（成功 `ActionOk<T>` | 失败 `ActionFail`），
 * 因此失败对象可以直接返回；本函数用于把「从协议层拿到的 ActionFail」显式标注为
 * Action 返回值，避免在泛型方法里手写 `as ActionResult<T>`。
 */
export function toActionResult<T = unknown>(failResult: ActionFail): ActionResult<T> {
  return failResult as ActionResult<T>;
}

/**
 * 兜底包装：把任意 Action 主体包成「永不抛错」的 ActionResult。
 *
 * 业务失败仍应由主体显式 `return fail(...)`；本函数只兜住**意外异常**
 * （DB 断连 / 断言错误），按 `INTERNAL` 返回，避免 Action 抛错触发框架 errorCode=500 且
 * 丢失业务码语义（PROTOCOL §8）。
 */
export async function guardAction<T>(
  fn: () => Promise<ActionResult<T>> | ActionResult<T>,
): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failOf(BusinessErrorCode.INTERNAL, undefined, { reason: detail });
  }
}
