/**
 * 浏览器原生 WebSocket 适配器（v1 主场景）。
 *
 * 关键约束（PROTOCOL.md §6）：浏览器 `WebSocket` **无法设置握手请求头**，
 * 因此凭据唯一可行通道是 URL 查询参数 `?token=<jwt>`；本适配器只接收已经拼好的最终 URL。
 *
 * 帧类型：强制 `binaryType = 'arraybuffer'`，文本帧仍以 `string` 交付（PROTOCOL.md §1）。
 */
import type {
  SocketAdapter,
  SocketCloseEvent,
  SocketReadyState,
  Unsubscribe,
} from './socket-adapter.js';

/** 浏览器 `WebSocket` 构造器的可注入面（便于测试注入 fake 构造器）。 */
export interface WebSocketLike {
  readyState: number;
  binaryType: string;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, handler: (event: unknown) => void): void;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

const STATE_MAP: Record<number, SocketReadyState> = {
  0: 'connecting',
  1: 'open',
  2: 'closing',
  3: 'closed',
};

/** 从任意 host 对象上取 WebSocket 构造器；不存在时返回 undefined（SSR / Node 环境）。 */
export function resolveWebSocketCtor(host: unknown = globalThis): WebSocketCtor | undefined {
  const ctor = (host as { WebSocket?: unknown } | null | undefined)?.WebSocket;
  return typeof ctor === 'function' ? (ctor as WebSocketCtor) : undefined;
}

export class BrowserSocketAdapter implements SocketAdapter {
  private readonly Ctor: WebSocketCtor | undefined;
  private socket: WebSocketLike | null = null;
  private readonly openHandlers = new Set<() => void>();
  private readonly messageHandlers = new Set<(frame: string | ArrayBuffer) => void>();
  private readonly closeHandlers = new Set<(event: SocketCloseEvent) => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private closedEmitted = false;

  constructor(ctor: WebSocketCtor | undefined = resolveWebSocketCtor()) {
    this.Ctor = ctor;
  }

  get readyState(): SocketReadyState {
    return this.socket ? (STATE_MAP[this.socket.readyState] ?? 'closed') : 'closed';
  }

  connect(url: string): void {
    if (this.socket !== null) throw new Error('BrowserSocketAdapter: already connected');
    if (this.Ctor === undefined) {
      throw new Error('BrowserSocketAdapter: 当前环境没有 WebSocket 构造器（浏览器外请注入适配器）');
    }
    const socket = new this.Ctor(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.addEventListener('open', () => {
      for (const handler of this.openHandlers) handler();
    });
    socket.addEventListener('message', (event) => {
      const data = (event as { data?: unknown }).data;
      if (typeof data === 'string') {
        for (const handler of this.messageHandlers) handler(data);
      } else if (data instanceof ArrayBuffer) {
        for (const handler of this.messageHandlers) handler(data);
      } else if (data !== undefined && data !== null) {
        // Blob 或其他形状（明确不支持）：转为错误而非静默丢弃。
        for (const handler of this.errorHandlers) {
          handler(new Error('BrowserSocketAdapter: 不支持的帧类型（期望 string/ArrayBuffer）'));
        }
      }
    });
    socket.addEventListener('close', (event) => {
      this.emitClose(event);
    });
    socket.addEventListener('error', () => {
      // 浏览器出于安全不暴露错误细节；真正的失败信号是随后的 close。
      for (const handler of this.errorHandlers) handler(new Error('WebSocket error'));
    });
  }

  send(data: string | Uint8Array): void {
    if (this.socket === null || this.socket.readyState !== 1) {
      throw new Error('BrowserSocketAdapter: socket 未处于 open 状态，拒绝发送');
    }
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    if (this.socket === null) return;
    const socket = this.socket;
    this.socket = null;
    try {
      socket.close(code, reason);
    } catch {
      /* 已关闭 / 非法 code：忽略，关闭语义由 close 事件兜底 */
    }
    this.emitClose({ code: code ?? 1000, reason: reason ?? '', wasClean: true });
  }

  onOpen(handler: () => void): Unsubscribe {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  onMessage(handler: (frame: string | ArrayBuffer) => void): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onClose(handler: (event: SocketCloseEvent) => void): Unsubscribe {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  onError(handler: (error: Error) => void): Unsubscribe {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  private emitClose(event: unknown): void {
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    const raw = (event ?? {}) as { code?: number; reason?: string; wasClean?: boolean };
    const normalized: SocketCloseEvent = {
      code: typeof raw.code === 'number' ? raw.code : 1006,
      reason: typeof raw.reason === 'string' ? raw.reason : '',
      wasClean: raw.wasClean === true,
    };
    this.socket = null;
    for (const handler of this.closeHandlers) handler(normalized);
  }
}
