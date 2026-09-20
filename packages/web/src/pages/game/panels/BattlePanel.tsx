/**
 * BattlePanel —— 战斗（原版 Tab「战斗」）。
 *
 * 玩家在这里回答三个问题：
 *   1. 我在哪、还能去哪？→ 地图列表（服务端 `MapDto`）+ 挑战队列（`pendingMaps`）
 *   2. 现在打成什么样？→ 单位卡列表（`UnitStateDto`，服务端权威快照）+ 战斗日志（事件流）
 *   3. 打不动怎么办？→ 目标切换 / 离开地图 / 放弃离线收益
 *
 * 纪律：本面板**不做任何数值推导**。血条、施法进度、Buff 剩余时间、倍速全部直接渲染
 * 服务端下发的值；日志只把 `BattleEventDto` 格式化成文案。
 */
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { App as AntApp, Button, Flex, Space, Switch, Tag, Typography, theme } from 'antd';
import type { BattleEventDto, MapDto, UnitStateDto } from '@idle-dark/protocol';
import {
  ActionBar,
  EmptyState,
  LogPanel,
  SectionCard,
  UnitCard,
  formatAmount,
  type LogEntry,
  type LogLevel,
} from '@idle-dark/ui-kit';
import { useRootStore } from '../../../app/root-context.js';
import { isAttackableCamp } from '../../../stores/world-store.js';

/** 战斗事件 → 日志条目（纯展示映射，不改变任何数值）。 */
export function formatBattleEvent(
  event: BattleEventDto,
  names: Readonly<Record<string, string>>,
): { text: string; level: LogLevel } {
  const nameOf = (id: string): string => names[id] ?? id;
  switch (event.kind) {
    case 'damage':
      return {
        text: `${nameOf(event.fromId)} → ${nameOf(event.toId)} ${event.skill || '攻击'} ${formatAmount(event.value)}${
          event.absorbed > 0 ? `（吸收 ${formatAmount(event.absorbed)}）` : ''
        }${event.crit ? ' 暴击' : ''}`,
        level: 'damage',
      };
    case 'heal':
      return { text: `${nameOf(event.fromId)} 治疗 ${nameOf(event.toId)} ${formatAmount(event.value)}`, level: 'heal' };
    case 'dodge':
      return { text: `${nameOf(event.toId)} 闪避了 ${event.skill || '攻击'}`, level: 'warning' };
    case 'death':
      return { text: `${event.name} 阵亡`, level: 'warning' };
    case 'buff':
      return { text: `${nameOf(event.unitId)} ${event.on ? '获得' : '失去'} ${event.name}`, level: 'system' };
    case 'exp':
      return { text: `经验 +${formatAmount(event.amount)}${event.peak ? '（巅峰）' : ''} → Lv.${event.level}`, level: 'loot' };
    default:
      return { text: event.text, level: 'info' };
  }
}

function mapLockedReason(map: MapDto): string | null {
  if (map.lockedReason !== null && map.lockedReason.length > 0) return map.lockedReason;
  if (map.ticketGroup !== undefined && map.ticketCount <= 0) return '缺少副本钥匙';
  return null;
}

export const BattlePanel = observer(function BattlePanel() {
  const root = useRootStore();
  const { world } = root;
  const { modal } = AntApp.useApp();
  const { token } = theme.useToken();
  const [busyMap, setBusyMap] = useState<string | null>(null);
  /** 默认只显示可进入的地图；47 张图全平铺会让玩家找不到能进的那张。 */
  const [showLocked, setShowLocked] = useState(false);

  const unlockedMaps = world.maps.filter((map) => mapLockedReason(map) === null);
  const visibleMaps = showLocked ? world.maps : unlockedMaps;
  const unlockedCount = unlockedMaps.length;

  const names: Record<string, string> = {};
  for (const unit of world.units) names[unit.id] = unit.name;

  const entries: LogEntry[] = world.log.map((entry) => {
    const formatted = formatBattleEvent(entry.event, names);
    return { id: String(entry.seq), text: formatted.text, level: formatted.level };
  });

  const enter = async (map: MapDto): Promise<void> => {
    setBusyMap(map.key);
    try {
      await world.enterMap(map.key);
    } finally {
      setBusyMap(null);
    }
  };

  const focus = (unit: UnitStateDto): void => {
    // 敌方与**中立**（黄名）都可以指定：原版 `CampRelation.player.neutral === true`，
    // 不主动攻击但可以主动打，打了它才会参战。幽灵/剧情/神龛等一律忽略。
    if (!isAttackableCamp(unit.camp)) return;
    // 只发「把该单位设为目标」的意图；具体由哪个我方单位攻击由服务端决定。
    void world.focus(unit.id);
  };

  const leave = (): void => {
    modal.confirm({
      title: '离开当前地图？',
      content: '离开后当前地图的挑战队列会被清空（服务端判定）。',
      okText: '离开',
      cancelText: '取消',
      onOk: () => world.leave(),
    });
  };

  const skipOffline = (): void => {
    modal.confirm({
      title: '放弃离线收益？',
      content: '被跳过的这段时间不会补发金币、经验与掉落，且不可恢复。',
      okText: '确认放弃',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => world.skipOffline(),
    });
  };

  return (
    <Flex vertical gap={token.paddingSM} data-testid="battle-panel">
      <SectionCard
        title="地图与挑战队列"
        extra={
          <Space>
            <Typography.Text type="secondary">
              {world.updateRate > 1 ? `模拟倍速 ×${world.updateRate.toFixed(1)}` : '实时模拟'}
            </Typography.Text>
            <Button onClick={leave} disabled={world.currentMap === ''} data-testid="battle-leave">
              离开地图
            </Button>
          </Space>
        }
      >
        <Flex vertical gap={token.paddingXS}>
          {world.maps.length === 0 ? (
            <EmptyState description="暂无可进入的地图" hint="世界数据会在收到 `(world, snapshot)` 后出现" />
          ) : (
            <>
              {/*
                数据表里有 47 张地图，前期绝大多数是锁定的。早期把它们全部平铺，
                玩家很难在 45 张「尚未满足进入条件」的卡片里找到那唯一一张能进的
                —— 这是实际被反馈过的「地图无法解锁」体验问题。
                默认只显示可进入的，需要时再展开全部（服务端已把可进入的排在前面）。
              */}
              <Flex justify="space-between" align="center" gap={token.paddingXS} wrap>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {`可进入 ${unlockedCount} / ${world.maps.length} 张`}
                  {unlockedCount === 0 ? ' —— 提升等级可解锁新地图' : ''}
                </Typography.Text>
                <Space>
                  <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    显示未解锁
                  </Typography.Text>
                  <Switch
                    checked={showLocked}
                    onChange={setShowLocked}
                    data-testid="battle-show-locked"
                  />
                </Space>
              </Flex>
              <Flex wrap gap={token.paddingXS}>
                {visibleMaps.map((map) => {
                  const reason = mapLockedReason(map);
                  const locked = reason !== null;
                  return (
                    <Flex
                      key={map.key}
                    vertical
                    gap={2}
                    style={{
                      minWidth: 200,
                      padding: token.paddingXS,
                      border: `1px solid ${map.key === world.currentMap ? token.colorPrimary : token.colorBorderSecondary}`,
                      borderRadius: token.borderRadiusSM,
                      background: map.key === world.currentMap ? token.colorPrimaryBg : token.colorBgContainer,
                    }}
                    data-testid={`map-${map.key}`}
                  >
                    <Flex justify="space-between" align="center" gap={token.marginXXS}>
                      <Typography.Text strong>{map.name}</Typography.Text>
                      {map.isDungeon ? <Tag color="purple">副本</Tag> : <Tag>野外</Tag>}
                    </Flex>
                    <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                      {`Lv.${map.level}${map.ticketGroup === undefined ? '' : ` · 钥匙 ${map.ticketCount}`}`}
                    </Typography.Text>
                    {map.hint === undefined ? null : (
                      <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary }}>
                        {map.hint}
                      </Typography.Text>
                    )}
                    <Button
                      type={map.key === world.currentMap ? 'default' : 'primary'}
                      disabled={locked || busyMap === map.key}
                      loading={busyMap === map.key}
                      onClick={() => void enter(map)}
                      data-testid={`map-enter-${map.key}`}
                    >
                      {locked ? reason : map.key === world.currentMap ? '重新进入' : '进入'}
                    </Button>
                  </Flex>
                );
              })}
              </Flex>
            </>
          )}

          {world.pendingMaps.length === 0 ? null : (
            <Flex vertical gap={2} data-testid="battle-queue">
              <Typography.Text strong>挑战队列</Typography.Text>
              <Space wrap>
                {world.pendingMaps.map((pending) => (
                  <Tag key={`${pending.key}:${pending.endlessLevel}`} color="geekblue">
                    {`${pending.key}${pending.endlessLevel > 0 ? ` · 无尽 ${pending.endlessLevel}` : ''}`}
                  </Tag>
                ))}
              </Space>
            </Flex>
          )}
        </Flex>
      </SectionCard>

      <SectionCard
        title="战场单位"
        extra={
          <Typography.Text type="secondary">
            {world.neutrals.length > 0
              ? `我方 ${world.allies.length} · 敌方 ${world.enemies.length} · 中立 ${world.neutrals.length}`
              : `我方 ${world.allies.length} · 敌方 ${world.enemies.length}`}
          </Typography.Text>
        }
      >
        {world.units.length === 0 ? (
          <EmptyState description="当前没有单位" hint="进入地图后服务端会以 tick 推送单位快照" />
        ) : (
          <Flex vertical gap={token.paddingXS}>
            <Flex wrap gap={token.paddingXS} data-testid="battle-allies">
              {world.allies.map((unit) => (
                <UnitCard key={unit.id} unit={unit} dead={unit.hp <= 0} />
              ))}
            </Flex>
            <Flex wrap gap={token.paddingXS} data-testid="battle-enemies">
              {world.attackables.map((unit) => (
                <UnitCard
                  key={unit.id}
                  unit={unit}
                  dead={unit.hp <= 0}
                  onClick={focus}
                  extra={
                    <Flex gap={4}>
                      {/* 黄名中立怪：不主动攻击、也不会被溅射打到，必须玩家手动点它才会开战
                          （原版「单位」面板语义）。 */}
                      {unit.camp === 'neutral' ? <Tag color="gold">中立</Tag> : null}
                      {world.allies.some((ally) => ally.targetId === unit.id) ? (
                        <Tag color="red">被锁定</Tag>
                      ) : null}
                    </Flex>
                  }
                />
              ))}
            </Flex>
            <ActionBar
              actions={[
                {
                  key: 'focus-clear',
                  label: '取消集火',
                  tooltip: '让所有我方单位清除当前目标',
                  onClick: () => void world.focus(null),
                },
                { key: 'skip-offline', label: '放弃离线收益', danger: true, onClick: skipOffline },
              ]}
            />
          </Flex>
        )}
      </SectionCard>

      <SectionCard
        title="战斗日志"
        extra={
          <Button onClick={() => world.clearLog()} data-testid="battle-log-clear">
            清空本地日志
          </Button>
        }
      >
        <LogPanel entries={entries} height={260} emptyText="暂无战斗事件" />
      </SectionCard>
    </Flex>
  );
});
