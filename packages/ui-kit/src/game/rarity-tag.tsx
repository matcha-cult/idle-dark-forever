/**
 * RarityTag —— 品质徽标（3 档：普通 / 稀有 / 传奇，稀有度视觉改版）。
 *
 * 视觉规则：
 * - **普通档默认不渲染徽标**（返回 `null`）；`showCommon` 可强制显示，
 *   供战利品规则这类「必须有文字标签」的场景使用。
 * - 稀有 / 传奇 = **实色底 + 对比文字色**的色块徽标；色板由应用层注入
 *   （`RarityPaletteProvider`，见 `rarity-palette.tsx`）。
 *
 * 边界：`quality` 非有限数 / 负 / 小数 / 越界一律夹取到 0..2。
 * 插槽：无（纯展示）；`labels` 可整体覆盖文案（缺位回退内置 3 档）。
 */
import { Tag } from 'antd';
import type { Quality } from '@idle-dark/protocol';
import { COMMON_QUALITY, clampQuality, qualityLabel } from './quality.js';
import { useRarityTagStyle } from './rarity-palette.js';

export interface RarityTagProps {
  /** 品质档位（0..2，越界自动夹取）。 */
  quality: Quality | number;
  /** 覆盖默认文案；长度不足 3 时缺失位回退内置文案。 */
  labels?: readonly string[];
  /** 是否显示档位文案，缺省 true；false 时只显示 `Q1` 这类序号徽标。 */
  showLabel?: boolean;
  /** 是否连「普通」档也渲染徽标，缺省 **false**（普通不显示 tag）。 */
  showCommon?: boolean;
  /** antd v6 `Tag.variant`，缺省 `filled`；`outlined` 只上文字与描边色。 */
  variant?: 'filled' | 'solid' | 'outlined';
  /** 悬浮说明（缺省无）。 */
  tooltip?: string;
}

export function RarityTag(props: RarityTagProps) {
  const { quality, labels, showLabel = true, showCommon = false, variant = 'filled', tooltip } = props;
  // 夹取一次，色 / 文案 / data 属性全部基于同一个值，避免「显示普通但 data 是 99」
  const safeQuality = clampQuality(quality);
  // 钩子无条件调用（下面的普通档提前 return 不能改变调用顺序）
  const chipStyle = useRarityTagStyle(safeQuality, variant === 'outlined');

  if (safeQuality === COMMON_QUALITY && !showCommon) return null;

  const text = showLabel ? qualityLabel(safeQuality, labels) : `Q${safeQuality + 1}`;

  return (
    <Tag
      variant={variant}
      title={tooltip}
      data-testid="rarity-tag"
      data-quality={safeQuality}
      style={{ ...chipStyle, marginInlineEnd: 0 }}
    >
      {text}
    </Tag>
  );
}
