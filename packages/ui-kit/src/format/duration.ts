/**
 * 时长格式化（纯函数）：`mm:ss` / `h:mm:ss`，负值与非法值归零。
 * 离线结算、buff 剩余时间、副本计时共用。
 */

/** 毫秒 → `mm:ss`（超过 1 小时自动补 `h:`）。 */
export function formatDuration(ms: number): string {
  const numeric = Number(ms);
  const totalSeconds = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric / 1000) : 0;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** 毫秒 → 中文粗粒度（`3 小时 5 分钟`），用于离线收益这类大跨度文案。 */
export function formatDurationCn(ms: number): string {
  const numeric = Number(ms);
  const totalSeconds = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric / 1000) : 0;
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${restMinutes} 分钟`;
}
