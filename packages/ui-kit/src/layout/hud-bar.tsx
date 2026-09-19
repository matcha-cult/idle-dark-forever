/**
 * HudBar —— 顶部资源条（金币 / 神力 / 等级 / 经验）。
 *
 * 刻意**不用 `Descriptions`**：游戏 HUD 需要的是紧凑横向聚类（小标签 + 粗数值），
 * 而 `Descriptions` 会引入表格语义与大量留白，窄屏会竖排成一长条。
 *
 * 颜色：标签用 `colorTextTertiary`、数值用 `colorText`，经验条用主题色，
 * 一律取 antd token。数值格式化走 `formatAmount`（纯函数、有单测）。
 */
import { Flex, Progress, Tooltip, Typography, theme } from 'antd';
import type { ReactNode } from 'react';
import { formatAmount } from '../format/number.js';

export interface HudBarProps {
  gold: number;
  diamonds: number;
  level: number;
  /** 当前经验（与 `maxExp` 一起显示进度条；缺省不显示）。 */
  exp?: number;
  maxExp?: number;
  /** 经验条左侧标签，缺省「经验」。 */
  expLabel?: string;
  /** 服务端累计模拟速率（倍速展示；<=1 或缺省时不显示）。 */
  speed?: number;
  /** 附加信息（角色名 / 地图名等）。 */
  extra?: ReactNode;
  /** 点击金币区的回调（打开商店等）。 */
  onGoldClick?: () => void;
}

/** HUD 单元（内部子组件，不对外导出）。 */
function HudMetric(props: {
  /** 稳定的英文标识，用于 data-testid（不要把中文标签拼进选择器）。 */
  name: string;
  label: string;
  value: string;
  tone?: string;
  onClick?: () => void;
}) {
  const { name, label, value, tone, onClick } = props;
  const { token } = theme.useToken();
  return (
    <Flex
      vertical
      gap={0}
      align="flex-start"
      style={{ cursor: onClick === undefined ? undefined : 'pointer' }}
      onClick={onClick}
    >
      <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
        {label}
      </Typography.Text>
      <Typography.Text
        strong
        style={{ color: tone ?? token.colorText, lineHeight: 1.1 }}
        data-testid={`hud-${name}`}
      >
        {value}
      </Typography.Text>
    </Flex>
  );
}

export function HudBar(props: HudBarProps) {
  const { gold, diamonds, level, exp, maxExp, expLabel = '经验', speed, extra, onGoldClick } = props;
  const { token } = theme.useToken();

  const showExp = typeof exp === 'number' && typeof maxExp === 'number' && maxExp > 0;
  const percent = showExp ? Math.min(100, Math.max(0, (exp / maxExp) * 100)) : 0;

  return (
    <Flex align="center" wrap gap={token.padding} data-testid="hud-bar">
      <Tooltip title="金币">
        <span>
          <HudMetric name="gold" label="金币" value={formatAmount(gold)} tone={token.gold} onClick={onGoldClick} />
        </span>
      </Tooltip>
      <Tooltip title="神力">
        <span>
          <HudMetric name="diamonds" label="神力" value={formatAmount(diamonds)} tone={token.purple} />
        </span>
      </Tooltip>
      <HudMetric name="level" label="等级" value={formatAmount(level)} tone={token.colorPrimary} />
      {showExp ? (
        <Flex align="center" gap={token.paddingXS} data-testid="hud-exp">
          <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
            {expLabel}
          </Typography.Text>
          <Progress
            percent={percent}
            size={{ width: 120, height: 8 }}
            showInfo={false}
            strokeColor={token.colorPrimary}
            railColor={token.colorFillSecondary}
            style={{ marginBottom: 0 }}
          />
          <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary }}>
            {`${formatAmount(exp)}/${formatAmount(maxExp)}`}
          </Typography.Text>
        </Flex>
      ) : null}
      {typeof speed === 'number' && speed > 1 ? (
        <Typography.Text style={{ color: token.colorSuccess }} data-testid="hud-speed">
          {`×${speed.toFixed(1)}`}
        </Typography.Text>
      ) : null}
      {extra}
    </Flex>
  );
}
