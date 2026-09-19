/**
 * PageShell —— 页面级容器（标题 + 副标题 + 右侧操作 + 内容）。
 *
 * 只提供统一间距与层级，不含业务逻辑；内容区纵向 flex，方便子卡片自撑高度。
 * 颜色取 antd token，不传 `size`（全局 compact 已生效）。
 */
import { Flex, Typography, theme } from 'antd';
import type { ReactNode } from 'react';

export interface PageShellProps {
  /** 页面标题。 */
  title: ReactNode;
  /** 标题下方说明（灰色小字）。 */
  subtitle?: ReactNode;
  /** 标题右侧操作区。 */
  extra?: ReactNode;
  /** 页脚（可放分页/统计）。 */
  footer?: ReactNode;
  /** 内容区是否纵向撑满剩余高度，缺省 true。 */
  fill?: boolean;
  className?: string;
  children: ReactNode;
}

export function PageShell(props: PageShellProps) {
  const { title, subtitle, extra, footer, fill = true, className, children } = props;
  const { token } = theme.useToken();
  return (
    <Flex
      vertical
      gap={token.paddingSM}
      className={className}
      style={fill ? { flex: 1, minHeight: 0 } : undefined}
      data-testid="page-shell"
    >
      <Flex justify="space-between" align="flex-start" wrap gap={token.paddingXS}>
        <Flex vertical gap={0} style={{ minWidth: 0 }}>
          <Typography.Title level={4} style={{ margin: 0 }} data-testid="page-shell-title">
            {title}
          </Typography.Title>
          {subtitle === undefined ? null : (
            <Typography.Text style={{ color: token.colorTextTertiary }}>{subtitle}</Typography.Text>
          )}
        </Flex>
        {extra === undefined ? null : <Flex align="center" gap={token.paddingXS} wrap>{extra}</Flex>}
      </Flex>
      {children}
      {footer}
    </Flex>
  );
}
