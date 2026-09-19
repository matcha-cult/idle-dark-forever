/**
 * 主题契约（ui-kit 内部唯一真相，零运行时依赖）。
 *
 * **只有亮/暗两态**：不做 `'system'` 第三态，避免「三态切换 + OS 事件监听 + 首帧竞态」。
 * 紧凑（compact）不是配置项而是恒定行为，见 `build-theme-config.ts`，组件层因此
 * 一律**不传 `size`**，避免「紧凑 + small」叠加导致错位。
 */

/** 主题态：亮 / 暗（无第三态）。 */
export type ThemeMode = 'light' | 'dark';

/** 缺省主题态（暗黑奇幻题材默认暗色）。 */
export const DEFAULT_THEME_MODE: ThemeMode = 'dark';

/** 取相反主题态（一键切换的语义核心，纯函数）。 */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'dark' ? 'light' : 'dark';
}

/** 主题切换按钮的默认文案（点击后将切到的状态）。 */
export const THEME_TOGGLE_LABELS: Readonly<Record<ThemeMode, string>> = {
  light: '切换到亮色主题',
  dark: '切换到暗色主题',
};

/** 计算「点击后将切到哪一态」对应的提示文案。 */
export function themeToggleLabel(mode: ThemeMode): string {
  return THEME_TOGGLE_LABELS[nextThemeMode(mode)];
}

/** 把任意入参安全解析为 `ThemeMode`；非法值返回 `null`（调用方自行决定回退）。 */
export function parseThemeMode(raw: unknown): ThemeMode | null {
  return raw === 'light' || raw === 'dark' ? raw : null;
}
