/**
 * 生命周期感知：移动浏览器切后台会冻结/掐断 WS，
 * `visibilitychange` + `navigator.onLine` 事件全部接入，让 SDK 主动断开/重连，而不是被动等死链。
 *
 * 与 DOM 的耦合全部收敛在本文件：核心 client 只依赖 `LifecycleAdapter` 接口，
 * Node/测试环境注入 `NoopLifecycleAdapter`。
 */
import type { Unsubscribe } from '../transport/socket-adapter.js';

export interface LifecycleAdapter {
  /** 页面可见性变化：`hidden === true` 表示进入后台。 */
  onVisibilityChange(handler: (hidden: boolean) => void): Unsubscribe;
  onOnline(handler: () => void): Unsubscribe;
  onOffline(handler: () => void): Unsubscribe;
  /** 当前是否处于后台（无 document 环境恒为 false）。 */
  isHidden(): boolean;
}

/** 无生命周期事件的环境（Node / 测试）使用。 */
export class NoopLifecycleAdapter implements LifecycleAdapter {
  onVisibilityChange(): Unsubscribe {
    return () => undefined;
  }
  onOnline(): Unsubscribe {
    return () => undefined;
  }
  onOffline(): Unsubscribe {
    return () => undefined;
  }
  isHidden(): boolean {
    return false;
  }
}

/** 可手动驱动的生命周期（测试 / 无 DOM 宿主）。 */
export class ManualLifecycleAdapter implements LifecycleAdapter {
  private hidden = false;
  private readonly visibilityHandlers = new Set<(hidden: boolean) => void>();
  private readonly onlineHandlers = new Set<() => void>();
  private readonly offlineHandlers = new Set<() => void>();

  onVisibilityChange(handler: (hidden: boolean) => void): Unsubscribe {
    this.visibilityHandlers.add(handler);
    return () => this.visibilityHandlers.delete(handler);
  }

  onOnline(handler: () => void): Unsubscribe {
    this.onlineHandlers.add(handler);
    return () => this.onlineHandlers.delete(handler);
  }

  onOffline(handler: () => void): Unsubscribe {
    this.offlineHandlers.add(handler);
    return () => this.offlineHandlers.delete(handler);
  }

  isHidden(): boolean {
    return this.hidden;
  }

  // ===== 测试驱动面 =====

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const handler of this.visibilityHandlers) handler(hidden);
  }

  emitOnline(): void {
    for (const handler of this.onlineHandlers) handler();
  }

  emitOffline(): void {
    for (const handler of this.offlineHandlers) handler();
  }
}

/** 浏览器实现：`document.visibilitychange` + `window`/`navigator` 的 online/offline。 */
export class BrowserLifecycleAdapter implements LifecycleAdapter {
  constructor(
    private readonly doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | undefined =
      typeof document === 'undefined' ? undefined : document,
    private readonly win:
      | (Pick<Window, 'addEventListener' | 'removeEventListener'> & { navigator?: Navigator })
      | undefined = typeof window === 'undefined' ? undefined : window,
  ) {}

  onVisibilityChange(handler: (hidden: boolean) => void): Unsubscribe {
    if (!this.doc) return () => undefined;
    const listener = (): void => handler(this.isHidden());
    this.doc.addEventListener('visibilitychange', listener);
    return () => this.doc?.removeEventListener('visibilitychange', listener);
  }

  onOnline(handler: () => void): Unsubscribe {
    if (!this.win) return () => undefined;
    this.win.addEventListener('online', handler);
    return () => this.win?.removeEventListener('online', handler);
  }

  onOffline(handler: () => void): Unsubscribe {
    if (!this.win) return () => undefined;
    this.win.addEventListener('offline', handler);
    return () => this.win?.removeEventListener('offline', handler);
  }

  isHidden(): boolean {
    return this.doc?.visibilityState === 'hidden';
  }
}

/** 按环境自动选择：有 `document` 用浏览器实现，否则 Noop。 */
export function defaultLifecycleAdapter(): LifecycleAdapter {
  return typeof document === 'undefined' ? new NoopLifecycleAdapter() : new BrowserLifecycleAdapter();
}
