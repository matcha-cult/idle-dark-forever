/**
 * 推送路由总线：服务端 `kind='notification'` 帧按 `(cmd, subCmd)` 或 `type` 分发。
 *
 * 与请求流水线完全隔离：请求只消费 `kind='response'` 的帧（由 transport 层分流），
 * 本总线只处理推送，且**不解释载荷语义** —— 那是各域 Store 的 `handleNotification`。
 *
 * 依赖面刻意收窄为结构类型 `PushFrame`（不是 transport 的类）：传输层的信封类型可以演进，
 * 而路由只关心「有没有 cmd/subCmd、有没有 type」。仓库内没有任何一处手写 `'notification'`
 * 字面量（判别在 transport 的 `classifyFrame` 里）。
 */

/** 推送帧的最小结构面。 */
export interface PushFrame {
  kind?: string;
  cmd?: number;
  subCmd?: number;
  type?: string;
  data?: unknown;
  timestamp?: number;
}

export type NotificationHandler = (notification: PushFrame) => void;
export type Unsubscribe = () => void;

function keyOf(cmd: number, subCmd: number): string {
  return `${cmd}:${subCmd}`;
}

export class NotificationBus {
  private readonly byRoute = new Map<string, Set<NotificationHandler>>();
  private readonly byType = new Map<string, Set<NotificationHandler>>();
  private readonly wildcard = new Set<NotificationHandler>();

  /** 订阅 `(cmd, subCmd)` 路由的推送（如 (30,5) 世界 tick）。 */
  on(cmd: number, subCmd: number, handler: NotificationHandler): Unsubscribe {
    const key = keyOf(cmd, subCmd);
    let set = this.byRoute.get(key);
    if (set === undefined) {
      set = new Set();
      this.byRoute.set(key, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  /** 订阅 `{type}` 形式的推送（与 cmd/subCmd 编码体系并列，容错旧式信封）。 */
  onType(type: string, handler: NotificationHandler): Unsubscribe {
    let set = this.byType.get(type);
    if (set === undefined) {
      set = new Set();
      this.byType.set(type, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  /** 订阅全部推送（域路由 / 诊断用）。 */
  onAny(handler: NotificationHandler): Unsubscribe {
    this.wildcard.add(handler);
    return () => this.wildcard.delete(handler);
  }

  /** 分发一帧。`(cmd,subCmd)` 与 `type` 命中**同时**生效；单订阅者异常不影响其它订阅者。 */
  dispatch(notification: PushFrame): void {
    const handlers = new Set<NotificationHandler>(this.wildcard);
    if (typeof notification.cmd === 'number' && typeof notification.subCmd === 'number') {
      for (const handler of this.byRoute.get(keyOf(notification.cmd, notification.subCmd)) ?? []) {
        handlers.add(handler);
      }
    }
    if (typeof notification.type === 'string' && notification.type.length > 0) {
      for (const handler of this.byType.get(notification.type) ?? []) handlers.add(handler);
    }
    for (const handler of handlers) {
      try {
        handler(notification);
      } catch (error) {
        console.error('[NotificationBus] handler error', error);
      }
    }
  }

  clear(): void {
    this.byRoute.clear();
    this.byType.clear();
    this.wildcard.clear();
  }
}
