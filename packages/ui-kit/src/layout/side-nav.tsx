/**
 * SideNav —— 侧边导航（**配置驱动**，接收 `items`）。
 *
 * 只渲染 `Menu`，不含 `Sider` / 折叠控制（那是 `AppShell` 的职责），因此同一份
 * `items` 配置可以同时喂给侧栏、抽屉与顶栏三种形态。
 *
 * 分组规则：`items` 里连续若干项带同一个 `group` 时聚成一个 `Menu.ItemGroup`；
 * 不写 `group` 的项直接平铺。导航项的 `icon` 由调用方注入（ui-kit 不依赖图标库）。
 *
 * 边界：`items=[]` 渲染空菜单不崩；`selectedKey` 不在列表里则不选中任何项；
 * `hasChildren` 为真的项交给 antd `Menu` 的 `children`（二级菜单）。
 */
import { Menu } from 'antd';
import type { MenuProps } from 'antd';
import type { ReactNode } from 'react';

/** 单个导航项（配置驱动的最小形状）。 */
export interface SideNavItem {
  key: string;
  label: ReactNode;
  /** 由调用方注入的图标节点。 */
  icon?: ReactNode;
  disabled?: boolean;
  /** 相同 `group` 的连续项会聚成一个分组标题。 */
  group?: string;
  /** 二级菜单（可选）。 */
  children?: readonly SideNavItem[];
}

type MenuItem = NonNullable<MenuProps['items']>[number];

function toMenuItem(item: SideNavItem): MenuItem {
  const base = { key: item.key, label: item.label, icon: item.icon, disabled: item.disabled };
  return item.children === undefined || item.children.length === 0
    ? base
    : { ...base, children: item.children.map(toMenuItem) };
}

/** 把扁平配置按 `group` 聚合为 antd `Menu` 的 items（纯函数，便于单测）。 */
export function buildSideNavMenuItems(items: readonly SideNavItem[]): MenuProps['items'] {
  const top: MenuItem[] = [];
  let currentGroup: string | undefined;
  let buffer: MenuItem[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    if (currentGroup === undefined) top.push(...buffer);
    else top.push({ type: 'group', key: `__group__${currentGroup}`, label: currentGroup, children: buffer });
    buffer = [];
  };

  for (const item of items) {
    if (item.group !== currentGroup) {
      flush();
      currentGroup = item.group;
    }
    buffer.push(toMenuItem(item));
  }
  flush();
  return top;
}

export interface SideNavProps {
  items: readonly SideNavItem[];
  /** 当前选中项（受控；不在 `items` 内则不选中）。 */
  selectedKey: string;
  onSelect: (key: string) => void;
  /** 折叠态（透传 `Menu.inlineCollapsed`）。 */
  collapsed?: boolean;
  /** 导航顶部标题区（品牌 / 角色名）。 */
  title?: ReactNode;
  /** 导航底部区（版本号 / 退出）。 */
  footer?: ReactNode;
  /** 是否自动滚动（长列表）。 */
  className?: string;
}

export function SideNav(props: SideNavProps) {
  const { items, selectedKey, onSelect, collapsed, title, footer, className } = props;
  return (
    <nav className={className} data-testid="side-nav-root" aria-label="主导航">
      {title}
      <Menu
        mode="inline"
        items={buildSideNavMenuItems(items)}
        selectedKeys={[selectedKey]}
        inlineCollapsed={collapsed}
        onClick={({ key }) => onSelect(key)}
        data-testid="side-nav-menu"
      />
      {footer}
    </nav>
  );
}
