/**
 * LabeledField —— 受控表单行的统一包裹（标签 + 控件 + 帮助/错误文案）。
 *
 * 为什么不直接用 antd `Form`：本仓前端的状态来源是服务端权威 DTO + 显式意图提交，
 * 大量面板只需要「一个标签 + 一个受控控件 + 一行校验结果」，套 `Form` 反而引入
 * 实例/校验/store 的隐式状态。需要 antd `Form` 的页面仍可自行使用它。
 *
 * 受控纯展示：不含任何校验逻辑，`error` / `help` 由调用方决定怎么算。
 * 颜色纪律：错误红用 `token.colorError`、帮助文字用 `token.colorTextTertiary`。
 *
 * 边界：`error` 与 `help` 同时存在时**错误优先**（帮助文案让位）；
 *      `required` 只影响标记（星号）与 `aria-required`，不做校验。
 */
import { Flex, Typography, theme } from 'antd';
import type { ReactNode } from 'react';

export interface LabeledFieldProps {
  label: ReactNode;
  /** 控件（Input / InputNumber / Select …）。 */
  children: ReactNode;
  /** 必填标记（星号 + aria-required）。 */
  required?: boolean;
  /** 帮助文案。 */
  help?: ReactNode;
  /** 错误文案（优先于 `help`）。 */
  error?: ReactNode;
  /** 关联控件的 id。 */
  htmlFor?: string;
  /** 标签右侧附加区（如「最大」按钮）。 */
  extra?: ReactNode;
  /** 横向布局（标签与控件同行），缺省 true。 */
  inline?: boolean;
  /** 标签固定宽度（inline 时生效），缺省 72。 */
  labelWidth?: number;
  disabled?: boolean;
}

export function LabeledField(props: LabeledFieldProps) {
  const {
    label,
    children,
    required = false,
    help,
    error,
    htmlFor,
    extra,
    inline = true,
    labelWidth = 72,
    disabled = false,
  } = props;
  const { token } = theme.useToken();

  const message = error ?? help;
  const messageColor = error === undefined ? token.colorTextTertiary : token.colorError;

  return (
    <Flex
      vertical={!inline}
      align={inline ? 'center' : 'flex-start'}
      gap={token.marginXS}
      data-testid="labeled-field"
      data-invalid={error === undefined ? undefined : true}
      style={{ opacity: disabled ? 0.6 : 1 }}
    >
      <Flex align="center" gap={token.marginXXS} style={inline ? { width: labelWidth, flex: 'none' } : undefined}>
        <Typography.Text
          style={{ color: token.colorTextSecondary, fontSize: token.fontSizeSM }}
          aria-required={required || undefined}
        >
          {required ? (
            <span style={{ color: token.colorError }} aria-hidden="true">
              *{' '}
            </span>
          ) : null}
          <label htmlFor={htmlFor}>{label}</label>
        </Typography.Text>
        {extra}
      </Flex>
      <Flex vertical gap={0} style={{ flex: 1, minWidth: 0, width: inline ? undefined : '100%' }}>
        {children}
        {message === undefined ? null : (
          <Typography.Text
            data-testid="labeled-field-message"
            style={{ color: messageColor, fontSize: token.fontSizeSM }}
          >
            {message}
          </Typography.Text>
        )}
      </Flex>
    </Flex>
  );
}
