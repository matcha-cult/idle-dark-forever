/**
 * ThemeRoot —— 把 `ThemeStore` 的态接到 ui-kit 的 `ThemeProvider`。
 *
 * 位置要求：必须在 `RootStoreProvider` 之内、`App` 之外（要读 store，又要包住整棵树）。
 *
 * 主题持久化的唯一真相是 `theme/theme-store.ts`（键 `idle-dark:theme`，与 `index.html`
 * 的防闪烁内联脚本一致）；ui-kit 自带的 `createThemeStore` 键名不同且不被本应用使用 ——
 * `ThemeProvider` 本身是**受控无状态**的，因此不会产生两套主题真相。
 */
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { ThemeProvider, ThemeToggle } from '@idle-dark/ui-kit';
import { useRootStore } from '../app/root-context.js';

export interface ThemeRootProps {
  children: ReactNode;
}

export const ThemeRoot = observer(function ThemeRoot({ children }: ThemeRootProps) {
  const { theme } = useRootStore();
  return (
    <ThemeProvider mode={theme.mode} className="app-root">
      {children}
    </ThemeProvider>
  );
});

/** 悬浮/内联主题切换按钮（未进游戏时也可用）。 */
export const AppThemeToggle = observer(function AppThemeToggle() {
  const { theme } = useRootStore();
  return <ThemeToggle value={theme.mode} onChange={(mode) => theme.setMode(mode)} />;
});
