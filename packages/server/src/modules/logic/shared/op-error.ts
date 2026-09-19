/**
 * 面板域业务失败异常（内部流转用）。
 *
 * 内部纯逻辑抛本异常；`<domain>.logic.service.ts` 在边界把它转回协议 `ActionFail`
 * （Action 层绝不抛业务异常，见任务书硬性要求 3）。
 */
import type { ActionFail, BusinessErrorCode } from '@idle-dark/protocol';
import { businessErrorMessage } from '@idle-dark/protocol';
import { failOf } from '../../../common/kernel/result.js';

export class OpError extends Error {
  readonly code: BusinessErrorCode | string;
  readonly detail: Record<string, unknown> | undefined;

  constructor(
    code: BusinessErrorCode | string,
    message?: string,
    detail?: Record<string, unknown>,
  ) {
    super(message ?? businessErrorMessage(code));
    this.name = 'OpError';
    this.code = code;
    this.detail = detail;
  }

  toFail(): ActionFail {
    return failOf(this.code, this.message, this.detail);
  }
}

/** 把内部异常转成 `ActionFail`；非 `OpError` 原样抛出（交给 guardAction → INTERNAL）。 */
export function toFailOrThrow(error: unknown): ActionFail {
  if (error instanceof OpError) return error.toFail();
  throw error;
}
