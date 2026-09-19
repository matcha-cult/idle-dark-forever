/**
 * ItemGrid —— 背包/仓库网格（**固定列数** + 空格占位 + 选中态）。
 *
 * 受控纯展示：`slots` 是服务端下发的槽位数组（`null` = 空槽），组件不做排序/过滤，
 * 只负责「补齐到固定格数 + 固定列数排布 + 把点击事件带槽位回抛」。
 *
 * 为什么固定列数：背包是**空间语义**，列数随宽度变化会让同一件物品在不同窗口大小下
 * 换位置，玩家肌肉记忆失效。列数由调用方决定（PC 8 列 / 移动 5 列是常见取值）。
 *
 * 颜色一律取 antd token。
 */
import { Flex, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import type { InventorySlotDto } from '@idle-dark/protocol';
import { ItemCard } from './item-card.js';

export interface ItemGridProps {
  /** 槽位列表（`null` = 空槽）；长度不足 `minSlots` 时自动补空格。 */
  slots: readonly (InventorySlotDto | null)[];
  /** 列数，缺省 8（会 clamp 到 1..24）。 */
  columns?: number;
  /** 至少渲染多少格（缺省 24，避免背包只有 3 件时空荡荡）。 */
  minSlots?: number;
  /** 当前选中物品实例 id（受控）。 */
  selectedId?: string | null;
  /** 单击选中。 */
  onSelect?: (slot: InventorySlotDto) => void;
  /** 双击/回车使用。 */
  onActivate?: (slot: InventorySlotDto) => void;
  /** 紧凑模式（隐藏词缀）。 */
  compact?: boolean;
  /** 右上角角标渲染器（如钥匙数量）。 */
  renderCorner?: (slot: InventorySlotDto) => ReactNode;
  /** 顶部标题区。 */
  header?: ReactNode;
  /** 底部附加区（如容量提示）。 */
  footer?: ReactNode;
  /** 空列表时是否仍渲染空格网格，缺省 true。 */
  showEmptyCells?: boolean;
}

export function ItemGrid(props: ItemGridProps) {
  const {
    slots,
    columns = 8,
    minSlots = 24,
    selectedId,
    onSelect,
    onActivate,
    compact = false,
    renderCorner,
    header,
    footer,
    showEmptyCells = true,
  } = props;
  const { token } = theme.useToken();

  const safeColumns = Math.min(24, Math.max(1, Math.trunc(columns) || 1));
  const cellCount = showEmptyCells ? Math.max(minSlots, slots.length) : slots.length;
  const cells: (InventorySlotDto | null)[] = Array.from(
    { length: cellCount },
    (_, index) => slots[index] ?? null,
  );

  return (
    <Flex vertical gap={token.marginXS} data-testid="item-grid-root" data-columns={safeColumns}>
      {header}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))`,
          gap: token.marginXXS,
        }}
        data-testid="item-grid"
      >
        {cells.map((slot, index) => (
          <ItemCard
            key={slot?.id ?? `empty-${index}`}
            slot={slot}
            selected={slot !== null && selectedId === slot.id}
            compact={compact}
            onClick={onSelect}
            onActivate={onActivate}
            {...(renderCorner === undefined || slot === null ? {} : { cornerExtra: renderCorner(slot) })}
          />
        ))}
      </div>
      {footer ?? (
        <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
          {`占用 ${slots.filter((slot) => slot !== null).length}/${slots.length}`}
        </Typography.Text>
      )}
    </Flex>
  );
}
