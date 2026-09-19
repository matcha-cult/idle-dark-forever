/**
 * SocketAdapter —— 平台 WebSocket 差异的**唯一收敛点**。
 *
 * 核心 client（`IonetClient`）只依赖本接口，因此：
 * - 浏览器用 `BrowserSocketAdapter`（原生 `WebSocket`，握手凭据走 `?token=`，PROTOCOL §6）；
 * - 小程序 / 其他宿主后期新增适配器即可，核心零改动；
 * - 测试/零后端开发用 `FakeSocketAdapter`（`@idle-dark/ionet-transport/testing`）。
 *
 * 线协议语义不在此层：适配器只搬运原始文本/二进制帧（PROTOCOL.md §1）。
 */

/** 适配器视角的连接状态（与 `WebSocket.readyState` 语义对齐但用字符串表达）。 */
export type SocketReadyState = 'connecting' | 'open' | 'closing' | 'closed';

/** 关闭事件（浏览器 `CloseEvent` 的可移植子集）。 */
export interface SocketCloseEvent {
  /** 1000 = 正常关闭；1006 = 异常断开（浏览器读不到 HTTP 状态，401 拒升级亦表现为异常关闭）。 */
  code: number;
  reason: string;
  wasClean: boolean;
}

/** 事件解绑函数。 */
export type Unsubscribe = () => void;

/**
 * 一个已建立的连接句柄。`connect()` 只发起握手，结果通过
 * `onOpen` / `onClose` / `onError` 通知。
 */
export interface SocketAdapter {
  /**
   * 发起握手。`url` 必须是最终握手地址（浏览器侧已把凭据拼成 `?token=`，由 client 负责）。
   * 重复调用应抛错。
   */
  connect(url: string): void;
  /** 发送一帧。未 open 时抛错（调用方负责状态判断）。 */
  send(data: string | Uint8Array): void;
  /** 主动关闭；已关闭时应为幂等 no-op。 */
  close(code?: number, reason?: string): void;
  onOpen(handler: () => void): Unsubscribe;
  onMessage(handler: (frame: string | ArrayBuffer) => void): Unsubscribe;
  onClose(handler: (event: SocketCloseEvent) => void): Unsubscribe;
  onError(handler: (error: Error) => void): Unsubscribe;
  readonly readyState: SocketReadyState;
}

/** 适配器工厂：每次（重）连都新建一个适配器实例，避免复用已关闭的 socket。 */
export type SocketAdapterFactory = () => SocketAdapter;
