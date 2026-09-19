/**
 * ConnectionBadge —— 长连接状态徽标（idle / connecting / online / reconnecting / failed）。
 *
 * 语义映射刻意用 antd `Badge.status` 的语义色（不是自造色）：
 * `idle→default`、`connecting→processing`、`online→success`、
 * `reconnecting→warning`、`failed→error`。颜色由 antd token 派生，零内联 hex。
 *
 * 受控纯展示：状态只来自 props；组件不订阅任何 store / 传输层。
 * 边界：未知状态字符串一律回退 `idle`（不会渲染成空白）。
 */
import { Badge, theme } from 'antd';
import type { BadgeProps } from 'antd';

/** 连接状态。 */
export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'failed';

/** 状态中文文案。 */
export const CONNECTION_LABELS: Readonly<Record<ConnectionStatus, string>> = {
  idle: '未连接',
  connecting: '连接中',
  online: '在线',
  reconnecting: '重连中',
  failed: '连接失败',
};

/** 状态 → antd `Badge.status`。 */
export const CONNECTION_BADGE_STATUS: Readonly<Record<ConnectionStatus, BadgeProps['status']>> = {
  idle: 'default',
  connecting: 'processing',
  online: 'success',
  reconnecting: 'warning',
  failed: 'error',
};

export interface ConnectionBadgeProps {
  status: ConnectionStatus;
  /** 覆盖文案；缺省取 `CONNECTION_LABELS[status]`。 */
  text?: string;
  /** 是否显示文案，缺省 true（false 时只显示圆点）。 */
  showText?: boolean;
  /** 悬浮说明；缺省在 failed/reconnecting 时显示 `lastError`。 */
  tooltip?: string;
  /** 最近一次错误（用于 failed 态的悬浮说明）。 */
  lastError?: string;
  /** 单击（如手动重连）。 */
  onClick?: () => void;
}

export function ConnectionBadge(props: ConnectionBadgeProps) {
  const { status, text, showText = true, tooltip, lastError, onClick } = props;
  const { token } = theme.useToken();

  const raw: ConnectionStatus = status;
  const safeStatus: ConnectionStatus =
    raw === 'connecting' || raw === 'online' || raw === 'reconnecting' || raw === 'failed' ? raw : 'idle';

  const title = tooltip ?? (safeStatus === 'failed' || safeStatus === 'reconnecting' ? lastError : undefined);
  const label = text ?? CONNECTION_LABELS[safeStatus];

  return (
    <span
      title={title}
      onClick={onClick}
      data-testid="connection-badge"
      data-status={safeStatus}
      style={{ cursor: onClick === undefined ? undefined : 'pointer', whiteSpace: 'nowrap' }}
    >
      <Badge
        status={CONNECTION_BADGE_STATUS[safeStatus]}
        text={
          showText ? (
            <span style={{ color: token.colorTextSecondary, fontSize: token.fontSizeSM }}>{label}</span>
          ) : undefined
        }
      />
    </span>
  );
}
