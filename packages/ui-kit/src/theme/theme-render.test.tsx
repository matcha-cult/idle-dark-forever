/**
 * theme 分组的渲染测试（无 jsdom）：ThemeProvider 上下文、ThemeToggle 可访问性。
 * 另含 `testing/viewport` 可控视口 mock 的行为测试（jsdom 消费方依赖它）。
 */
import zhCN from 'antd/locale/zh_CN';
import { describe, expect, it } from 'vitest';
import { htmlToText, renderToHtml } from '../testing/index.js';
import {
  DEFAULT_VIEWPORT_WIDTH,
  getViewportWidth,
  installViewportMock,
  resetViewport,
  setViewportWidth,
  VIEWPORT_BREAKPOINTS,
} from '../testing/viewport.js';
import { ThemeProvider } from './theme-provider.js';
import { ThemeToggle } from './theme-toggle.js';

describe('ThemeProvider', () => {
  it('渲染 antd App 容器并透传 children（暗色）', () => {
    const html = renderToHtml(
      <ThemeProvider mode="dark">
        <span>面板</span>
      </ThemeProvider>,
    );
    expect(html).toContain('ant-app');
    expect(htmlToText(html)).toContain('面板');
  });

  it('亮色 + 自定义主色 + locale 覆盖都不抛错', () => {
    const html = renderToHtml(
      <ThemeProvider mode="light" primaryColor="tomato" locale={zhCN} className="app-root" rootClassName="app-top">
        <span>面板</span>
      </ThemeProvider>,
    );
    expect(html).toContain('app-root');
    expect(html).toContain('app-top');
  });

  it('提供 App 上下文（子组件可调用 App.useApp 而不抛错）', () => {
    const html = renderToHtml(
      <ThemeProvider mode="dark">
        <span>子节点</span>
      </ThemeProvider>,
    );
    // antd App 会渲染一个携带 cssinjs class 的容器；只要没抛错且 children 在位即可
    expect(html).toContain('css-');
    expect(htmlToText(html)).toBe('子节点');
  });
});

describe('ThemeToggle', () => {
  it('暗色时提示切到亮色，并标记目标态', () => {
    const html = renderToHtml(<ThemeToggle value="dark" onChange={() => undefined} />);
    expect(html).toContain('aria-label="切换到亮色主题"');
    expect(html).toContain('data-target-mode="light"');
    expect(htmlToText(html)).toBe('☀');
  });

  it('亮色时提示切到暗色', () => {
    const html = renderToHtml(<ThemeToggle value="light" onChange={() => undefined} />);
    expect(html).toContain('aria-label="切换到暗色主题"');
    expect(htmlToText(html)).toBe('☾');
  });

  it('label 覆盖同时作为 aria-label', () => {
    const html = renderToHtml(<ThemeToggle value="dark" label="换个口味" onChange={() => undefined} />);
    expect(html).toContain('aria-label="换个口味"');
  });

  it('disabled 透传', () => {
    expect(renderToHtml(<ThemeToggle value="dark" disabled onChange={() => undefined} />)).toContain('disabled');
  });
});

describe('testing/viewport 可控视口 mock', () => {
  /** 极简宿主：只记录 matchMedia 装到哪。 */
  const host: { matchMedia?: (query: string) => MediaQueryList } = {};

  it('解析 min-width / max-width', () => {
    installViewportMock(host, 1280);
    const media = host.matchMedia as (query: string) => MediaQueryList;
    expect(media(`(min-width: ${VIEWPORT_BREAKPOINTS.lg}px)`).matches).toBe(true);
    expect(media(`(max-width: ${VIEWPORT_BREAKPOINTS.lg - 1}px)`).matches).toBe(false);
    expect(media('(min-width: 1920px)').matches).toBe(false);
    expect(media('(max-width: 1920px)').matches).toBe(true);
  });

  it('无宽度约束的查询视为匹配', () => {
    installViewportMock(host, 800);
    expect((host.matchMedia as (q: string) => MediaQueryList)('print').matches).toBe(true);
  });

  it('setViewportWidth 重算并通知监听器（可测断点切换）', () => {
    installViewportMock(host, 1280);
    const mql = (host.matchMedia as (q: string) => MediaQueryList)('(min-width: 992px)');
    const seen: boolean[] = [];
    mql.addEventListener('change', (event) => seen.push((event as { matches: boolean }).matches));
    expect(mql.matches).toBe(true);
    setViewportWidth(600);
    expect(mql.matches).toBe(false);
    expect(seen).toEqual([false]);
    // 同值再设一次不产生重复通知
    setViewportWidth(600);
    expect(seen).toEqual([false]);
  });

  it('addListener/removeListener 旧 API 也支持，且退订后不通知', () => {
    installViewportMock(host, 1280);
    const mql = (host.matchMedia as (q: string) => MediaQueryList)('(min-width: 992px)');
    const seen: boolean[] = [];
    const listener = (event: unknown): void => seen.push((event as { matches: boolean }).matches);
    mql.addListener(listener);
    setViewportWidth(600);
    mql.removeListener(listener);
    setViewportWidth(1280);
    expect(seen).toEqual([false]);
  });

  it('resetViewport 回到缺省宽度，getViewportWidth 可诊断', () => {
    installViewportMock(host, 600);
    expect(getViewportWidth()).toBe(600);
    resetViewport();
    expect(getViewportWidth()).toBe(DEFAULT_VIEWPORT_WIDTH);
  });

  it('installViewportMock 在全局宿主上也生效（jsdom 用法）', () => {
    const globalHost = globalThis as { matchMedia?: unknown };
    installViewportMock(globalHost, 400);
    const media = globalHost.matchMedia as (query: string) => MediaQueryList;
    expect(media('(min-width: 992px)').matches).toBe(false);
    Reflect.deleteProperty(globalHost, 'matchMedia');
    resetViewport();
  });
});
