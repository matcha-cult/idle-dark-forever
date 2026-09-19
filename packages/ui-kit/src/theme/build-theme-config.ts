/**
 * antd 主题配置构造（**纯函数**，优先单测）。
 *
 * 紧凑恒开：`compactAlgorithm` 永远在 algorithm 数组中，因此组件级不再各自设 `size`。
 *
 * 颜色纪律：本文件**不出现任何内联 hex**。缺省主色直接取 antd 自己的 seed token
 * （`theme.defaultSeed.colorPrimary`），由 antd 提供色值，ui-kit 不私藏色板。
 */
import { theme, type ThemeConfig } from 'antd';
import { type ThemeMode } from './types.js';

export interface BuildThemeConfigInput {
  mode: ThemeMode;
  /** 覆盖主题色；缺省用 antd seed 的 `colorPrimary`。 */
  primaryColor?: string;
}

/** 缺省主题色：由 antd seed token 提供（不是写死在本仓的 hex）。 */
export function defaultPrimaryColor(): string {
  return theme.defaultSeed.colorPrimary;
}

/** 归一化主题色：空串 / 纯空白 / 非字符串一律回退缺省值。 */
function resolvePrimaryColor(override: string | undefined): string {
  return typeof override === 'string' && override.trim() !== '' ? override : defaultPrimaryColor();
}

export function buildThemeConfig(input: BuildThemeConfigInput): ThemeConfig {
  const base = input.mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm;
  return {
    // 顺序：基色算法 → 紧凑派生（紧凑恒在，不是可选项）
    algorithm: [base, theme.compactAlgorithm],
    token: {
      colorPrimary: resolvePrimaryColor(input.primaryColor),
      borderRadius: 6,
    },
  };
}

/** 供测试/诊断：判定某模式下的 algorithm 是否恒含紧凑算法。 */
export function hasCompactAlgorithm(input: BuildThemeConfigInput): boolean {
  const config = buildThemeConfig(input);
  const algorithms = Array.isArray(config.algorithm) ? config.algorithm : [config.algorithm];
  return algorithms.includes(theme.compactAlgorithm);
}
