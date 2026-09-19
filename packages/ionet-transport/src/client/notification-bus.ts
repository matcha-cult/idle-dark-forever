/**
 * 通知（推送）总线 —— `kind === 'notification'` 的帧**只**从这里分发，
 * 绝不进入响应配对（PROTOCOL.md §5 分流铁律）。
 *
 * 分发维度（可叠加，同一 handler 只调用一次）：
 * - 全量订阅：`subscribe(handler)`；
 * - 路由订阅：`subscribeRoute(cmd, subCmd, handler)`（推送帧带 cmd/subCmd 时）；
 * - 事件名订阅：`subscribeType(type, handler)`（推送帧带 type 时）。
 *
 * **隔离保证**：单个订阅者抛错不得影响其他订阅者 —— 每个 handler 独立 try/catch，
 * 异常交给 `onError`（默认吞掉，不污染调用栈）。
 */
import type { NotificationMessage } from '@nbb-ionet/client-protocol';
import type { Unsubscribe } from '../transport/socket-adapter.js';

export type NotificationHandler = (notification: NotificationMessage) => void;

/** 订阅者抛错时的回调（未提供时静默忽略，保证分发不中断）。 */
export type NotificationErrorHandler = (error: unknown, notification: NotificationMessage) => void;

function routeKey(cmd: number, subCmd: number): string {
  return `${cmd}:${subCmd}`;
}

export class NotificationBus {
  private readonly allHandlers = new Set<NotificationHandler>();
  private readonly routeHandlers = new Map<string, Set<NotificationHandler>>();
  private readonly typeHandlers = new Map<string, Set<NotificationHandler>>();
  private errorHandler: NotificationErrorHandler | undefined;

  constructor(options: { onError?: NotificationErrorHandler } = {}) {
    this.errorHandler = options.onError;
  }

  /** 设置/替换订阅者异常回调。 */
  setErrorHandler(handler: NotificationErrorHandler | undefined): void {
    this.errorHandler = handler;
  }

  /** 订阅全部推送。 */
  subscribe(handler: NotificationHandler): Unsubscribe {
    this.allHandlers.add(handler);
    return () => {
      this.allHandlers.delete(handler);
    };
  }

  /** 订阅指定 `(cmd, subCmd)` 路由的推送。 */
  subscribeRoute(cmd: number, subCmd: number, handler: NotificationHandler): Unsubscribe {
    const key = routeKey(cmd, subCmd);
    let handlers = this.routeHandlers.get(key);
    if (handlers === undefined) {
      handlers = new Set<NotificationHandler>();
      this.routeHandlers.set(key, handlers);
    }
    handlers.add(handler);
    return () => {
      const set = this.routeHandlers.get(key);
      if (set === undefined) return;
      set.delete(handler);
      if (set.size === 0) this.routeHandlers.delete(key);
    };
  }

  /** 订阅指定 `type` 的推送。 */
  subscribeType(type: string, handler: NotificationHandler): Unsubscribe {
    let handlers = this.typeHandlers.get(type);
    if (handlers === undefined) {
      handlers = new Set<NotificationHandler>();
      this.typeHandlers.set(type, handlers);
    }
    handlers.add(handler);
    return () => {
      const set = this.typeHandlers.get(type);
      if (set === undefined) return;
      set.delete(handler);
      if (set.size === 0) this.typeHandlers.delete(type);
    };
  }

  /** 分发给全部命中订阅者；逐个 try/catch，互不影响。 */
  publish(notification: NotificationMessage): void {
    const targets = new Set<NotificationHandler>(this.allHandlers);
    if (typeof notification.cmd === 'number' && typeof notification.subCmd === 'number') {
      const byRoute = this.routeHandlers.get(routeKey(notification.cmd, notification.subCmd));
      if (byRoute !== undefined) for (const handler of byRoute) targets.add(handler);
    }
    if (typeof notification.type === 'string') {
      const byType = this.typeHandlers.get(notification.type);
      if (byType !== undefined) for (const handler of byType) targets.add(handler);
    }
    for (const handler of targets) {
      try {
        handler(notification);
      } catch (error) {
        this.errorHandler?.(error, notification);
      }
    }
  }

  /** 订阅者总数（观测用）。 */
  get subscriberCount(): number {
    let count = this.allHandlers.size;
    for (const set of this.routeHandlers.values()) count += set.size;
    for (const set of this.typeHandlers.values()) count += set.size;
    return count;
  }

  /** 清空全部订阅（连接关闭时不需要，交给调用方决定）。 */
  clear(): void {
    this.allHandlers.clear();
    this.routeHandlers.clear();
    this.typeHandlers.clear();
  }
}
