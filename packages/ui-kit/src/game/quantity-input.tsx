/**
 * QuantityInput —— 数量选择（1 / 10 / 最大 + 手输）。
 *
 * 受控组件：`value` + `onChange`，**不持有业务状态**；所有夹取都在展示层完成：
 * - `max` 非法或 <=0 → 允许上限为 0（按钮禁用）；
 * - 手输非数字 / 越界 → 夹到 `[min, max]`；
 * - 快捷按钮文案可定制（`stepLabel`），但步长语义固定为「加 N 与直接拉满」。
 */
import { Button, Flex, InputNumber, Space, theme } from 'antd';
import { formatAmount } from '../format/number.js';

export interface QuantityInputProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
  /** 下限，缺省 1。 */
  min?: number;
  /** 快捷步长，缺省 10。 */
  step?: number;
  /** 快捷按钮文案（如「10」→「1 组」）。 */
  stepLabel?: string;
  /** 最大按钮文案，缺省「最大」。 */
  maxLabel?: string;
  disabled?: boolean;
  /** 数字输入框宽度，缺省 96。 */
  width?: number;
}

export function QuantityInput(props: QuantityInputProps) {
  const {
    value,
    max,
    onChange,
    min = 1,
    step = 10,
    stepLabel,
    maxLabel = '最大',
    disabled = false,
    width = 96,
  } = props;
  const { token } = theme.useToken();

  const safeMax = Number.isFinite(max) ? Math.max(0, Math.trunc(max)) : 0;
  const safeMin = Math.min(Math.max(0, Math.trunc(min)), safeMax);
  const clamp = (next: number): number => Math.min(safeMax, Math.max(safeMin, Math.trunc(next)));

  return (
    <Flex align="center" gap={token.marginXXS} wrap data-testid="quantity-input">
      <InputNumber
        value={value}
        min={safeMin}
        max={safeMax}
        precision={0}
        disabled={disabled}
        style={{ width }}
        data-testid="quantity-input-number"
        onChange={(next) => onChange(clamp(typeof next === 'number' ? next : safeMin))}
      />
      <Space.Compact>
        <Button
          disabled={disabled || safeMax === 0 || value === clamp(1)}
          data-testid="quantity-input-one"
          onClick={() => onChange(clamp(1))}
        >
          1
        </Button>
        <Button
          disabled={disabled || safeMax === 0 || value === clamp(step)}
          data-testid="quantity-input-step"
          onClick={() => onChange(clamp(step))}
        >
          {stepLabel ?? formatAmount(step)}
        </Button>
        <Button
          disabled={disabled || safeMax === 0 || value === safeMax}
          data-testid="quantity-input-max"
          onClick={() => onChange(safeMax)}
        >
          {`${maxLabel}(${formatAmount(safeMax)})`}
        </Button>
      </Space.Compact>
    </Flex>
  );
}
