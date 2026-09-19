/**
 * vitest 的 jsdom 前置：补齐 jsdom 缺失的浏览器 API。
 *
 * antd 的响应式（`Grid.useBreakpoint`）完全依赖 `matchMedia`，jsdom 没有实现，
 * 不补桩会导致任何用到断点的组件直接抛错。
 */

type Listener = (event: MediaQueryListEvent) => void;

class MockMediaQueryList implements MediaQueryList {
  matches = false;
  media: string;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(query: string) {
    this.media = query;
    this.matches = evaluate(query);
  }

  addEventListener(_type: 'change', listener: Listener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'change', listener: Listener): void {
    this.listeners.delete(listener);
  }

  addListener(listener: Listener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: Listener): void {
    this.listeners.delete(listener);
  }

  dispatchEvent(): boolean {
    return true;
  }

  /** 由测试工具在改变视口宽度后调用，用于模拟断点变化。 */
  notify(): void {
    this.matches = evaluate(this.media);
    const event = { matches: this.matches, media: this.media } as MediaQueryListEvent;
    for (const listener of this.listeners) listener(event);
    this.onchange?.call(this as unknown as MediaQueryList, event);
  }
}

/** 极简的 `(min-width: Npx)` / `(max-width: Npx)` 求值；其他查询一律 false。 */
function evaluate(query: string): boolean {
  const width = (globalThis as { __mockViewportWidth?: number }).__mockViewportWidth ?? 1440;
  const min = /min-width:\s*(\d+)px/.exec(query);
  if (min) return width >= Number(min[1]);
  const max = /max-width:\s*(\d+)px/.exec(query);
  if (max) return width <= Number(max[1]);
  return false;
}

const registry = new Set<MockMediaQueryList>();

export function installViewportMock(): void {
  (globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => {
    const mql = new MockMediaQueryList(query);
    registry.add(mql);
    return mql;
  };
}

export function setViewportWidth(width: number): void {
  (globalThis as { __mockViewportWidth?: number }).__mockViewportWidth = width;
  for (const mql of registry) mql.notify();
  globalThis.dispatchEvent(new Event('resize'));
}

export function resetViewport(): void {
  registry.clear();
  (globalThis as { __mockViewportWidth?: number }).__mockViewportWidth = undefined;
}

installViewportMock();
