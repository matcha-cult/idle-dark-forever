/**
 * AppShell —— 应用外壳骨架（响应式：桌面 `Sider` ↔ 移动端左侧 `Drawer`）。
 *
 * 结构：`Layout` + （桌面）`Sider` / （移动）`Drawer` + 吸顶 `Header` + `Content`。
 * 只负责结构与间距；导航 / HUD / 页头操作全部插槽注入，换导航形态不影响业务代码。
 *
 * 响应式策略（PC 与移动端同时兼容的关键）：
 * - `lg` 及以上：左侧固定 `Sider`（可折叠）；
 * - `lg` 以下：导航收进左侧 `Drawer`，页头出现菜单按钮；
 * - 断点未知（首帧尚未订阅 / SSR）：按**桌面**处理，避免移动端「先桌面后抽屉」闪动；
 * - `mobile` 可显式强制形态（测试与特殊场景用）。
 *
 * 颜色一律取 antd token（禁内联 hex）；不传 `size`（全局 compact 算法已生效）。
 */
import { Button, Drawer, Flex, Grid, Layout, theme } from 'antd';
import { useState, type ReactNode } from 'react';

export interface AppShellProps {
  /** 左侧导航内容（通常传 `SideNav`）。 */
  nav: ReactNode;
  /** 页头左侧区（角色身份 / 品牌）。 */
  header?: ReactNode;
  /** 页头右侧操作区。 */
  headerExtra?: ReactNode;
  /** 页头下方的常驻信息条（通常传 `HudBar`）。 */
  hud?: ReactNode;
  /** 桌面侧栏是否可折叠（默认 true）。 */
  collapsible?: boolean;
  /** 桌面侧栏受控折叠态。 */
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
  siderWidth?: number;
  /** 强制移动端形态；缺省按断点自动判定。 */
  mobile?: boolean;
  children: ReactNode;
}

export function AppShell(props: AppShellProps) {
  const {
    nav,
    header,
    headerExtra,
    hud,
    collapsible = true,
    collapsed,
    onCollapse,
    siderWidth = 208,
    mobile,
    children,
  } = props;
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const breakpointKnown = Object.keys(screens).length > 0;
  const isMobile = mobile ?? (breakpointKnown ? screens.lg !== true : false);
  const hasHeaderRow = header !== undefined || headerExtra !== undefined;

  const navContent = isMobile ? (
    // 抽屉内任意点击（含导航项）都关闭抽屉；必须用**捕获阶段**，
    // 因为 antd `Menu` 的条目点击会 stopPropagation，冒泡处理器收不到。
    <Flex vertical onClickCapture={() => setDrawerOpen(false)}>
      {nav}
    </Flex>
  ) : (
    nav
  );

  return (
    <Layout style={{ minHeight: '100vh' }} data-testid="app-shell-root">
      {isMobile ? (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          // antd v6：Drawer 尺寸用 `size`（number | string），`width` 不再使用
          size={siderWidth + 48}
          closable={false}
          styles={{ body: { padding: 0 } }}
          data-testid="app-shell-drawer"
        >
          {navContent}
        </Drawer>
      ) : (
        <Layout.Sider
          theme="light"
          width={siderWidth}
          collapsible={collapsible}
          {...(collapsed === undefined ? {} : { collapsed })}
          {...(onCollapse === undefined ? {} : { onCollapse })}
          style={{
            position: 'sticky',
            top: 0,
            height: '100vh',
            overflow: 'auto',
            borderInlineEnd: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
          }}
          data-testid="app-shell-sider"
        >
          {navContent}
        </Layout.Sider>
      )}

      <Layout>
        <Layout.Header
          data-testid="app-shell-header"
          style={{
            position: 'sticky',
            top: 0,
            // 吸顶需自带层叠上下文；必须低于 antd 弹层 zIndexPopupBase，避免盖住弹窗
            zIndex: 1,
            height: 'auto',
            lineHeight: 'normal',
            padding: `${token.paddingXS}px ${token.padding}px`,
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Flex vertical gap={token.paddingXS}>
            {hasHeaderRow || isMobile ? (
              <Flex justify="space-between" align="center" wrap gap={token.paddingXS}>
                <Flex align="center" gap={token.paddingXS} style={{ minWidth: 0 }}>
                  {isMobile ? (
                    <Button
                      type="text"
                      aria-label="打开导航"
                      aria-expanded={drawerOpen}
                      data-testid="app-shell-menu-button"
                      onClick={() => setDrawerOpen(true)}
                    >
                      ☰
                    </Button>
                  ) : null}
                  {header}
                </Flex>
                {headerExtra}
              </Flex>
            ) : null}
            {hud}
          </Flex>
        </Layout.Header>

        <Layout.Content
          data-testid="app-shell-content"
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: token.padding,
            background: token.colorBgLayout,
          }}
        >
          {children}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
