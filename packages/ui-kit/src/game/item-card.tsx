/**
 * ItemCard —— 物品卡（名称按品质着色 + 词缀列表 + 数量角标 + 锁定标记）。
 *
 * 受控纯展示：数据来自 `InventorySlotDto`（**type-only** import，运行时零依赖），
 * 组件不持有任何业务状态，也不做数值推导（服务端权威）。
 *
 * 颜色纪律：品质色取 `theme.useToken()`（token 名见 `quality.ts`），边框/底/次要文字
 * 全部用 token；源码零内联 hex。
 *
 * 边界：
 * - `slot === null` → 渲染「空格」占位（虚线边框，不可点）；
 * - 可点击时带 `role="button"` + `tabIndex`，支持回车/空格激活（键盘可用）；
 * - `affixes` 缺省、空数组、超长都安全（`maxAffixes` 截断）。
 */
import { Flex, Typography, theme } from 'antd';
import type { KeyboardEvent, ReactNode } from 'react';
import type { InventorySlotDto } from '@idle-dark/protocol';
import { RarityTag } from './rarity-tag.js';
import { useRarityColor } from './rarity-palette.js';

export interface ItemCardProps {
  slot: InventorySlotDto | null;
  /** 选中态（边框与底色高亮）。 */
  selected?: boolean;
  /** 禁用（半透明且不可交互）。 */
  disabled?: boolean;
  /** 是否显示词缀列表，缺省 true。 */
  showAffixes?: boolean;
  /** 最多显示几条词缀，缺省 3。 */
  maxAffixes?: number;
  /** 是否显示售价，缺省 false。 */
  showPrice?: boolean;
  /** 紧凑模式：隐藏词缀与等级行（背包网格用）。 */
  compact?: boolean;
  /** 单击（选中）。 */
  onClick?: (slot: InventorySlotDto) => void;
  /** 双击 / 回车（使用、装备）。 */
  onActivate?: (slot: InventorySlotDto) => void;
  /** 右上角附加角标（如钥匙数量）。 */
  cornerExtra?: ReactNode;
  /** 空槽文案，缺省「空」。 */
  emptyText?: ReactNode;
}

export function ItemCard(props: ItemCardProps) {
  const {
    slot,
    selected = false,
    disabled = false,
    showAffixes = true,
    maxAffixes = 3,
    showPrice = false,
    compact = false,
    onClick,
    onActivate,
    cornerExtra,
    emptyText = '空',
  } = props;
  const { token } = theme.useToken();
  // 钩子无条件调用（下面 `slot === null` 会提前 return）；空格占位取普通档 = 主题正文色
  const nameColor = useRarityColor(slot === null ? 0 : (slot.displayQuality ?? slot.quality)).name;

  if (slot === null) {
    return (
      <div
        data-testid="item-card-empty"
        style={{
          minHeight: compact ? 56 : 96,
          border: `1px dashed ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusSM,
          background: token.colorFillQuaternary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: token.colorTextQuaternary,
          fontSize: token.fontSizeSM,
        }}
      >
        {emptyText}
      </div>
    );
  }

  const interactive = !disabled && (onClick !== undefined || onActivate !== undefined);
  const affixes = (slot.affixes ?? []).slice(0, Math.max(0, maxAffixes));
  const hiddenAffixCount = (slot.affixes?.length ?? 0) - affixes.length;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!interactive) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate?.(slot);
    }
  };

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive && onClick !== undefined ? selected : undefined}
      aria-disabled={disabled || undefined}
      data-testid="item-card"
      data-item-id={slot.id}
      data-quality={slot.quality}
      onClick={interactive && onClick !== undefined ? () => onClick(slot) : undefined}
      onDoubleClick={interactive && onActivate !== undefined ? () => onActivate(slot) : undefined}
      onKeyDown={onKeyDown}
      style={{
        position: 'relative',
        minHeight: compact ? 56 : 96,
        padding: token.paddingXS,
        border: `1px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
        boxShadow: selected ? `0 0 0 1px ${token.colorPrimary} inset` : undefined,
        borderRadius: token.borderRadiusSM,
        background: selected ? token.colorPrimaryBg : token.colorBgContainer,
        opacity: disabled ? 0.45 : 1,
        cursor: interactive ? 'pointer' : 'default',
        overflow: 'hidden',
      }}
    >
      <Flex vertical gap={token.marginXXS} style={{ minWidth: 0 }}>
        <Flex justify="space-between" align="flex-start" gap={token.marginXXS}>
          <Typography.Text strong ellipsis style={{ color: nameColor }} data-testid="item-card-name">
            {slot.name}
          </Typography.Text>
          {slot.locked ? (
            <span role="img" aria-label="已锁定" title="已锁定" style={{ color: token.colorTextTertiary }}>
              🔒
            </span>
          ) : null}
        </Flex>

        {compact ? null : (
          <Flex align="center" gap={token.marginXXS} wrap>
            <RarityTag quality={slot.quality} />
            {slot.level > 0 ? (
              <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                {`Lv.${slot.level}`}
              </Typography.Text>
            ) : null}
            {showPrice ? (
              <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.gold }}>
                {`${slot.price} 金`}
              </Typography.Text>
            ) : null}
          </Flex>
        )}

        {!compact && showAffixes && affixes.length > 0 ? (
          <Flex vertical gap={0} data-testid="item-card-affixes">
            {affixes.map((affix) => (
              <Typography.Text
                key={affix.key}
                style={{
                  fontSize: token.fontSizeSM,
                  color: affix.isLegend ? token.gold : token.colorTextSecondary,
                }}
              >
                {affix.display}
              </Typography.Text>
            ))}
            {hiddenAffixCount > 0 ? (
              <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextQuaternary }}>
                {`…还有 ${hiddenAffixCount} 条`}
              </Typography.Text>
            ) : null}
          </Flex>
        ) : null}
      </Flex>

      {slot.count > 1 ? (
        <span
          data-testid="item-card-count"
          style={{
            position: 'absolute',
            right: token.marginXXS,
            bottom: token.marginXXS,
            color: token.colorText,
            fontSize: token.fontSizeSM,
          }}
        >
          {`×${slot.count}`}
        </span>
      ) : null}
      {cornerExtra === undefined ? null : (
        <span style={{ position: 'absolute', right: token.marginXXS, top: token.marginXXS }}>{cornerExtra}</span>
      )}
    </div>
  );
}
