/**
 * PlayerAttributesPanel —— 角色属性面板（原版 `battle/components/PlayerPanel.js` 的那张表）。
 *
 * ## 数据来源与纪律
 *
 * 全部读 `UnitStateDto`（**type-only** import）：资源读 `hp/mp/rp/ep`，属性读
 * `unit.attributes`，经验读 `unit.exp/maxExp`。这些值**服务端已经换算并取整**
 * （见 protocol 的 `PlayerAttributesDto`）：前端只拼 `%` / `次/秒` 后缀与小数位，
 * **不做任何算术**（AGENTS §1.6）。`…Pct` 字段直接 `toFixed(1)` 加 `%`，
 * 绝不再乘 100 —— 再乘一次就是把百分比变成「万的平方」，是这类面板最经典的一处漂移。
 *
 * ## 布局（照抄原版的列划分）
 *
 * ```
 * 名字 等级N 职业名（等级上限：M）
 * ┌ 生命条 / 怒气条 / 经验  ┐ ┌ 力量 敏捷 智力 ┐
 * ┌ 输出 / 收益 / 防御      ┐ ┌ 回复 / 抗性     ┐
 * ```
 *
 * 列宽用 `minWidth + wrap`：窄屏自动从两列变一列（而不是把 label 压到 value 上方）。
 *
 * ## 与原版的三处刻意偏离
 *
 * - **耐力 / 巅峰等级**：内核已删除（E1 / Q8），故不显示 —— 不是漏了；
 * - **暗影 → 混沌**：`chaosResist` / `chaosAbsorb`（P7：混沌非元素）；
 * - **数值格式**：走本仓统一的 `formatAmount`（千分位），不是原版 `IntField` 的 `K/M/B` ——
 *   与 HUD 的「金币 / 等级 / 经验」保持同一种读法。
 *
 * 颜色纪律：零内联 hex，全部 `theme.useToken()`。
 */
import { Divider, Flex, Progress, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import type { PlayerAttributesDto, UnitStateDto } from '@idle-dark/protocol';
import { StatList, type StatItem } from '../data/stat-list.js';
import { formatAmount } from '../format/number.js';
import { EmptyState } from '../feedback/empty-state.js';
import { buildGroups } from './player-attributes-groups.js';
import { ResourceBar } from './resource-bar.js';

export interface PlayerAttributesPanelProps {
  /** 玩家单位（服务端权威快照）。非玩家单位没有 `attributes`，会走空态。 */
  unit: UnitStateDto;
  /** `attributes` 缺失时的文案。 */
  emptyText?: ReactNode;
}

export function PlayerAttributesPanel(props: PlayerAttributesPanelProps) {
  const { unit, emptyText } = props;
  const { token } = theme.useToken();
  // `null` 也按「没有」处理：旧服务端 / 手写载荷可能给 null，直接读字段会抛。
  const attr = unit.attributes as PlayerAttributesDto | null | undefined;

  if (attr === undefined || attr === null) {
    return <EmptyState description={emptyText ?? '暂无属性'} hint="属性随玩家单位一并下发" />;
  }

  const items = buildGroups(attr);
  const identity = `${attr.careerName === '' ? '—' : attr.careerName}（等级上限：${formatAmount(attr.maxLevel)}）`;

  return (
    <Flex vertical gap={token.paddingXS} data-testid="player-attributes-panel">
      <Typography.Text data-testid="player-attr-identity">
        <Typography.Text strong>{unit.name}</Typography.Text>
        {` 等级${formatAmount(unit.level)} ${identity}`}
      </Typography.Text>

      <Flex wrap gap={token.padding} align="flex-start">
        <Flex vertical gap={token.marginXXS} style={{ flex: 1, minWidth: 240 }} data-testid="player-attr-resources">
          <ResourceBar kind="hp" current={unit.hp} max={unit.maxHp} width={160} />
          {unit.maxMp > 0 ? <ResourceBar kind="mp" current={unit.mp} max={unit.maxMp} width={160} /> : null}
          {unit.maxRp > 0 ? <ResourceBar kind="rp" current={unit.rp} max={unit.maxRp} width={160} /> : null}
          {unit.maxEp > 0 ? <ResourceBar kind="ep" current={unit.ep} max={unit.maxEp} width={160} /> : null}
          <ExpRow exp={unit.exp} maxExp={unit.maxExp} />
        </Flex>
        <Flex vertical gap={token.marginXXS} style={{ flex: 1, minWidth: 200 }}>
          <StatList items={items.primary} columns={1} />
        </Flex>
      </Flex>

      <Flex wrap gap={token.padding} align="flex-start" data-testid="player-attr-detail">
        <Flex vertical gap={token.marginXXS} style={{ flex: 1, minWidth: 240 }}>
          {items.left.map((group, index) => (
            <Group key={group[0]?.key ?? `left-${index}`} items={group} first={index === 0} />
          ))}
        </Flex>
        <Flex vertical gap={token.marginXXS} style={{ flex: 1, minWidth: 240 }}>
          {items.right.map((group, index) => (
            <Group key={group[0]?.key ?? `right-${index}`} items={group} first={index === 0} />
          ))}
        </Flex>
      </Flex>
    </Flex>
  );
}

/** 一组属性行；`first` 为假时在**上方**补一条分隔线（对齐原版的 `Seperator`）。 */
function Group(props: { items: readonly StatItem[]; first: boolean }) {
  const { items, first } = props;
  if (items.length === 0) return null;
  return (
    <>
      {first ? null : <Divider style={{ margin: '4px 0' }} />}
      <StatList items={items} columns={1} />
    </>
  );
}

/** 经验行（原版 `ExpBar` 的位置；HUD 上也有一根，这里是面板内的完整读数）。 */
function ExpRow(props: { exp?: number; maxExp?: number }) {
  const { token } = theme.useToken();
  const exp = Number.isFinite(props.exp) ? (props.exp as number) : 0;
  const maxExp = Number.isFinite(props.maxExp) ? (props.maxExp as number) : 0;
  const ratio = maxExp > 0 ? Math.min(100, Math.max(0, (exp / maxExp) * 100)) : 0;
  return (
    <Flex align="center" gap={token.marginXS} data-testid="player-attr-exp">
      <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary, minWidth: 32 }}>
        经验
      </Typography.Text>
      <Progress
        percent={ratio}
        strokeColor={token.colorPrimary}
        railColor={token.colorFillSecondary}
        size={{ width: 160, height: 8 }}
        showInfo={false}
        style={{ marginBottom: 0 }}
      />
      <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary, whiteSpace: 'nowrap' }}>
        {`${formatAmount(exp)} / ${formatAmount(maxExp)}`}
      </Typography.Text>
    </Flex>
  );
}
