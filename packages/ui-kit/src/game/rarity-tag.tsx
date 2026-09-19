/**
 * RarityTag —— 品质徽标（7 档：普通/优秀/精良/史诗/传说/远古/神器）。
 *
 * 颜色纪律：色值只来自 `theme.useToken()`（token 名见 `quality.ts`），
 * 因此亮/暗主题与自定义主色下都自动协调，且源码里不出现任何内联 hex。
 *
 * 边界：`quality` 非有限数 / 负 / 小数 / 越界一律夹取到 0..6。
 * 插槽：无（纯展示）；`labels` 可整体覆盖文案（缺位回退内置 7 档）。
 */
import { Tag, theme } from 'antd';
import type { Quality } from '@idle-dark/protocol';
import { clampQuality, qualityColorTokenName, qualityLabel } from './quality.js';

export interface RarityTagProps {
  /** 品质档位（0..6，越界自动夹取）。 */
  quality: Quality | number;
  /** 覆盖默认文案；长度不足 7 时缺失位回退内置文案。 */
  labels?: readonly string[];
  /** 是否显示档位文案，缺省 true；false 时只显示 `Q1` 这类序号徽标。 */
  showLabel?: boolean;
  /** antd v6 `Tag.variant`，缺省 `filled`。 */
  variant?: 'filled' | 'solid' | 'outlined';
  /** 悬浮说明（缺省用「品质：xxx」）。 */
  tooltip?: string;
}

export function RarityTag(props: RarityTagProps) {
  const { quality, labels, showLabel = true, variant = 'filled', tooltip } = props;
  const { token } = theme.useToken();
  // 夹取一次，色 / 文案 / data 属性全部基于同一个值，避免「显示普通但 data 是 99」
  const safeQuality = clampQuality(quality);
  const color = token[qualityColorTokenName(safeQuality)];
  const text = showLabel ? qualityLabel(safeQuality, labels) : `Q${safeQuality + 1}`;

  return (
    <Tag
      color={color}
      variant={variant}
      title={tooltip}
      data-testid="rarity-tag"
      data-quality={safeQuality}
      style={{ marginInlineEnd: 0 }}
    >
      {text}
    </Tag>
  );
}
