/**
 * EmptyState —— 空态占位（无内容 / 未解锁 / 加载完成但为空）。
 *
 * 与 `feedback/error-boundary` 分工：这里表达「正常但没有数据」，不是错误。
 * 受控纯展示；颜色全部走 antd token；`bordered` 时用虚线边框提示「可放入内容」。
 */
import { Button, Empty, theme } from 'antd';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** 主文案。 */
  description?: ReactNode;
  /** 次要说明（灰色小字）。 */
  hint?: ReactNode;
  /** 主操作按钮文案；与 `onAction` 一起提供才渲染。 */
  actionText?: ReactNode;
  onAction?: () => void;
  /** 自定义插图。 */
  image?: ReactNode;
  /** 最小高度（px），缺省 120。 */
  height?: number;
  /** 虚线边框（拖放/可填充区域）。 */
  bordered?: boolean;
}

export function EmptyState(props: EmptyStateProps) {
  const {
    description = '暂无内容',
    hint,
    actionText,
    onAction,
    image,
    height = 120,
    bordered = false,
  } = props;
  const { token } = theme.useToken();

  return (
    <div
      data-testid="empty-state"
      style={{
        minHeight: height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: token.padding,
        border: bordered ? `1px dashed ${token.colorBorderSecondary}` : undefined,
        borderRadius: bordered ? token.borderRadiusSM : undefined,
      }}
    >
      <Empty
        image={image ?? Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <>
            <div style={{ color: token.colorTextSecondary }}>{description}</div>
            {hint === undefined ? null : (
              <div style={{ color: token.colorTextTertiary, fontSize: token.fontSizeSM }}>{hint}</div>
            )}
          </>
        }
      >
        {actionText !== undefined && onAction !== undefined ? (
          <Button type="primary" onClick={onAction} data-testid="empty-state-action">
            {actionText}
          </Button>
        ) : null}
      </Empty>
    </div>
  );
}
