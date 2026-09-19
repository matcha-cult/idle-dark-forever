/**
 * GameClient —— 应用侧对 transport 层的**唯一装配点**。
 *
 * 把四样东西绑在一起，Store 只依赖本类（与它导出的类型）：
 * - `ionet`：WS 连接状态机（`?token=` 握手 / 心跳 / 退避重连 / reqId 并发）；
 * - `api`：transport 的 typed Action API（`GameApi`，13 个 cmd 段）；
 * - `rest`：REST 通道（登录 / me；同源 `/api`，Vite 代理）；
 * - `notifications`：应用侧推送总线（transport 的 `client.notifications` → 本总线 → 各域 Store）。
 *
 * 错误口径（硬契约）：
 * - typed API 强制 `allowBusinessFailure`，**业务失败不抛**，以 `ActionResult.success === false` 返回；
 * - 传输层失败（errorCode ≠ 0 / 连接 / 超时）仍抛异常，由 Store 的 try/catch 转 Toast。
 *   本文件导出 `failureCodeOf` / `failureMessageOf` / `toastFailure` 三个助手，
 *   保证「服务端 message ＞ 本地码表 ＞ 兜底」的口径在**所有 Store 里只有一份实现**。
 */
import {
  businessCodeOf,
  businessMessageOf,
  GameApi,
  IonetClient,
  type ActionResult,
  type BusinessError,
  type ConnectionState,
  type IonetClientOptions,
} from '@idle-dark/ionet-transport';
import type { ToastStore } from '../stores/toast-store.js';
import { NotificationBus, type PushFrame } from './notification-bus.js';

// 供 Store / StoreContext 使用的类型再导出（transport 的耦合只在本文件出现）。
export type { ActionResult, ConnectionState, GameApi } from '@idle-dark/ionet-transport';

// ─────────────────────────── REST（认证） ───────────────────────────

/** REST 失败（非 2xx / 网络错误）。与传输层 errorCode 是两个独立层级。 */
export class RestError extends Error {
  override readonly name = 'RestError';
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export interface LoginInput {
  username: string;
  password: string;
}

/** 登录响应（`POST /api/auth/login`，形状同 `LoginResponseDto`）。 */
export interface LoginResultDto {
  token: string;
  expiresAt: number;
  userId: string;
  displayName: string;
}

/**
 * REST 通道：**只做认证与账号信息**，其余游戏交互全走 WS（工程硬约束）。
 *
 * 为什么不用 transport 的 `AuthApi.login`（WS (10,1)）：任务书明确要求登录走
 * `POST /api/auth/login`（NestJS 控制器）→ 存 token → 再以 `?token=` 连 WS。
 * WS 的 `auth.login` 作为备用通道保留在 `api.auth.login` 里。
 */
export class RestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | undefined,
    private readonly fetchImpl: typeof fetch = (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  ) {}

  login(input: LoginInput): Promise<ActionResult<LoginResultDto>> {
    return this.send<LoginResultDto>('POST', '/auth/login', input, false);
  }

  me(): Promise<ActionResult<{ userId: string; displayName: string; diamonds: number; playerSlotCount: number; highestEndlessLevel: number }>> {
    return this.send('GET', '/auth/me', undefined, true);
  }

  private async send<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    withAuth: boolean,
  ): Promise<ActionResult<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = this.getToken();
    if (withAuth && token !== undefined && token !== '') headers['Authorization'] = `Bearer ${token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new RestError(0, error instanceof Error ? error.message : String(error));
    }

    const text = await response.text();
    let parsed: unknown;
    if (text !== '') {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      throw new RestError(response.status, extractMessage(parsed) ?? `请求失败（HTTP ${response.status}）`, parsed);
    }
    // 端点可能返回 ActionResult，也可能返回裸 DTO：两种都归一化。
    if (parsed !== null && typeof parsed === 'object' && typeof (parsed as { success?: unknown }).success === 'boolean') {
      return parsed as ActionResult<T>;
    }
    return { success: true, data: parsed as T };
  }
}

function extractMessage(body: unknown): string | undefined {
  if (typeof body === 'string' && body.length > 0) return body;
  if (body !== null && typeof body === 'object') {
    const record = body as { message?: unknown; errorMessage?: unknown };
    if (typeof record.message === 'string') return record.message;
    if (Array.isArray(record.message) && typeof record.message[0] === 'string') return record.message[0];
    if (typeof record.errorMessage === 'string') return record.errorMessage;
  }
  return undefined;
}

// ─────────────────────────── 失败口径助手 ───────────────────────────

/** 失败体 → 业务码（无则 undefined）。 */
export function failureCodeOf(result: ActionResult<unknown>): string | undefined {
  if (result.success !== false) return undefined;
  const code = businessCodeOf(result);
  return code === 'UNKNOWN' ? undefined : code;
}

/** 失败体 → 服务端文案（无则 undefined）。 */
export function failureMessageOf(result: ActionResult<unknown>): string | undefined {
  return businessMessageOf(result);
}

/**
 * 把一次失败集中转成 Toast：文案优先级 = 服务端 `message` ＞ `businessErrorMessage(code)` ＞ 兜底。
 * 这是全应用**唯一**的业务失败提示实现。
 */
export function toastFailure(toast: ToastStore, result: ActionResult<unknown>, fallback: string): void {
  if (result.success !== false) return;
  toast.fromFailure(failureCodeOf(result), failureMessageOf(result), fallback);
}

// ─────────────────────────── 端点推导 ───────────────────────────

/** 同源 WS 端点推导：`ws(s)://<location.host>/ws`。 */
export function resolveWsUrl(env: unknown = import.meta.env): string {
  const configured = (env as { VITE_WS_URL?: string } | undefined)?.VITE_WS_URL;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  if (typeof location === 'undefined') return 'ws://127.0.0.1:3000/ws';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

/** 同源 REST 前缀推导（Vite 代理 `/api` → 后端）。 */
export function resolveApiBaseUrl(env: unknown = import.meta.env): string {
  const configured = (env as { VITE_API_BASE_URL?: string } | undefined)?.VITE_API_BASE_URL;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  return '/api';
}

// ─────────────────────────── GameClient ───────────────────────────

export interface GameClientCallbacks {
  onStateChange(state: ConnectionState, detail?: string): void;
  /** 业务错误回调（transport 在非 `allowBusinessFailure` 路径上主动上报）。 */
  onBusinessError?(error: BusinessError): void;
}

export interface GameClientOptions {
  /** WS 端点；缺省同源 `/ws`。 */
  url?: string;
  /** REST 前缀；缺省 `/api`。 */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** 取当前 JWT（握手拼 `?token=`，REST 走 Bearer）。 */
  getToken: () => string | undefined;
  callbacks: GameClientCallbacks;
  /** 测试注入 socket 适配器。 */
  adapterFactory?: IonetClientOptions['adapterFactory'];
  heartbeat?: IonetClientOptions['heartbeat'];
  reconnect?: IonetClientOptions['reconnect'];
  requestTimeoutMs?: number;
  logger?: (...args: unknown[]) => void;
}

export class GameClient {
  readonly ionet: IonetClient;
  readonly api: GameApi;
  readonly rest: RestClient;
  /** 应用侧推送总线（transport 推送帧 → 域 Store）。 */
  readonly notifications = new NotificationBus();

  private readonly unsubscribeNotifications: () => void;

  constructor(options: GameClientOptions) {
    const ionetOptions: IonetClientOptions = {
      url: options.url ?? resolveWsUrl(),
      authHandler: options.getToken,
      onStateChange: options.callbacks.onStateChange,
      onNotification: (notification) => this.notifications.dispatch(notification as PushFrame),
      ...(options.callbacks.onBusinessError === undefined
        ? {}
        : { onBusinessError: options.callbacks.onBusinessError }),
      ...(options.adapterFactory === undefined ? {} : { adapterFactory: options.adapterFactory }),
      ...(options.heartbeat === undefined ? {} : { heartbeat: options.heartbeat }),
      ...(options.reconnect === undefined ? {} : { reconnect: options.reconnect }),
      ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      // 通知订阅者抛错不得打断其它订阅者；总线路由自己兜底，这里只留诊断出口。
      onNotificationError: (error, notification) => {
        console.error('[notifications] handler error', notification, error);
      },
    };

    this.ionet = new IonetClient(ionetOptions);
    this.api = new GameApi(this.ionet);
    this.rest = new RestClient(
      options.baseUrl ?? resolveApiBaseUrl(),
      options.getToken,
      options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)),
    );
    // 双通道订阅：`onNotification` 回调与 `client.notifications` 总线都会命中，
    // 本地总线按 handler 去重（Set），因此不会重复分发。
    this.unsubscribeNotifications = this.ionet.notifications.subscribe((notification) => {
      this.notifications.dispatch(notification as PushFrame);
    });
  }

  get state(): ConnectionState {
    return this.ionet.getState();
  }

  /** 当前 transport 观测到的服务端时间偏移（未采样时 null）。 */
  get serverTimeOffsetMs(): number | null {
    return this.ionet.serverTimeOffsetMs;
  }

  connect(): Promise<void> {
    return this.ionet.connect();
  }

  /** 断开连接并清空连接态（登出时调用）：不清 session，仅网络面。 */
  disconnect(detail = 'app-close'): void {
    this.ionet.close(detail);
  }

  /** 释放：退订推送（连接由 `disconnect` 负责，幂等）。 */
  dispose(): void {
    try {
      this.unsubscribeNotifications();
    } catch {
      /* 忽略 */
    }
    this.notifications.clear();
  }
}
