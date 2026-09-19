/**
 * HTTP fallback 通道（PROTOCOL.md §9）。
 *
 * - 路由：`POST {baseUrl}/{cmd}/{subCmd}`（如 `POST /api/1/1`）；
 * - 请求体：**必须**用 `{ data: ... }` 包装。
 *   ⚠️ 框架 `http-server.ts` 的 `isWrappedData` 会把**非数组 object 当信封解包**，
 *   裸 object DTO 会被当成 `{data?}` 信封而丢失载荷（`ai-docs/00-重写总方案.md` §4.3 #3）；
 *   因此本文件对**所有**入参统一包装，不做「要不要包」的判断。
 * - 响应：与 WS 同构的 `{data?, errorCode?, errorMessage?}`；
 *   无 `reqId` / `kind`（HTTP 通道不产生请求配对语义，降级即失去并发关联）。
 * - 错误判定与 WS 同一套两级规则（见 `../client/errors.js`）。
 */
import type { ActionResult } from '@idle-dark/protocol';
import type { ResponseMessage } from '@nbb-ionet/client-protocol';
import {
  assertResponseOk,
  assertTransportOk,
  ProtocolError,
  TransportError,
} from '../client/errors.js';
import type { GameApiRequestOptions, GameApiTransport } from './game-api.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpFallbackOptions {
  /** 通道前缀，默认 `/ionet`（⚠️ 不要与 NestJS REST 的 `/api` 同前缀，PROTOCOL §9）。 */
  baseUrl?: string;
  fetchImpl?: FetchLike;
  /** 取 JWT；返回 undefined/'' 时不带 `Authorization` 头。 */
  tokenProvider?: () => string | undefined | Promise<string | undefined>;
  /** 附加固定请求头。 */
  headers?: Record<string, string>;
}

/** 把 `{ data: ... }` 包装后的 body 序列化（PROTOCOL §9 + 框架裸 object 偏差）。 */
export function wrapHttpBody(params: unknown): string {
  return JSON.stringify({ data: params === undefined ? {} : params });
}

/** 拼 `POST {baseUrl}/{cmd}/{subCmd}` 的路径。 */
export function httpActionPath(baseUrl: string, cmd: number, subCmd: number): string {
  return `${baseUrl.replace(/\/+$/, '')}/${cmd}/${subCmd}`;
}

export class HttpFallback implements GameApiTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly tokenProvider: (() => string | undefined | Promise<string | undefined>) | undefined;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: HttpFallbackOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/ionet';
    const impl = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (impl === undefined) {
      throw new Error('HttpFallback: 当前环境没有 fetch，请注入 fetchImpl');
    }
    // 浏览器里 `fetch` 必须带 `this === window` 调用，否则抛 Illegal invocation。
    this.fetchImpl = impl.bind(globalThis);
    this.tokenProvider = options.tokenProvider;
    this.extraHeaders = options.headers ?? {};
  }

  /** 发一次请求并返回原始响应信封（只保证送达，不做 errorCode / 业务判定）。 */
  async requestEnvelope(
    cmd: number,
    subCmd: number,
    params?: unknown,
    options: GameApiRequestOptions = {},
  ): Promise<ResponseMessage> {
    assertRoute(cmd, subCmd);
    const token = await this.tokenProvider?.();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
      ...(options.headers ?? {}),
    };
    if (typeof token === 'string' && token.length > 0) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(httpActionPath(this.baseUrl, cmd, subCmd), {
        method: 'POST',
        headers,
        // ★ 必须包装：裸 object DTO 会被框架误当信封解包（PROTOCOL §9 已知偏差）。
        body: wrapHttpBody(params),
      });
    } catch (error) {
      throw new TransportError(0, `网络错误：${(error as Error).message}`);
    }

    const text = await response.text();
    let envelope: ResponseMessage | undefined;
    if (text.length > 0) {
      envelope = parseEnvelope(text, response.status);
    }

    if (!response.ok) {
      throw new TransportError(
        response.status,
        envelope?.errorMessage ?? `HTTP ${response.status}`,
        envelope,
      );
    }
    if (envelope === undefined) {
      throw new ProtocolError('HTTP fallback: 响应体为空，期望信封对象');
    }
    return envelope;
  }

  /**
   * 发一次请求并返回 Action 业务体。
   *
   * - 传输层失败（非 2xx / `errorCode !== 0`）→ 抛 `TransportError`；
   * - 业务失败 → 默认抛 `BusinessError`；`options.allowBusinessFailure === true` 时作为
   *   `ActionResult` 的 `success:false` 分支返回（`GameApi` 即此策略）。
   */
  async request<TData = unknown>(
    cmd: number,
    subCmd: number,
    params?: unknown,
    options: GameApiRequestOptions = {},
  ): Promise<ActionResult<TData>> {
    const envelope = await this.requestEnvelope(cmd, subCmd, params, options);
    if (options.allowBusinessFailure === true) assertTransportOk(envelope);
    else assertResponseOk(envelope);
    return envelope.data as ActionResult<TData>;
  }
}

function assertRoute(cmd: number, subCmd: number): void {
  if (!Number.isInteger(cmd) || cmd < 0 || !Number.isInteger(subCmd) || subCmd < 0) {
    throw new ProtocolError(`HTTP fallback: 非法路由（cmd=${String(cmd)}, subCmd=${String(subCmd)}）`);
  }
}

function parseEnvelope(text: string, status: number): ResponseMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProtocolError(`HTTP fallback: 响应不是合法 JSON（HTTP ${status}）`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProtocolError(`HTTP fallback: 响应不是信封对象（HTTP ${status}）`);
  }
  return parsed as ResponseMessage;
}
