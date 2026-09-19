/**
 * 消耗类操作的 `opId` 幂等包装（面板域共用）。
 *
 * 语义（与 `OpIdempotencyService` 的注释对齐，但**重复提交一律拒绝**，见任务书验收门禁）：
 * - `opId` 缺失 / 空白 → 不去重（`begin` 返回 fresh/deduped:false），由限流兜底；
 * - `opId` 非法（超长 / 非字符串）→ `INVALID_PARAM`（fail-closed，不执行）；
 * - 重复提交（in-flight 或已 settle）→ `DUPLICATE_OPERATION`；
 * - 首次 → 执行，成功 `settle`（记录结果供审计），业务失败 / 异常 `abort`（允许客户端重试）。
 *
 * ⚠️ 这里**不回放**上次结果，而是拒绝重复提交：任务书验收明确要求「opId 重复提交被拒」。
 */
import {
  BusinessErrorCode,
  type ActionResult,
  type ActionFail,
} from '@idle-dark/protocol';
import { failOf } from '../../../../common/kernel/result.js';
import type { OpIdempotencyService } from '../../../game/op-idempotency.service.js';

export type OperationOutcome<T> = ActionResult<T> | ActionFail;

/** 校验并占用 opId；需要执行返回 null，否则返回应直接返回的失败结果。 */
export function claimOperation(
  opIds: OpIdempotencyService,
  userId: number,
  opId: string | undefined,
): ActionFail | null {
  const claim = opIds.begin(userId, opId);
  if (claim.kind === 'invalid') {
    return failOf(BusinessErrorCode.INVALID_PARAM, claim.reason);
  }
  if (claim.kind === 'duplicate') {
    return failOf(BusinessErrorCode.DUPLICATE_OPERATION);
  }
  return null;
}

/**
 * 幂等执行包装：`work` 返回 `ActionResult`。
 *
 * `work` 抛异常时先 `abort` 再原样抛出（由 Action 层的 `guardAction` 收口为 `INTERNAL`）。
 */
export async function withOperation<T>(
  opIds: OpIdempotencyService,
  userId: number,
  opId: string | undefined,
  work: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const rejected = claimOperation(opIds, userId, opId);
  if (rejected) return rejected;

  try {
    const result = await work();
    if (opId !== undefined && opId.trim() !== '') {
      if (result.success) opIds.settle(userId, opId, result.data);
      else opIds.abort(userId, opId);
    }
    return result;
  } catch (error) {
    if (opId !== undefined && opId.trim() !== '') opIds.abort(userId, opId);
    throw error;
  }
}
