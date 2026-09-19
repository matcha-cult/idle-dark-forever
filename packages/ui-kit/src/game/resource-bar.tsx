/**
 * ResourceBar —— 五类战斗资源条（生命 / 法力 / 怒气 / 能量 / 连击）。
 *
 * 用 antd `Progress` 的 `success` 段实现**分段**：主段是当前值，第二段是护盾 / 吸收量，
 * 因此「100/200 血 + 30 护盾」能在一根条内读完，不需要另起一根。
 *
 * 颜色纪律：色值由 `theme.useToken()` 提供（token 名见 `RESOURCE_COLOR_TOKEN_NAMES`），
 * 禁内联 hex。数值只做**展示层**夹取（不参与任何游戏公式）：
 * - `max <= 0` → 0%；`current < 0` → 0%；`current > max` → 100%；
 * - `NaN` / `Infinity` / `undefined` → 视为 0；
 * - `shield` 的百分比按 `max` 计算，并与主段一起夹取到 100%。
 */
import { Flex, Progress, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import { formatAmount, formatPercent } from '../format/number.js';

export type ResourceKind = 'hp' | 'mp' | 'rp' | 'ep' | 'combo';

/** 资源中文名。 */
export const RESOURCE_LABELS: Readonly<Record<ResourceKind, string>> = {
  hp: '生命',
  mp: '法力',
  rp: '怒气',
  ep: '能量',
  combo: '连击',
};

/** 资源 → antd 色 token 名（`as const` 保证可安全索引 `token`）。 */
export const RESOURCE_COLOR_TOKEN_NAMES = {
  hp: 'colorError',
  mp: 'colorInfo',
  rp: 'colorWarning',
  ep: 'purple',
  combo: 'colorSuccess',
} as const;

/** 资源色 token 名联合类型。 */
export type ResourceColorTokenName = (typeof RESOURCE_COLOR_TOKEN_NAMES)[ResourceKind];

export interface ResourceBarProps {
  kind: ResourceKind;
  current: number;
  max: number;
  /** 护盾 / 吸收量（渲染为第二段）。 */
  shield?: number;
  /** 覆盖默认标签。 */
  label?: ReactNode;
  /** 是否显示百分比，缺省 false。 */
  showPercent?: boolean;
  /** 是否显示 `current/max` 数值，缺省 true。 */
  showValues?: boolean;
  /** 条长（px），缺省 120。 */
  width?: number;
  /** 条高（px），缺省 8。 */
  height?: number;
  /** 整块右侧补充区。 */
  suffix?: ReactNode;
}

/** 任意入参（含 undefined / null / NaN / Infinity）→ 有限数。 */
function toFinite(value: number | null | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function ResourceBar(props: ResourceBarProps) {
  const {
    kind,
    current,
    max,
    shield,
    label,
    showPercent = false,
    showValues = true,
    width = 120,
    height = 8,
    suffix,
  } = props;
  const { token } = theme.useToken();

  const safeMax = toFinite(max);
  const safeCurrent = toFinite(current);
  const safeShield = toFinite(shield);
  const ratio = safeMax > 0 ? (safeCurrent / safeMax) * 100 : 0;
  const percent = Math.min(100, Math.max(0, ratio));
  const shieldPercent = safeMax > 0 ? Math.min(100 - percent, Math.max(0, (safeShield / safeMax) * 100)) : 0;
  const color = token[RESOURCE_COLOR_TOKEN_NAMES[kind]];

  const valueText = showValues
    ? `${formatAmount(safeCurrent)}/${formatAmount(safeMax)}${safeShield > 0 ? ` (+${formatAmount(safeShield)})` : ''}`
    : '';

  return (
    <Flex align="center" gap={token.marginXS} data-testid={`resource-bar-${kind}`} data-kind={kind}>
      <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary, minWidth: 32 }}>
        {label ?? RESOURCE_LABELS[kind]}
      </Typography.Text>
      <Progress
        percent={percent}
        {...(shieldPercent > 0
          ? { success: { percent: shieldPercent, strokeColor: token.colorTextTertiary } }
          : {})}
        strokeColor={color}
        trailColor={token.colorFillSecondary}
        size={{ width, height }}
        showInfo={false}
        style={{ marginBottom: 0 }}
      />
      <Typography.Text
        style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary, whiteSpace: 'nowrap' }}
        data-testid={`resource-bar-${kind}-value`}
      >
        {showPercent ? `${formatPercent(percent)} ${valueText}`.trim() : valueText}
      </Typography.Text>
      {suffix}
    </Flex>
  );
}
