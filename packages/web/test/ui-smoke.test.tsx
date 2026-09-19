/**
 * UI 渲染冒烟测试（node 环境，无 jsdom）。
 *
 * 仓库未安装 jsdom / @testing-library，且 `packages/web` 根目录的 vitest 配置不可改，
 * 因此这里用 ui-kit 的 `renderToHtml`（`react-dom/server`）对**空数据**的页面/面板做
 * 「能渲染、不抛错、关键文案在」的冒烟断言。交互行为由 store 层测试覆盖。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { htmlToText, renderToHtml } from '@idle-dark/ui-kit/testing';
import { RootStore } from '../src/app/root-store.js';
import { RootStoreProvider } from '../src/app/root-context.js';
import { ThemeRoot } from '../src/theme/theme-root.js';
import { LoginPage } from '../src/pages/login/LoginPage.js';
import { CharacterCreatePage } from '../src/pages/character/CharacterCreatePage.js';
import { CharacterSelectPage } from '../src/pages/character/CharacterSelectPage.js';
import { GameShellPage } from '../src/pages/game/GameShellPage.js';
import { listPanelKeys, renderPanelContent } from '../src/pages/game/panel-registry.js';
import { createMemoryStorage } from '../src/services/storage.js';

const opened: RootStore[] = [];
afterEach(() => {
  for (const root of opened.splice(0)) root.dispose();
});

function makeRoot(): RootStore {
  const root = new RootStore({
    wsUrl: 'ws://test.local/ws',
    baseUrl: '/api',
    storage: createMemoryStorage(),
    autoRefreshMetricsMs: 0,
  });
  opened.push(root);
  return root;
}

function render(element: ReactElement, root: RootStore): string {
  return renderToHtml(
    <RootStoreProvider value={root}>
      <ThemeRoot>{element}</ThemeRoot>
    </RootStoreProvider>,
  );
}

describe('页面渲染冒烟（空数据）', () => {
  it('登录页可渲染且包含标题与表单', () => {
    const html = render(<LoginPage />, makeRoot());
    const text = htmlToText(html);
    expect(text).toContain('永夜');
    expect(html).toContain('data-testid="login-form"');
  });

  it('建角页可渲染', () => {
    const html = render(<CharacterCreatePage />, makeRoot());
    expect(html).toContain('data-testid="character-create-page"');
  });

  it('选角页在无角色时渲染空列表而不抛错', () => {
    const html = render(<CharacterSelectPage onCreateNew={() => undefined} />, makeRoot());
    const text = htmlToText(html);
    expect(text).toContain('还没有角色');
  });

  it('游戏外壳可渲染（HUD / 导航 / 默认面板）', () => {
    const html = render(<GameShellPage />, makeRoot());
    const text = htmlToText(html);
    expect(html).toContain('data-testid="app-shell-root"');
    expect(html).toContain('data-testid="hud-bar"');
    expect(text).toContain('战斗');
    expect(text).toContain('包裹');
    expect(text).toContain('技能');
    expect(text).toContain('生产');
    expect(text).toContain('故事');
  });

  it('每个注册域的面板都能在空数据下渲染', () => {
    const root = makeRoot();
    for (const key of listPanelKeys()) {
      const html = render(<>{renderPanelContent(key)}</>, root);
      expect(html.length).toBeGreaterThan(0);
      // ErrorBoundary 兜底卡片不应出现（出现说明面板渲染期抛错）
      expect(html).not.toContain('data-testid="error-boundary"');
    }
  });
});
