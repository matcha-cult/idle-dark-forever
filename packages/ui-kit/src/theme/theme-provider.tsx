/**
 * ThemeProvider —— antd 主题 + 中文化 + 反馈上下文的统一包装（纯展示，受控）。
 *
 * 只做三件事：`ConfigProvider`（theme / locale）→ antd `App`
 * （提供 `message` / `notification` / `modal` 的 `App.useApp()` 上下文）。
 * 业务应用**禁止**再自行包一层 ConfigProvider，也禁止使用静态 `message.*` /
 * `Modal.confirm`（脱离上下文会导致主题与 locale 失效，门禁测试强制）。
 *
 * 受控：`mode` 由外部（通常是 `theme-store`）注入，本组件不持有任何状态。
 */
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';
import { buildThemeConfig } from './build-theme-config.js';
import type { ThemeMode } from './types.js';

export interface ThemeProviderProps {
  /** 主题态（受控：light / dark）。 */
  mode: ThemeMode;
  /** 覆盖主色；缺省用 antd seed 的 `colorPrimary`。 */
  primaryColor?: string;
  /** antd locale，缺省中文（zh_CN）。 */
  locale?: typeof zhCN;
  /** 传给 antd `App` 容器的 class（布局用）。 */
  className?: string;
  /** 传给 antd `App` 最外层的 class。 */
  rootClassName?: string;
  children: ReactNode;
}

export function ThemeProvider(props: ThemeProviderProps) {
  const { mode, primaryColor, locale, className, rootClassName, children } = props;
  const themeConfig = buildThemeConfig(primaryColor === undefined ? { mode } : { mode, primaryColor });
  return (
    <ConfigProvider theme={themeConfig} locale={locale ?? zhCN}>
      <AntApp className={className} rootClassName={rootClassName}>
        {children}
      </AntApp>
    </ConfigProvider>
  );
}
