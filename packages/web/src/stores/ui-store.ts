/**
 * UiStore —— 外壳（Shell）的 UI 状态。
 *
 * 为什么它必须是一个 Store 而不是 `GameShellPage` 的局部 state：
 * 面板切换除了「玩家点导航」之外，还有**推送驱动**的来源 ——
 * 例如进图自动播放剧情要跳到「故事」面板，玩家此刻多半在「战斗」面板。
 * 把当前面板提升为单一真相后，任意域 Store 都能通过 `ctx.root().ui` 发起跳转。
 *
 * 只放**纯 UI** 状态；任何业务数值都不允许出现在这里（服务端权威）。
 */
import { makeAutoObservable } from 'mobx';

export class UiStore {
  /** 当前面板 key；`null` = 尚未选择，由外壳取 `panel-registry` 的默认值。 */
  activePanelKey: string | null = null;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  /** 切换面板（空 key 忽略；非法 key 由注册表在渲染时兜底）。 */
  setActivePanel(key: string): void {
    if (typeof key !== 'string' || key === '') return;
    this.activePanelKey = key;
  }

  /** 回到默认面板（切换角色 / 退出登录时调用）。 */
  reset(): void {
    this.activePanelKey = null;
  }
}
