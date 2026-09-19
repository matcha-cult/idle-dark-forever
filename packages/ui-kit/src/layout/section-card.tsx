/**
 * SectionCard —— 面板卡片（带标题/操作区的统一容器）。
 *
 * antd v6 用 `variant` 取代 `bordered`；内边距走 `styles.body`（`bodyStyle` 已弃用）。
 * `dense` 缺省 true：游戏面板信息密度高，紧凑内边距是常态。
 */
import { Card, theme } from 'antd';
import type { ReactNode } from 'react';

export interface SectionCardProps {
  /** 卡片标题（可省略，省略时只有内容区）。 */
  title?: ReactNode;
  /** 标题右侧操作区。 */
  extra?: ReactNode;
  /** 内容区下方的次要说明。 */
  description?: ReactNode;
  /** antd v6 `Card.variant`，缺省 `outlined`。 */
  variant?: 'outlined' | 'borderless';
  /** 加载骨架。 */
  loading?: boolean;
  /** 紧凑内边距（缺省 true）。 */
  dense?: boolean;
  className?: string;
  /** 内容区高度（如滚动面板用固定高度）。 */
  bodyHeight?: number | string;
  children: ReactNode;
}

export function SectionCard(props: SectionCardProps) {
  const { title, extra, description, variant = 'outlined', loading, dense = true, className, bodyHeight, children } = props;
  const { token } = theme.useToken();

  return (
    <Card
      className={className}
      variant={variant}
      loading={loading === true}
      title={title}
      extra={extra}
      styles={{
        body: {
          padding: dense ? token.paddingSM : token.padding,
          ...(bodyHeight === undefined ? {} : { height: bodyHeight, overflow: 'auto' }),
        },
      }}
      data-testid="section-card"
    >
      {description === undefined ? null : (
        <div style={{ marginBottom: token.marginXS }}>{description}</div>
      )}
      {children}
    </Card>
  );
}
