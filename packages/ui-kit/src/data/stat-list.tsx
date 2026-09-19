/**
 * StatList —— 属性列表（label / value 成对）。
 *
 * 布局决策：`grid` + `minmax(minColumnWidth, 1fr)`，**窄屏自动减列**而不是把
 * label 压到 value 上方——属性名（「暴击伤害」）和数值一起读才有意义，
 * 一旦竖排就得来回扫视。
 *
 * 颜色纪律：标签用 `token.colorTextTertiary`，数值用 `token.colorText`，
 * 高亮项用 `token.colorPrimary`，全部取 antd token。
 */
import { Flex, Tooltip, Typography, theme } from 'antd';
import type { ReactNode } from 'react';

export interface StatItem {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** 悬浮说明（属性来源、公式说明）。 */
  hint?: string;
}

export interface StatListProps {
  items: readonly StatItem[];
  /** 每列最小宽度（px），缺省 150。 */
  minColumnWidth?: number;
  /** 强制列数；给定后忽略 `minColumnWidth` 的自动列数。 */
  columns?: number;
  /** 紧凑行高（缺省 true）。 */
  dense?: boolean;
  /** 需要高亮的属性 key（如被 Buff 加成）。 */
  highlightKeys?: readonly string[];
  /** 空列表文案。 */
  emptyText?: ReactNode;
}

export function StatList(props: StatListProps) {
  const { items, minColumnWidth = 150, columns, dense = true, highlightKeys, emptyText = '暂无属性' } = props;
  const { token } = theme.useToken();

  if (items.length === 0) {
    return (
      <Typography.Text style={{ color: token.colorTextTertiary }} data-testid="stat-list-empty">
        {emptyText}
      </Typography.Text>
    );
  }

  const template =
    columns === undefined
      ? `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))`
      : `repeat(${Math.max(1, Math.trunc(columns))}, minmax(0, 1fr))`;

  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: template, gap: `${token.marginXXS}px ${token.margin}px` }}
      data-testid="stat-list"
    >
      {items.map((item) => {
        const highlighted = highlightKeys?.includes(item.key) === true;
        const row = (
          <Flex
            justify="space-between"
            align="baseline"
            gap={token.marginXS}
            data-testid={`stat-${item.key}`}
            style={{ minWidth: 0, paddingBlock: dense ? 0 : token.paddingXXS }}
          >
            <Typography.Text style={{ color: token.colorTextTertiary, fontSize: token.fontSizeSM }} ellipsis>
              {item.label}
            </Typography.Text>
            <Typography.Text
              strong
              style={{ color: highlighted ? token.colorPrimary : token.colorText, whiteSpace: 'nowrap' }}
            >
              {item.value}
            </Typography.Text>
          </Flex>
        );
        return item.hint === undefined ? (
          <div key={item.key}>{row}</div>
        ) : (
          <Tooltip key={item.key} title={item.hint}>
            {row}
          </Tooltip>
        );
      })}
    </div>
  );
}
