/**
 * ThemeToggle —— 一键亮/暗切换（纯展示，受控）。
 *
 * 无 store 依赖：`value` + `onChange` 由容器注入，可独立渲染与单测。
 * 图标用**字符**而非 `@ant-design/icons`：本包的硬约束是「运行时只依赖 antd + react」，
 * 图标字体不是 peer 依赖，因此不引入。
 * 图标-only 按钮必须有可读名称（`aria-label`），保证键盘与读屏可用。
 */
import { Button, Tooltip } from 'antd';
import { nextThemeMode, themeToggleLabel, type ThemeMode } from './types.js';

/** 目标态的图标字符（切换后会变成的状态）。 */
const TOGGLE_GLYPHS: Readonly<Record<ThemeMode, string>> = {
  light: '☀',
  dark: '☾',
};

export interface ThemeToggleProps {
  /** 当前主题态（受控）。 */
  value: ThemeMode;
  /** 点击后回调「相反态」。 */
  onChange: (mode: ThemeMode) => void;
  disabled?: boolean;
  /** 自定义提示文案（同时作为 aria-label）。 */
  label?: string;
  /** 按钮形态，缺省 `circle`。 */
  shape?: 'circle' | 'default';
}

export function ThemeToggle(props: ThemeToggleProps) {
  const { value, onChange, disabled, label, shape = 'circle' } = props;
  const target = nextThemeMode(value);
  const title = label ?? themeToggleLabel(value);
  return (
    <Tooltip title={title}>
      <Button
        type="text"
        shape={shape}
        disabled={disabled}
        aria-label={title}
        data-testid="theme-toggle"
        data-target-mode={target}
        onClick={() => onChange(target)}
      >
        {TOGGLE_GLYPHS[target]}
      </Button>
    </Tooltip>
  );
}
