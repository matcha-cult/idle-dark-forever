/**
 * UI 渲染冒烟测试（node 环境，无 jsdom）。
 *
 * 仓库未安装 jsdom / @testing-library，且 `packages/web` 根目录的 vitest 配置不可改，
 * 因此这里用 ui-kit 的 `renderToHtml`（`react-dom/server`）对**空数据**的页面/面板做
 * 「能渲染、不抛错、关键文案在」的冒烟断言。交互行为由 store 层测试覆盖。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { runInAction } from 'mobx';
import { WORLD_CMD } from '@idle-dark/protocol';
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

/**
 * ⚠️ 这一段是**回归防护**，起因是一次真实事故：
 * 上面的「空数据」冒烟**抓不到**只在「有数据分支」里执行的代码 ——
 * `BattlePanel` 把地图列表写在 `world.maps.length === 0 ? … : （地图卡片）` 的
 * **非空分支**里，所以空数据时那条分支根本不求值。当时该分支引用了一个未定义的
 * `unlockedCount`，冒烟测试全绿，但真实浏览器一进战斗页就 `ReferenceError`。
 *
 * 教训：面板的冒烟**必须覆盖有数据的分支**，否则「能渲染」是假象。
 */
describe('页面渲染冒烟（有数据，防空分支假绿）', () => {
  const HOME = {
    key: 'home',
    name: '自宅',
    level: 0,
    lockedReason: null,
    unlocked: true,
    hint: '安全的避难所',
  } as const;
  const STREET = {
    key: 'town.street',
    name: '村间小路',
    level: 1,
    lockedReason: null,
    unlocked: true,
  } as const;
  const CAVE = {
    key: 'town.cave',
    name: '洞穴',
    level: 3,
    lockedReason: '尚未满足进入条件',
    unlocked: false,
  } as const;

  function seed(maps: unknown[], map = 'home'): RootStore {
    const root = makeRoot();
    runInAction(() => {
      // ⚠️ `maps` 与 `snapshot` 是两个字段（真实链路里由 `applySnapshot` 同步），
      // 只设 `snapshot` 不会更新面板读的 `maps`。
      root.world.maps = maps as never;
      root.world.snapshot = {
        map,
        units: [],
        maps: maps as never,
        updateRate: 1,
        paused: false,
      };
    });
    return root;
  }

  it('战斗面板在地图非空时可渲染（含可进入与锁定两类）', () => {
    const root = seed([HOME, STREET, CAVE]);
    const html = render(<>{renderPanelContent('battle')}</>, root);
    const text = htmlToText(html);

    expect(html).not.toContain('data-testid="error-boundary"');
    expect(text).toContain('村间小路');
    expect(text).toContain('可进入 2 / 3 张');
    // 默认只显示可进入的 → 锁定的那张不渲染
    expect(text).not.toContain('洞穴');
  });

  it('全部地图都锁定时给出指引而不是一片空白', () => {
    const root = seed([CAVE]);
    const text = htmlToText(render(<>{renderPanelContent('battle')}</>, root));
    expect(text).toContain('可进入 0 / 1 张');
    expect(text).toContain('提升等级可解锁新地图');
  });

  /** 灌一帧真实 tick（`bossPending` 只能经服务端下发进入 store）。 */
  function pushTick(root: RootStore, data: Record<string, unknown>): void {
    runInAction(() => {
      root.world.handleNotification({ cmd: WORLD_CMD.cmd, subCmd: WORLD_CMD.tick, data });
    });
  }

  it('守关 BOSS 倒计时：bossPending=true 时显示', () => {
    const root = seed([HOME, STREET]);
    pushTick(root, {
      serverTime: 1, units: [], events: [], gainedExp: 0, gainedGold: 0,
      wave: 2, bossEvery: 20, bossPending: true,
    });
    const text = htmlToText(render(<>{renderPanelContent('battle')}</>, root));
    expect(text).toContain('波次 2');
    expect(text).toContain('距守关 BOSS 18 波');
  });

  it('守关 BOSS 倒计时：bossPending=false（通关后不再刷）时整条不显示', () => {
    const root = seed([HOME, STREET]);
    pushTick(root, {
      serverTime: 1, units: [], events: [], gainedExp: 0, gainedGold: 0,
      wave: 2, bossEvery: 20, bossPending: false,
    });
    const html = render(<>{renderPanelContent('battle')}</>, root);
    const text = htmlToText(html);
    expect(text).toContain('波次 2');
    expect(text).not.toContain('距守关 BOSS');
    expect(html).not.toContain('data-testid="battle-boss"');
  });

  it('守关 BOSS 倒计时：BOSS 波但已通关 → 也不显示「现身」', () => {
    const root = seed([HOME, STREET]);
    pushTick(root, {
      serverTime: 1, units: [], events: [], gainedExp: 0, gainedGold: 0,
      wave: 20, bossEvery: 20, bossPending: false,
    });
    const text = htmlToText(render(<>{renderPanelContent('battle')}</>, root));
    expect(text).not.toContain('守关 BOSS 现身');
  });
});
