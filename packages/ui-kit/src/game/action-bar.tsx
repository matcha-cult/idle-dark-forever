/**
 * ActionBar —— 操作按钮条（配置驱动，键盘可达）。
 *
 * 只做「把一组操作渲染成带 tooltip / 快捷键提示的按钮」；`onClick` 由调用方注入，
 * 组件不关心点了之后发生什么（受控、无业务状态）。
 *
 * 边界：`actions=[]` 渲染空容器不崩；`disabled` 与 `loading` 同时为真时按钮 disabled；
 * 带 `hint` 的操作在按钮上显示快捷键角标（纯展示，不注册真实快捷键）。
 */
import { Button, Flex, Tooltip, Typography, theme } from 'antd';
import type { ButtonProps } from 'antd';
import type { ReactNode } from 'react';

export interface ActionItem {
  key: string;
  label: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: ButtonProps['type'];
  danger?: boolean;
  /** 悬浮说明。 */
  tooltip?: string;
  /** 快捷键提示（如 `空格`），只展示不绑定。 */
  hint?: string;
}

export interface ActionBarProps {
  actions: readonly ActionItem[];
  /** 主对齐方式，缺省 `start`。 */
  align?: 'start' | 'center' | 'end' | 'between';
  /** 是否换行，缺省 true。 */
  wrap?: boolean;
  /** 按钮统一禁用（如战斗暂停时）。 */
  disabled?: boolean;
  /** 附加内容（渲染在按钮之后）。 */
  children?: ReactNode;
}

export function ActionBar(props: ActionBarProps) {
  const { actions, align = 'start', wrap = true, disabled = false, children } = props;
  const { token } = theme.useToken();

  return (
    <Flex
      align="center"
      wrap={wrap}
      gap={token.marginXS}
      justify={align === 'between' ? 'space-between' : align === 'start' ? 'flex-start' : align}
      data-testid="action-bar"
    >
      {actions.map((action) => {
        const button = (
          <Button
            key={action.key}
            type={action.type ?? 'default'}
            danger={action.danger ?? false}
            loading={action.loading ?? false}
            disabled={disabled || action.disabled === true || action.loading === true}
            onClick={action.onClick}
            data-testid={`action-${action.key}`}
          >
            {action.label}
            {action.hint === undefined ? null : (
              <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                {` ${action.hint}`}
              </Typography.Text>
            )}
          </Button>
        );
        return action.tooltip === undefined ? (
          button
        ) : (
          <Tooltip key={action.key} title={action.tooltip}>
            {button}
          </Tooltip>
        );
      })}
      {children}
    </Flex>
  );
}
