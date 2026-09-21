/**
 * App —— 顶层门（无 router）。
 *
 * 状态由 `SessionStore` 驱动：
 * - **会话恢复中**（`session.restoring`）→ `RestoringScreen`；
 * - 未登录 → `LoginPage`；
 * - 已登录、账号下没有角色（或用户主动点了「新建角色」）→ `CharacterCreatePage`；
 * - 已登录、有角色但尚未进入 → `CharacterSelectPage`；
 * - 已进入角色 → `GameShellPage`。
 *
 * 刷新页面时 `bootstrap()` 会先拉角色列表、再按本地缓存**自动进入上次的角色**，
 * 因此正常刷新走的是「恢复中 → 游戏」，不再经过选角页。
 *
 * 全局挂载两件容器：`ToastBridge`（ToastStore → antd message）与主题切换
 * （未进游戏时浮在卡片右上角；进游戏后由 HUD 承载）。
 */
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Flex, Spin, Typography } from 'antd';
import { ErrorBoundary } from '@idle-dark/ui-kit';
import { useRootStore } from './root-context.js';
import { ToastBridge } from '../components/ToastBridge.js';
import { LoginPage } from '../pages/login/LoginPage.js';
import { CharacterCreatePage } from '../pages/character/CharacterCreatePage.js';
import { CharacterSelectPage } from '../pages/character/CharacterSelectPage.js';
import { GameShellPage } from '../pages/game/GameShellPage.js';

/**
 * 会话恢复占位。
 *
 * **为什么必须有**：`main.tsx` 里 `void bootstrap()` 与首帧渲染在同一个同步批次，此时
 * `players` 还是空数组 —— 没有它就会先渲染建角页、几十毫秒后再跳走（一次可见的
 * 「错误页面」闪烁）。有了它，「刷新 → 自动回到游戏」是一次连续转场。
 */
function RestoringScreen() {
  return (
    <Flex
      vertical
      align="center"
      justify="center"
      gap={16}
      style={{ minHeight: '60vh' }}
      data-testid="app-restoring"
    >
      <Spin />
      <Typography.Text type="secondary">正在恢复会话…</Typography.Text>
    </Flex>
  );
}

export const App = observer(function App() {
  const root = useRootStore();
  /** 「新建角色」开关：账号已有角色时也能主动去建角页。 */
  const [creating, setCreating] = useState(false);
  const authed = root.session.isAuthenticated;
  const hasPlayers = root.session.hasPlayers;
  // 恢复期间**不**按「有没有角色」分流：那时的空 `players` 只代表「还没拉回来」。
  const restoring = authed && root.session.restoring;

  const content = !authed ? (
    <LoginPage />
  ) : restoring ? (
    <RestoringScreen />
  ) : creating || !hasPlayers ? (
    <CharacterCreatePage {...(hasPlayers ? { onCancel: () => setCreating(false) } : {})} />
  ) : !root.session.hasCharacter ? (
    <CharacterSelectPage onCreateNew={() => setCreating(true)} />
  ) : (
    // 开发中的页面一律包 ErrorBoundary：模块级/渲染期异常会把整棵树卸载成白屏，
    // 包一层后白屏变成一张可复制、可诊断的错误卡片（panel-registry 另对每个域各包一层）。
    <ErrorBoundary title="游戏外壳渲染出错（把这张卡片的内容发给我即可定位）">
      <GameShellPage />
    </ErrorBoundary>
  );

  return (
    <div className={authed ? 'app app--game' : 'app'}>
      <ToastBridge />
      {content}
    </div>
  );
});
