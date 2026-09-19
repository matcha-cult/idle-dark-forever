/**
 * `@idle-dark/ui-kit/testing` —— 仅测试基础设施（不参与运行时，也不进主 barrel）。
 *
 * 两个用途：
 * 1. **jsdom 消费方**（web 包）：在 vitest setup 里调用 `installViewportMock(window)`，
 *    补齐 jsdom 缺失的 `matchMedia` / `ResizeObserver`（antd 响应式与虚拟滚动依赖它们）；
 * 2. **无 jsdom 的消费方**（本包自身）：用 `renderToHtml` 走 `react-dom/server`，
 *    在不新增依赖的前提下对组件做渲染断言。
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export {
  DEFAULT_VIEWPORT_WIDTH,
  VIEWPORT_BREAKPOINTS,
  getViewportWidth,
  installViewportMock,
  resetViewport,
  setViewportWidth,
} from './viewport.js';
export { makeSlot, makeUnit, resetFixtureSeed } from './fixtures.js';

/**
 * 把 React 元素渲染成 HTML 字符串（无 DOM 依赖，node 环境可用）。
 *
 * 为什么不是 `renderToString`：`renderToString` 会在服务端为 `useLayoutEffect`
 * 打印告警并注入 hydration 标记；断言用的静态标记更干净、更稳定。
 * 注意：SSR **不执行 effect**，因此依赖 `useEffect` 的行为（如自动滚底）需在
 * 有 DOM 的环境里验证。
 */
export function renderToHtml(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/** 从 HTML 字符串里取纯文本（用于「文案是否存在」这类断言）。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 补齐 jsdom 缺失的 `ResizeObserver`（antd 虚拟滚动 / rc-* 测量依赖）。 */
export function installResizeObserverMock(host: unknown = globalThis): void {
  const target = host as { ResizeObserver?: unknown };
  if (target.ResizeObserver !== undefined) return;
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(host as object, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
}
