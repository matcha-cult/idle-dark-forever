/**
 * 对外服端口（依赖反转）
 *
 * 逻辑服 / 服务不允许直接依赖对外服实现，只能依赖本接口并投递消息；
 * 由 EdgeModule 提供实现（provider token: NOTIFICATION_PORT）。
 * 依赖方向「业务 → 端口 → 实现」单向，不会成环。
 */
export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');

/**
 * 推送内容：与 WS 请求同构的 cmd/subCmd（实现侧经框架 `sendNotification` /
 * `broadcastNotification` 投递，由框架补 `kind: 'notification'`，业务不自造信封形状）。
 *
 * - 按 `(cmd, subCmd)` 路由时给出 cmd/subCmd；
 * - 也可只给 `type`（自由事件名，与 cmd/subCmd 并列，见 PROTOCOL §5）。
 */
export interface NotificationMessage {
  cmd: number;
  subCmd: number;
  data?: unknown;
  /** 可选事件名（如 'room.tick'）；与 cmd/subCmd 并列，客户端可按 type 分流。 */
  type?: string;
}

export interface NotificationPort {
  /** 广播给所有在线连接（客户端据 kind:'notification' 与响应区分）。 */
  broadcast(message: NotificationMessage): void;
  /**
   * 定向推送给某用户。
   * @returns 是否至少命中一个在线连接（未命中 / userId<=0 返回 false，不抛错）
   */
  sendTo(userId: number, message: NotificationMessage): boolean;
}
