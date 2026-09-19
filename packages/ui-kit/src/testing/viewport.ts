/**
 * 测试用**可控视口**（jsdom 没有真实布局，antd 的响应式全靠 `matchMedia`）。
 *
 * 为什么需要：`Grid.useBreakpoint()` / `Sider.breakpoint` / `Drawer` 全都读
 * `window.matchMedia`，而 jsdom 不实现它；若只返回 `matches:false`，所有响应式分支
 * 都会落到「手机」，组件测试就失去了意义（PC/移动两套布局都要能断言）。
 *
 * 能力：
 * - 解析 `(min-width: Npx)` / `(max-width: Npx)` 查询；
 * - `installViewportMock(host, width)` 安装 mock（默认 **1280**，即桌面）；
 * - `setViewportWidth(px)` 改宽度并**通知已注册的监听器**，可测断点切换；
 * - `resetViewport()` 复位为默认宽度。
 *
 * 本文件不 import 任何 DOM 全局，可在 node 环境安全加载（`host` 由调用方传入，
 * 通常传 `window`）。不是测试文件，参与 tsc 类型检查。
 */

/** 默认视口宽度（桌面）。 */
export const DEFAULT_VIEWPORT_WIDTH = 1280;

/** 断点 → 最小宽度（对齐 antd 的 `xs..xxxl`，供消费方断言布局用）。 */
export const VIEWPORT_BREAKPOINTS = {
  xs: 480,
  sm: 576,
  md: 768,
  lg: 992,
  xl: 1200,
  xxl: 1600,
  xxxl: 1920,
} as const;

interface MediaQueryListLike {
  matches: boolean;
  media: string;
  onchange: ((event: { matches: boolean; media: string }) => void) | null;
  addListener(listener: (event: unknown) => void): void;
  removeListener(listener: (event: unknown) => void): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  dispatchEvent(): boolean;
}

let viewportWidth = DEFAULT_VIEWPORT_WIDTH;
const registered = new Set<MockMediaQueryList>();

/** 解析 `(min-width: Npx)` / `(max-width: Npx)`；无匹配约束时视为 true。 */
function matchesQuery(query: string, width: number): boolean {
  const min = /\(min-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query);
  const max = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query);
  let result = true;
  if (min !== null) result = result && width >= Number(min[1]);
  if (max !== null) result = result && width <= Number(max[1]);
  return result;
}

class MockMediaQueryList implements MediaQueryListLike {
  onchange: ((event: { matches: boolean; media: string }) => void) | null = null;
  matches: boolean;
  private readonly listeners = new Set<(event: unknown) => void>();

  constructor(readonly media: string) {
    this.matches = matchesQuery(media, viewportWidth);
    registered.add(this);
  }

  addListener(listener: (event: unknown) => void): void {
    this.listeners.add(listener);
  }

  removeListener(listener: (event: unknown) => void): void {
    this.listeners.delete(listener);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    if (type === 'change') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    if (type === 'change') this.listeners.delete(listener);
  }

  dispatchEvent(): boolean {
    return true;
  }

  /** 仅供 mock 内部：宽度变化时重算并通知。 */
  refresh(): void {
    const next = matchesQuery(this.media, viewportWidth);
    if (next === this.matches) return;
    this.matches = next;
    const event = { matches: next, media: this.media };
    this.onchange?.(event);
    for (const listener of this.listeners) listener(event);
  }
}

/** 安装可控 matchMedia（幂等；重复调用只更新宽度）。 */
export function installViewportMock(host: unknown = globalThis, width = DEFAULT_VIEWPORT_WIDTH): void {
  viewportWidth = width;
  Object.defineProperty(host as object, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryListLike => new MockMediaQueryList(query),
  });
}

/** 改变视口宽度并通知监听器（用于断言跨断点的布局切换）。 */
export function setViewportWidth(width: number): void {
  viewportWidth = width;
  for (const mql of registered) mql.refresh();
}

/** 复位为默认宽度。 */
export function resetViewport(): void {
  setViewportWidth(DEFAULT_VIEWPORT_WIDTH);
}

/** 当前视口宽度（诊断用）。 */
export function getViewportWidth(): number {
  return viewportWidth;
}
