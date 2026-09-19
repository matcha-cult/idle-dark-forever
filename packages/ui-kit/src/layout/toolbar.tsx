/**
 * Toolbar —— 面板工具条（左侧筛选/分组、右侧操作），窄屏自动换行不挤压。
 *
 * 只做「两端对齐 + 间距 + 换行」；按钮内容由调用方注入（`left` / `right` / `children`）。
 */
import { Flex, theme } from 'antd';
import type { ReactNode } from 'react';

export interface ToolbarProps {
  /** 左侧区（筛选、分段控件、统计）。 */
  left?: ReactNode;
  /** 右侧区（操作按钮）。 */
  right?: ReactNode;
  /** 附加内容（渲染在 `right` 之后）。 */
  children?: ReactNode;
  /** 是否允许换行，缺省 true。 */
  wrap?: boolean;
  /** 是否吸顶，缺省 false。 */
  sticky?: boolean;
}

export function Toolbar(props: ToolbarProps) {
  const { left, right, children, wrap = true, sticky = false } = props;
  const { token } = theme.useToken();
  return (
    <Flex
      justify="space-between"
      align="center"
      wrap={wrap}
      gap={token.paddingXS}
      data-testid="toolbar"
      style={{
        paddingBlock: token.paddingXXS,
        ...(sticky
          ? {
              position: 'sticky',
              top: 0,
              zIndex: 1,
              background: token.colorBgContainer,
            }
          : {}),
      }}
    >
      <Flex align="center" wrap gap={token.paddingXS} style={{ minWidth: 0 }}>
        {left}
      </Flex>
      <Flex align="center" wrap gap={token.paddingXS}>
        {right}
        {children}
      </Flex>
    </Flex>
  );
}
