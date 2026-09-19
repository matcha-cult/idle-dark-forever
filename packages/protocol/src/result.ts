/**
 * 业务结果约定（前后端硬契约）
 *
 * 两级错误判定（唯一正确姿势）：
 *   ① 传输层：响应信封 `errorCode !== 0` → TransportError（400 解析失败 / 404 路由不存在 / 500 内部异常）
 *   ② 业务层：`errorCode === 0` 但 `data.success === false` → BusinessError（业务码在 `data.data.code`）
 *   ③ 其余 → 成功
 *
 * ⚠️ 只判断 `errorCode` 会把**全部业务失败当成成功**。见 PROTOCOL.md §8 与 ai-docs/04-决策矩阵与风险.md R9。
 *
 * 服务端 Action **不抛业务异常**：统一返回 `fail(...)`，由 BarSkeleton 包进响应信封。
 */

import type { BusinessErrorCode } from './error-codes.js';

/** 业务失败载荷：`success:false` + 机器可读 code。 */
export interface BusinessErrorPayload {
  code: BusinessErrorCode | string;
  /** 可选补充信息（例如缺少的材料 key）。 */
  detail?: Record<string, unknown>;
}

/** 所有 Action 的统一返回形状。 */
export type ActionResult<T = unknown> = ActionOk<T> | ActionFail;

export interface ActionOk<T = unknown> {
  success: true;
  message?: string;
  data: T;
}

export interface ActionFail {
  success: false;
  message?: string;
  data: BusinessErrorPayload;
}

/** 构造业务失败（服务端用）。 */
export function fail(code: BusinessErrorCode | string, message?: string, detail?: Record<string, unknown>): ActionFail {
  return {
    success: false,
    ...(message !== undefined ? { message } : {}),
    data: detail === undefined ? { code } : { code, detail },
  };
}

/** 构造业务成功（服务端用）。 */
export function ok<T>(data: T, message?: string): ActionOk<T> {
  return { success: true, ...(message !== undefined ? { message } : {}), data };
}

/** 类型守卫：业务是否成功。 */
export function isOk<T>(result: ActionResult<T>): result is ActionOk<T> {
  return result.success === true;
}

/** 从失败结果中取业务码。 */
export function businessCodeOf(result: ActionFail): string {
  return result.data.code;
}
