/**
 * GameShellPage —— 游戏外壳（**只做装配**）。
 *
 * 结构（`AppShell` 内置「侧栏固定 / 移动抽屉 + 页头吸顶 + 内容滚动」）：
 *   ├─ nav     `SideNav`（配置来自 panel-registry，导航与内容同一份真相）
 *   ├─ header  角色身份：昵称 + 命途 + 等级
 *   ├─ hud     `HudBar`（金币 / 神力 / 等级 / 经验 / 倍速）+ 连接徽标 + 主题切换
 *   └─ content `renderPanelContent(activeKey)`（每域已包 ErrorBoundary）
 *
 * 新增游戏域**不需要改本文件**（只改 `panel-registry.tsx`）。
 */
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { Button, Flex, Modal, Space, Tag, Typography, theme } from 'antd';
import { ConnectionBadge, HudBar, SideNav, AppShell, ThemeToggle, formatAmount, formatDurationCn } from '@idle-dark/ui-kit';
import type { ConnectionStatus } from '@idle-dark/ui-kit';
import { useRootStore } from '../../app/root-context.js';
import { createPanelNavItems, listPanelKeys, renderPanelContent } from './panel-registry.js';

/** transport 的连接态 → 徽标语义（`offline/closed` 归入「未连接」）。 */
function badgeStatusOf(state: string): ConnectionStatus {
  switch (state) {
    case 'online':
      return 'online';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'failed':
      return 'failed';
    default:
      return 'idle';
  }
}

export const GameShellPage = observer(function GameShellPage() {
  const root = useRootStore();
  const { token } = theme.useToken();
  const { player, world, idle, connection } = root;
  const navItems = useMemo(() => createPanelNavItems(), []);
  // 面板 key 是 Store 状态（不是局部 state）：推送驱动的跳转必须能从域 Store 侧发起，
  // 见 `stores/ui-store.ts`。
  const activeKey = root.ui.activePanelKey ?? (listPanelKeys()[0] ?? 'battle');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    void root.loadPanel();
  }, [root]);

  const activePlayer = root.session.activePlayer;
  const gain = player.lastGain;

  return (
    <>
      <AppShell
        collapsed={collapsed}
        onCollapse={setCollapsed}
        nav={
          <SideNav
            items={navItems}
            selectedKey={activeKey}
            onSelect={root.ui.setActivePanel}
            collapsed={collapsed}
            title={
              <Flex vertical gap={0} style={{ padding: '12px 12px 4px' }}>
                <Typography.Text strong style={{ color: token.colorPrimary }}>
                  永夜 · 重制
                </Typography.Text>
                <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                  服务端权威
                </Typography.Text>
              </Flex>
            }
          />
        }
        header={
          <Space align="center" wrap data-testid="shell-identity">
            <Typography.Text strong style={{ fontSize: token.fontSizeLG }}>
              {player.name === '—' ? (activePlayer?.name ?? '—') : player.name}
            </Typography.Text>
            <Tag>{player.roleName === '—' ? (activePlayer?.roleName ?? '—') : player.roleName}</Tag>
            <Tag color="blue" data-testid="shell-level">{`Lv.${player.level}`}</Tag>
            {player.map === '' ? null : <Tag color="geekblue">{`${player.map}${player.endlessLevel > 0 ? ` · 无尽 ${player.endlessLevel}` : ''}`}</Tag>}
          </Space>
        }
        headerExtra={
          <Space wrap>
            {gain === null || (gain.exp === 0 && gain.gold === 0) ? null : (
              <Typography.Text type="secondary" data-testid="shell-gain">
                {`+${formatAmount(gain.exp)} 经验 / +${formatAmount(gain.gold)} 金币`}
              </Typography.Text>
            )}
            <ConnectionBadge
              status={badgeStatusOf(connection.state)}
              lastError={connection.detail}
              tooltip={connection.detail}
            />
            <Button onClick={() => void root.loadPanel()} data-testid="shell-refresh-all">
              全量刷新
            </Button>
            <Button onClick={() => root.leaveCharacter()} data-testid="shell-leave-character">
              切换角色
            </Button>
            <Button
              danger
              onClick={() => {
                root.logout();
              }}
              data-testid="shell-logout"
            >
              退出登录
            </Button>
            <ThemeToggle value={root.theme.mode} onChange={(mode) => root.theme.setMode(mode)} />
          </Space>
        }
        hud={
          <HudBar
            gold={player.gold}
            diamonds={player.diamonds}
            level={player.level}
            exp={player.exp}
            maxExp={player.maxExp}
            speed={world.updateRate}
            extra={
              <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {world.paused ? '世界已暂停' : `单位 ${world.units.length}`}
              </Typography.Text>
            }
          />
        }
      >
        <Flex vertical gap={token.paddingSM} style={{ flex: 1, minHeight: 0 }}>
          {renderPanelContent(activeKey)}
        </Flex>
      </AppShell>

      <Modal
        open={idle.shouldShowReport}
        title="离线结算报告"
        okText="领取"
        cancelText="稍后"
        confirmLoading={idle.claiming}
        onOk={() => void idle.claim()}
        onCancel={() => idle.dismiss()}
        data-testid="offline-report-modal"
      >
        {idle.report === null ? null : (
          <Flex vertical gap={4}>
            <Typography.Text>{`离线时长：${formatDurationCn(idle.report.offlineMs)}（上限截断 ${formatDurationCn(idle.report.cappedMs)}）`}</Typography.Text>
            <Typography.Text>{`实模拟 ${formatDurationCn(idle.report.simulatedMs)} · 外推 ${formatDurationCn(idle.report.extrapolatedMs)}`}</Typography.Text>
            <Typography.Text>{`金币 +${formatAmount(idle.report.gainedGold)} · 经验 +${formatAmount(idle.report.gainedExp)} · 击杀 ${formatAmount(idle.report.kills)}`}</Typography.Text>
            <Typography.Text type="secondary">
              {`掉落 ${idle.report.loots.length} 件 · 材料 ${idle.report.materials.length} 种`}
            </Typography.Text>
            {idle.report.pausedByMaxOffline ? (
              <Typography.Text type="warning">已超过最大离线时长，超出部分不再结算。</Typography.Text>
            ) : null}
          </Flex>
        )}
      </Modal>
    </>
  );
});
