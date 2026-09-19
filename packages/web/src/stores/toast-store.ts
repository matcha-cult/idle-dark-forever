/**
 * ToastStore —— 错误 → 文案转译 + 轻量提示队列。
 *
 * 三种失败来源统一入口：
 * - 业务失败（`ActionResult.success === false`）→ `fromFailure`；
 * - transport 抛出的错误（`TransportError` / timeout / 连接错误）→ `fromError`；
 * - REST 错误（`RestError`）→ `fromError`。
 *
 * 展示优先级（硬口径）：**服务端 `message` ＞ `businessErrorMessage(code)` ＞ 通用兜底**。
 * Store 只负责「判定 + 排队」，展示归 UI 层（`ToastBridge` 消费后交给 antd `message`）。
 *
 * 与 transport 的耦合刻意收窄：只用**结构判定**（`name` / 字段）识别错误种类，
 * 不 import 传输层的错误类 —— 错误类名可演进，队列语义不变。
 */
import { makeAutoObservable, runInAction } from 'mobx';
import { businessErrorMessage } from '@idle-dark/protocol';
import { RestError } from '../services/game-client.js';

export type ToastLevel = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  level: ToastLevel;
  title: string;
  message?: string;
  /** 业务/传输错误码（便于 UI 分类与去重）。 */
  code?: string | number;
}

let toastSeq = 0;

export class ToastStore {
  toasts: Toast[] = [];
  /** 最多同时展示条数（超出丢弃最旧的）。 */
  max = 4;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  push(toast: Omit<Toast, 'id'>): number {
    const id = ++toastSeq;
    this.toasts = [...this.toasts, { ...toast, id }].slice(-this.max);
    return id;
  }

  success(title: string, message?: string): number {
    return this.push({ level: 'success', title, ...(message === undefined ? {} : { message }) });
  }

  info(title: string, message?: string): number {
    return this.push({ level: 'info', title, ...(message === undefined ? {} : { message }) });
  }

  error(title: string, message?: string): number {
    return this.push({ level: 'error', title, ...(message === undefined ? {} : { message }) });
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  /** 取走并清空队列（供 `ToastBridge` 桥接到 antd `message`）。 */
  consume(): Toast[] {
    const drained = this.toasts;
    if (drained.length > 0) this.toasts = [];
    return drained;
  }

  clear(): void {
    this.toasts = [];
  }

  /**
   * 业务失败（`ActionResult.success === false`）。
   *
   * @param code 业务码（`data.data.code`），可能缺失
   * @param message 服务端 `message`（最具体，优先）
   */
  fromFailure(code: string | undefined, message: string | undefined, fallbackTitle = '操作失败'): void {
    const title = pickMessage(message, code, fallbackTitle);
    runInAction(() => {
      this.push({ level: 'error', title, ...(code === undefined ? {} : { message: `[${code}]`, code }) });
    });
  }

  /** 把异常转成 Toast；返回识别到的错误码（便于调用方分支）。 */
  fromError(error: unknown, fallbackTitle = '操作失败'): string | number | undefined {
    if (error instanceof RestError) {
      const title = error.status === 401 ? '登录状态已失效，请重新登录' : fallbackTitle;
      this.push({ level: 'error', title, message: error.message, code: error.status });
      return error.status;
    }

    const record = (error ?? {}) as { name?: unknown; code?: unknown; errorCode?: unknown; serverMessage?: unknown; message?: unknown };
    const name = typeof record.name === 'string' ? record.name : '';
    const rawMessage = typeof record.message === 'string' ? record.message : undefined;
    const serverMessage = typeof record.serverMessage === 'string' ? record.serverMessage : undefined;

    if (name === 'BusinessError') {
      const code = typeof record.code === 'string' ? record.code : undefined;
      const title = pickMessage(serverMessage ?? rawMessage, code, fallbackTitle);
      this.push({ level: 'error', title, ...(code === undefined ? {} : { message: `[${code}]`, code }) });
      return code;
    }
    if (name === 'TransportError') {
      const code = typeof record.errorCode === 'number' ? record.errorCode : undefined;
      this.push({
        level: 'error',
        title: transportTitle(code, fallbackTitle),
        ...(rawMessage === undefined ? {} : { message: rawMessage }),
        ...(code === undefined ? {} : { code }),
      });
      return code;
    }
    if (name === 'HandshakeError') {
      this.push({ level: 'error', title: '连接失败', ...(rawMessage === undefined ? {} : { message: rawMessage }) });
      return undefined;
    }
    if (name === 'RequestTimeoutError') {
      this.push({ level: 'error', title: '请求超时', ...(rawMessage === undefined ? {} : { message: rawMessage }) });
      return undefined;
    }
    if (name === 'ProtocolError') {
      this.push({ level: 'error', title: '协议解析失败', ...(rawMessage === undefined ? {} : { message: rawMessage }) });
      return undefined;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.push({ level: 'error', title: fallbackTitle, message });
    return undefined;
  }
}

/** 文案优先级：服务端 message ＞ 业务码表 ＞ 通用兜底。 */
function pickMessage(message: string | undefined, code: string | undefined, fallback: string): string {
  if (message !== undefined && message.trim().length > 0) return message;
  if (code !== undefined && code.length > 0) return businessErrorMessage(code);
  return fallback;
}

/** 传输层错误码 → 文案（与后端约定：400 解析失败 / 404 路由不存在 / 500 内部异常）。 */
function transportTitle(code: number | undefined, fallback: string): string {
  switch (code) {
    case 400:
      return '请求格式错误';
    case 404:
      return '服务端未实现该功能';
    case 500:
      return '服务器内部错误';
    default:
      return fallback;
  }
}
