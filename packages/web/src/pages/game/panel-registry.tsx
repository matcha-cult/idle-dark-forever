/**
 * panel-registry —— 游戏域注册表（**唯一新增游戏域要改的文件**）。
 *
 * 同一份配置驱动两件事：
 * 1. 导航（`createPanelNavItems()` → `SideNav.items`）；
 * 2. 内容面板（`renderPanelContent(key)` → 内容区节点，**每个域外层包 `ErrorBoundary`**，
 *    `key` 跟着域走：换域重新挂载，错误态不会粘住下一个面板）。
 *
 * 新增一个域只需在此文件加一项（`group` 决定落在导航的哪一段）+ 写一个面板组件，
 * `GameShellPage` 一行都不用改。
 *
 * 域划分沿用原版底部 Tab 的核心四项（战斗 / 包裹 / 技能 / 生产）：
 * 包裹域内含「背包 / 装备 / 储藏箱 / 拾取规则 / 神力商店」，生产域内含四个子页。
 * 「角色属性」是本仓新增的独立域（原版是战斗页里的一个 Tab，本仓没有 Tab）——
 * 它回答「我有多强」，与战斗页的「在哪打、打成什么样」不同，故不塞进战斗页。
 *
 * ⚠️ **导航顺序 ≠ 默认落地页**：默认落地页由 `DEFAULT_PANEL_KEY` 显式给定，
 * 不要再用 `listPanelKeys()[0]` —— 那会让「把某个域排到最前面」意外改掉落地页
 * （角色属性排到战斗前面时，默认落地面板会变成属性页）。
 */
import {
  DeploymentUnitOutlined,
  ExperimentOutlined,
  IdcardOutlined,
  ShoppingOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { ErrorBoundary, type SideNavItem } from '@idle-dark/ui-kit';
import type { ReactNode } from 'react';
import { AttributesPanel } from './panels/AttributesPanel.js';
import { BattlePanel } from './panels/BattlePanel.js';
import { ChaosPanel } from './panels/ChaosPanel.js';
import { InventoryPanel } from './panels/InventoryPanel.js';
import { ProducePanel } from './panels/ProducePanel.js';
import { SkillsPanel } from './panels/SkillsPanel.js';

export type PanelKey = 'attributes' | 'battle' | 'inventory' | 'skills' | 'produce' | 'chaos';

/**
 * 默认落地面板（未手动切过域时显示哪个）。
 *
 * 显式写死，**不用** `DOMAINS[0]`：导航顺序是「信息优先级」，落地页是「动作入口」，
 * 两者不是同一个排序目标。
 */
export const DEFAULT_PANEL_KEY = 'battle' satisfies PanelKey;

/** 导航分组（顺序即展示顺序）。 */
export const PANEL_GROUPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'war', label: '征伐' },
  { key: 'growth', label: '成长' },
];

export interface PanelDomainEntry {
  key: PanelKey;
  label: string;
  icon: ReactNode;
  group: string;
  panel: ReactNode;
}

/**
 * 域列表。顺序 = 导航展示顺序（也是「先看自己、再看出征」的阅读顺序）：
 * 角色属性（我是谁 / 我有多强）→ 战斗（在哪打、打成什么样）→ 包裹（拿到了什么）
 * → 技能（怎么变强）→ 生产（把材料变成战力）→ 混沌仪（终局玩法）。
 */
const DOMAINS: readonly PanelDomainEntry[] = [
  { key: 'attributes', label: '角色属性', icon: <IdcardOutlined />, group: 'war', panel: <AttributesPanel /> },
  { key: 'battle', label: '战斗', icon: <ThunderboltOutlined />, group: 'war', panel: <BattlePanel /> },
  { key: 'inventory', label: '包裹', icon: <ShoppingOutlined />, group: 'war', panel: <InventoryPanel /> },
  { key: 'skills', label: '技能', icon: <ToolOutlined />, group: 'growth', panel: <SkillsPanel /> },
  { key: 'produce', label: '生产', icon: <ExperimentOutlined />, group: 'growth', panel: <ProducePanel /> },
  { key: 'chaos', label: '混沌仪', icon: <DeploymentUnitOutlined />, group: 'growth', panel: <ChaosPanel /> },
];

/** 全部域（只读快照）。 */
export function listPanelDomains(): readonly PanelDomainEntry[] {
  return DOMAINS;
}

/** 全部域的 key（**按导航顺序**；落地页用 `DEFAULT_PANEL_KEY`，不要取 `[0]`）。 */
export function listPanelKeys(): PanelKey[] {
  return DOMAINS.map((domain) => domain.key);
}

export function getPanelDomain(key: string): PanelDomainEntry | undefined {
  return DOMAINS.find((domain) => domain.key === key);
}

/** 导航配置（`SideNav` 的 `items`：连续同 `group` 自动聚成分组标题）。 */
export function createPanelNavItems(): SideNavItem[] {
  return DOMAINS.map((domain) => ({
    key: domain.key,
    label: domain.label,
    icon: domain.icon,
    group: PANEL_GROUPS.find((group) => group.key === domain.group)?.label ?? domain.group,
  }));
}

/**
 * 内容区节点。未知 key 返回 `null`（不抛错）；每个域包一层 `ErrorBoundary`，
 * 并把异常打到 console 便于直接复制。
 */
export function renderPanelContent(key: string): ReactNode {
  const domain = getPanelDomain(key);
  if (domain === undefined) return null;
  return (
    <ErrorBoundary
      key={domain.key}
      title={`「${domain.label}」渲染出错`}
      onError={(error, info) => {
        console.error(`[panel:${domain.key}] 渲染出错`, error, info.componentStack);
      }}
    >
      {domain.panel}
    </ErrorBoundary>
  );
}
