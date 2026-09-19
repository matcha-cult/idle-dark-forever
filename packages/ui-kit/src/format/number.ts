/**
 * 数值展示格式化（纯函数，规避 `Intl` 在不同 Node/浏览器/ICU 下的差异）。
 * 只做展示层安全处理，不参与任何游戏数值计算。
 */

/** 千分位整数；`NaN` / `Infinity` / `undefined` → `'0'`；小数截断（面板只显示整数资源）。 */
export function formatAmount(value: number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  const truncated = Math.trunc(numeric);
  const sign = truncated < 0 ? '-' : '';
  return sign + String(Math.abs(truncated)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 百分比文案（保留 1 位小数，去掉多余的 `.0`）。 */
export function formatPercent(value: number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0%';
  const rounded = Math.round(numeric * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

/** 大数压缩：1.2万 / 3.4亿（中文习惯，HUD 窄位用）。 */
export function formatCompact(value: number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  const abs = Math.abs(numeric);
  const units: ReadonlyArray<readonly [number, string]> = [
    [1e8, '亿'],
    [1e4, '万'],
  ];
  for (const [scale, unit] of units) {
    if (abs >= scale) return `${(numeric / scale).toFixed(1)}${unit}`;
  }
  return formatAmount(numeric);
}
