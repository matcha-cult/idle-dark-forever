/**
 * 对外服服务实现（EdgeService）
 *
 * 职责：广播 / 定向推送。**不承载任何业务路由**，也不依赖任何业务服务。
 *
 * 推送链路（业务 → 端口 → 实现 → 框架）：
 *   Action/Service
 *     → `NOTIFICATION_PORT`（NotificationPort 接口）
 *       → EdgeService.broadcast / sendTo
 *         → `IONET_WS_SERVER`（WebSocketExternalServer）
 *           → `broadcastNotification` / `sendNotification(userId, ...)`
 *             → 框架 `createNotificationMessage` 补 `kind:'notification'` + `timestamp`
 *               → 该 userId 的全部 OPEN 连接
 *
 * 依赖反转：逻辑服只依赖 `NotificationPort`；本模块提供实现（token: NOTIFICATION_PORT）。
 * 这里只声明外部服的**最小结构**（`EdgeWsServer`），不 import `@nbb-ionet/external-server`
 * 的具体类型——避免把传输层实现细节渗进业务。
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { IONET_WS_SERVER } from '@nbb-ionet/extension-nestjs';
import { type NotificationMessage, type NotificationPort } from '../../common/ports/notification.port.js';

/** ionet WS 外部服务的最小结构（`IONET_WS_SERVER` 的可选注入面）。 */
export interface EdgeWsServer {
  /** 规范化群发：框架统一补 `kind='notification'` 信封（业务不自造形状）。 */
  broadcastNotification(notification: NotificationMessage): void;
  /** 规范化定向推送：至少命中一个 OPEN 连接返回 true，未命中 / 0n 返回 false（不抛错）。 */
  sendNotification(userId: bigint, notification: NotificationMessage): boolean;
  /** 当前连接数（运维 / 健康可见）。 */
  readonly clientCount: number;
}

@Injectable()
export class EdgeService implements NotificationPort {
  private readonly logger = new Logger(EdgeService.name);

  constructor(
    @Optional() @Inject(IONET_WS_SERVER) private readonly wsServer: EdgeWsServer | null,
  ) {}

  broadcast(message: NotificationMessage): void {
    if (!this.wsServer) {
      this.logger.warn('WS 外部服务未启用，广播被丢弃');
      return;
    }
    this.wsServer.broadcastNotification(message);
  }

  sendTo(userId: number, message: NotificationMessage): boolean {
    if (!this.wsServer) return false;
    if (!Number.isSafeInteger(userId) || userId <= 0) return false;
    return this.wsServer.sendNotification(BigInt(userId), message);
  }

  /** 在线连接数（运维 / 健康可见）。 */
  get connectionCount(): number {
    return this.wsServer?.clientCount ?? 0;
  }
}
