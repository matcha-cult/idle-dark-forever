/**
 * 错误模型 —— **两级错误判定**（本层最重要的硬契约）。
 *
 * 一次请求的结果必须按顺序判定（PROTOCOL.md §8 + `@idle-dark/protocol` 的 `result.ts`）：
 *
 * ① **传输/框架层失败**：响应信封 `errorCode !== 0`（且非 undefined）→ `TransportError`
 *    （400 坏帧 / 404 Action 未注册 / 500 内部异常）。
 * ② **业务层失败**：`errorCode` 为 0/缺失，但 `data.success === false`，
 *    业务码在 `data.data.code`（缺失 → `UNKNOWN`）→ `BusinessError`。
 * ③ 其余 → 成功。
 *
 * ⚠️ **只判 `errorCode` 会把全部业务失败当成功**（业务失败一律以 errorCode=0 送达）。
 *
 * 本文件只做「判定」，不做业务语义：业务码文案在 `@idle-dark/protocol` 的
 * `BUSINESS_ERROR_MESSAGE` / `businessErrorMessage`。
 */
import type { ActionFail, ActionResult } from '@idle-dark/protocol';
import type { ResponseMessage } from '@nbb-ionet/client-protocol';

/** 未知业务码占位：服务端未给出 `data.data.code` 时的兜底。 */
export const UNKNOWN_BUSINESS_CODE = 'UNKNOWN';

/** 传输/框架层失败（PROTOCOL.md §8）。 */
export class TransportError extends Error {
  override readonly name = 'TransportError';
  constructor(
    /** 服务端 errorCode（400/404/500…）；网络不可达时为 0。 */
    readonly errorCode: number,
    message?: string,
    readonly response?: ResponseMessage,
  ) {
    super(message ?? `传输层错误 errorCode=${errorCode}`);
  }
}

/** 业务层失败：`errorCode === 0` 且 `data.success === false`。 */
export class BusinessError extends Error {
  override readonly name = 'BusinessError';
  /** 服务端原始 message；缺失时为 undefined（UI 应回落到 `@idle-dark/protocol` 的本地码表）。 */
  readonly serverMessage: string | undefined;

  constructor(
    /** 业务码（`data.data.code`），缺失时为 `UNKNOWN`。 */
    readonly code: string,
    message?: string,
    readonly response?: ResponseMessage,
    /** 原始失败体（`ActionResult` 的 fail 分支），便于 UI 取更多上下文。 */
    readonly body?: unknown,
  ) {
    super(message ?? `业务失败 [${code}]`);
    this.serverMessage = message;
  }
}

/** 帧无法解析 / 形状不符合协议（客户端侧 §8 语义）。 */
export class ProtocolError extends Error {
  override readonly name = 'ProtocolError';
}

/** 请求超时（未在 `timeoutMs` 内拿到响应）。 */
export class RequestTimeoutError extends Error {
  override readonly name = 'RequestTimeoutError';
  constructor(
    message: string,
    readonly cmd?: number,
    readonly subCmd?: number,
  ) {
    super(message);
  }
}

/** 连接不可用（已关闭 / 重连中未就绪 / 等待就绪超时）。 */
export class ConnectionError extends Error {
  override readonly name = 'ConnectionError';
}

/**
 * 握手被拒或连接失败。浏览器读不到 HTTP 状态码（PROTOCOL.md §6 的 401 在浏览器表现为
 * close code=1006 且未 open），因此这里给出可判定的错误类型 + 提示。
 */
export class HandshakeError extends Error {
  override readonly name = 'HandshakeError';
  constructor(
    message: string,
    readonly closeCode?: number,
    readonly closeReason?: string,
  ) {
    super(message);
  }
}

/** `data.success === false` 判定（严格：仅 `false` 视为业务失败，undefined/true 均为成功）。 */
export function isBusinessFailure(body: unknown): body is ActionFail {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { success?: unknown }).success === false
  );
}

/** 从 `ActionResult` 的 fail 分支提取业务码（缺失/空串 → `UNKNOWN`）。 */
export function businessCodeOf(body: unknown): string {
  const code = (body as { data?: { code?: unknown } } | null | undefined)?.data?.code;
  return typeof code === 'string' && code.length > 0 ? code : UNKNOWN_BUSINESS_CODE;
}

/** 从失败体提取服务端业务文案（缺失/空串 → undefined）。 */
export function businessMessageOf(body: unknown): string | undefined {
  const message = (body as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message.length > 0 ? message : undefined;
}

/** 判定结果（供调用方按分支处理，不抛错）。 */
export type ClassifiedResponse =
  | { ok: true; response: ResponseMessage }
  | { ok: false; kind: 'transport'; error: TransportError }
  | { ok: false; kind: 'business'; error: BusinessError };

/**
 * 两级判定的**纯函数**形态：只按契约返回分支，不抛错、不产生副作用。
 * 这是 `assertTransportOk` / `assertResponseOk` 的唯一实现来源。
 */
export function classifyResponse(response: ResponseMessage): ClassifiedResponse {
  const errorCode = response.errorCode;
  // ① 传输/框架层：0 / undefined 为成功（PROTOCOL.md §8）。
  if (errorCode !== undefined && errorCode !== 0) {
    return {
      ok: false,
      kind: 'transport',
      error: new TransportError(errorCode, response.errorMessage, response),
    };
  }
  // ② 业务层：errorCode 为 0，但业务体标记 success === false。
  if (isBusinessFailure(response.data)) {
    return {
      ok: false,
      kind: 'business',
      error: new BusinessError(
        businessCodeOf(response.data),
        businessMessageOf(response.data),
        response,
        response.data,
      ),
    };
  }
  // ③ 成功。
  return { ok: true, response };
}

/** 只做 ① 传输层判定；失败抛 `TransportError`。 */
export function assertTransportOk(response: ResponseMessage): ResponseMessage {
  const classified = classifyResponse(response);
  if (!classified.ok && classified.kind === 'transport') throw classified.error;
  return response;
}

/**
 * 按 ① → ② 的顺序完整判定，失败抛 `TransportError` / `BusinessError`；成功返回响应（不改写）。
 *
 * `IonetClient.request` 在默认选项下调用本函数；`allowBusinessFailure: true` 时改用
 * `assertTransportOk`，把业务失败体作为预期分支返回给调用方。
 */
export function assertResponseOk(response: ResponseMessage): ResponseMessage {
  const classified = classifyResponse(response);
  if (!classified.ok) throw classified.error;
  return response;
}

/** 断言一个业务体是成功分支（类型收窄）；失败时抛 `BusinessError`。 */
export function assertBusinessOk<TData>(
  result: ActionResult<TData>,
  response?: ResponseMessage,
): ActionOkOf<TData> {
  if (result.success === false) {
    throw new BusinessError(
      businessCodeOf(result),
      businessMessageOf(result),
      response,
      result,
    );
  }
  return result;
}

/** `ActionResult<T>` 的成功分支别名（避免与 protocol 的 `ActionOk` 命名混淆）。 */
export type ActionOkOf<T> = Extract<ActionResult<T>, { success: true }>;
