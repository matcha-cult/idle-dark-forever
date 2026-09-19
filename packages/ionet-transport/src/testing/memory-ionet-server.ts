/**
 * MemoryIonetServer —— 几十行复刻 PROTOCOL.md §3/§4/§5/§8 的 mock 服务端。
 *
 * 与 `FakeSocketAdapter`（或 `FakeSocketAdapterFactory`）配套：
 * 解析客户端帧 → 命中注册的 `(cmd, subCmd)` handler → 按「请求是否携带 reqId」决定是否
 * 回显 `reqId` + 写入 `kind='response'`（§4 / §12.1），推送一律带 `kind='notification'`（§5）。
 *
 * 零后端开发时把它挂到 `FakeSocketAdapterFactory` 上即可：每个（重）连产生的新适配器自动绑定。
 */
import { fail, ok, type ActionResult } from '@idle-dark/protocol';
import type { NotificationMessage, ResponseMessage } from '@nbb-ionet/client-protocol';
import type { Unsubscribe } from '../transport/socket-adapter.js';
import { FakeSocketAdapterFactory, type MockSocketDriver } from './fake-socket-adapter.js';

export interface MockRequest {
  cmd: number;
  subCmd: number;
  data?: unknown;
  headers?: Record<string, string>;
  traceId?: string;
  reqId?: string | number;
}

export interface MockReply {
  data?: unknown;
  errorCode?: number;
  errorMessage?: string;
  /** 延迟多少毫秒后回包（用于制造乱序响应）。 */
  delayMs?: number;
}

export type MockHandler = (request: MockRequest) => MockReply | null | Promise<MockReply | null>;

export interface MemoryIonetServerOptions {
  /** 未命中路由时的兜底 handler（默认：不回包）。 */
  handler?: MockHandler;
  /** 是否按 §4 回显 reqId/kind（默认 true；置 false 模拟旧服务）。 */
  echoReqId?: boolean;
}

/** 业务成功体（与 `@idle-dark/protocol` 的 `ok()` 同源）。 */
export function businessOk<T>(data: T, message?: string): ActionResult<T> {
  return ok(data, message);
}

/** 业务失败体：`errorCode` 仍为 0，业务码在 `data.data.code`（业务层失败）。 */
export function businessFail(code: string, message?: string): ActionResult<never> {
  return fail(code, message);
}

function routeKey(cmd: number, subCmd: number): string {
  return `${cmd}:${subCmd}`;
}

export class MemoryIonetServer {
  readonly requests: MockRequest[] = [];
  private readonly routes = new Map<string, MockHandler>();
  private readonly unsubscribes: Unsubscribe[] = [];
  private current: MockSocketDriver | null = null;
  private running = false;
  private readonly echoReqId: boolean;

  constructor(
    private readonly target: MockSocketDriver | FakeSocketAdapterFactory,
    private readonly options: MemoryIonetServerOptions = {},
  ) {
    this.echoReqId = options.echoReqId !== false;
  }

  /** 注册 `(cmd, subCmd)` 路由 handler。 */
  on(cmd: number, subCmd: number, handler: MockHandler): this {
    this.routes.set(routeKey(cmd, subCmd), handler);
    return this;
  }

  /** 开始监听。传工厂时，后续每个新适配器都会自动绑定（重连也覆盖）。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.target instanceof FakeSocketAdapterFactory) {
      this.unsubscribes.push(this.target.onCreate((adapter) => this.bind(adapter)));
      // 工厂可能已经产出过实例（例如测试先 connect 再 start）：补绑。
      for (const adapter of this.target.instances) this.bind(adapter);
      return;
    }
    this.bind(this.target);
  }

  stop(): void {
    this.running = false;
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.current = null;
  }

  /** 当前生效的 socket（最后一次绑定）。 */
  get driver(): MockSocketDriver | null {
    return this.current;
  }

  /** 注入一条服务端主动推送（§5，必带 kind='notification'）。 */
  push(notification: Omit<NotificationMessage, 'kind'> & { kind?: 'notification' }): void {
    const driver = this.current;
    if (driver === null) return;
    driver.emitMessage({ ...notification, kind: 'notification' });
  }

  /** 按 `(cmd, subCmd)` 推送一条推送帧。 */
  pushRoute(cmd: number, subCmd: number, data?: unknown, extra: { type?: string } = {}): void {
    this.push({
      cmd,
      subCmd,
      data,
      timestamp: Date.now(),
      ...(extra.type !== undefined ? { type: extra.type } : {}),
    });
  }

  /** 模拟服务端断线。 */
  drop(code = 1006, reason = 'server drop'): void {
    this.current?.serverClose(code, reason);
  }

  /** 直接处理一帧（测试可绕过 socket 直接驱动）。 */
  async handle(text: string): Promise<void> {
    let request: MockRequest;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      request = parsed as MockRequest;
    } catch {
      this.current?.emitMessage({ errorCode: 400, errorMessage: 'bad frame' });
      return;
    }
    this.requests.push(request);
    const handler = this.routes.get(routeKey(request.cmd, request.subCmd)) ?? this.options.handler;
    if (handler === undefined) return; // 无路由：不回包（由测试自己断言超时）
    const reply = await handler(request);
    if (reply === null) return;
    this.respond(request, reply);
  }

  /** 按 §4 构造并投递一条响应（或按 `delayMs` 延迟投递）。 */
  respond(request: MockRequest, reply: MockReply): void {
    const response: ResponseMessage = {
      data: reply.data,
      ...(reply.errorCode !== undefined ? { errorCode: reply.errorCode } : {}),
      ...(reply.errorMessage !== undefined ? { errorMessage: reply.errorMessage } : {}),
    };
    if (this.echoReqId && request.reqId !== undefined) {
      response.reqId = request.reqId;
      response.kind = 'response';
    }
    const send = (): void => this.current?.emitMessage(response);
    if (reply.delayMs !== undefined && reply.delayMs > 0) {
      setTimeout(send, reply.delayMs);
    } else {
      send();
    }
  }

  private bind(driver: MockSocketDriver): void {
    this.current = driver;
    this.unsubscribes.push(
      driver.onSend((data) => {
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        void this.handle(text);
      }),
    );
  }
}

/** 便捷构造：一个假适配器工厂 + 一个自动应答的 mock 服务端。 */
export function createFakePair(options: MemoryIonetServerOptions & { onSend?: (data: string | Uint8Array) => void } = {}): {
  factory: FakeSocketAdapterFactory;
  server: MemoryIonetServer;
} {
  const { onSend, ...serverOptions } = options;
  const factory = new FakeSocketAdapterFactory(onSend === undefined ? {} : { onSend });
  const server = new MemoryIonetServer(factory, serverOptions);
  server.start();
  return { factory, server };
}
