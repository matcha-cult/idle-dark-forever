/**
 * App —— 顶层三态门（无 router）。
 *
 * 状态由 `SessionStore` 驱动：
 * - 未登录 → `LoginPage`；
 * - 已登录、账号下没有角色（或用户主动点了「新建角色」）→ `CharacterCreatePage`；
 * - 已登录、有角色但尚未进入 → `CharacterSelectPage`；
 * - 已进入角色 → `GameShellPage`。
 *
 * 全局挂载两件容器：`ToastBridge`（ToastStore → antd message）与主题切换
 * （未进游戏时浮在卡片右上角；进游戏后由 HUD 承载）。
 */
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { ErrorBoundary } from '@idle-dark/ui-kit';
import { useRootStore } from './root-context.js';
import { ToastBridge } from '../components/ToastBridge.js';
import { LoginPage } from '../pages/login/LoginPage.js';
import { CharacterCreatePage } from '../pages/character/CharacterCreatePage.js';
import { CharacterSelectPage } from '../pages/character/CharacterSelectPage.js';
import { GameShellPage } from '../pages/game/GameShellPage.js';

export const App = observer(function App() {
  const root = useRootStore();
  /** 「新建角色」开关：账号已有角色时也能主动去建角页。 */
  const [creating, setCreating] = useState(false);
  const authed = root.session.isAuthenticated;
  const hasPlayers = root.session.hasPlayers;

  const content = !authed ? (
    <LoginPage />
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
