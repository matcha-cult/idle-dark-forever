/**
 * 品质（Quality）展示契约 —— **3 档**：普通 / 稀有 / 传奇（P4 + 稀有度视觉改版）。
 *
 * 为什么本地再写一份文案：`@idle-dark/protocol` 的 `QUALITY_NAMES` 是**值**导出，
 * 本包的红线是「运行时只依赖 antd + react」，只能 `import type`、不能 import 值。
 * 因此这里复制 3 档文案，并由 `quality.test.ts` 直接读 protocol 源码做**一致性断言**，
 * 漂移会在 `pnpm test` 阶段被抓出来（协议仍是唯一真相）。
 *
 * **颜色不在这里**：色板由应用层经 `RarityPaletteProvider` 注入（见 `rarity-palette.tsx`）。
 * 原因是硬门禁 —— 本包源码**零内联 hex**（`hygiene.test.ts`），而「金黄色 `#ffff77` /
 * 橙色 `#ef6916`」是**游戏专属**配色，不属于通用组件库；把它放出去也让亮/暗主题
 * 各自用一套可读色成为纯应用层决策。
 */
import type { Quality } from '@idle-dark/protocol';

/** 3 档品质文案（与 protocol `QUALITY_NAMES` 一致，由门禁测试断言）。 */
export const QUALITY_LABELS: readonly string[] = ['普通', '稀有', '传奇'];

/** 最高品质档位（0 起算）。 */
export const MAX_QUALITY = 2;

/** 最低档位（普通）—— 默认**不渲染**品质徽标。 */
export const COMMON_QUALITY = 0;

/**
 * 把任意入参夹取到合法品质 0..2（不抛错）：
 * `NaN` / `undefined` → 0（未知按最低档），`+Infinity` → 2（越界按最高档），
 * `-Infinity` / 负数 → 0，小数 `Math.trunc`。
 */
export function clampQuality(value: number): Quality {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return numeric > 0 ? MAX_QUALITY : 0;
  const truncated = Math.trunc(numeric);
  if (truncated <= 0) return 0;
  if (truncated >= MAX_QUALITY) return MAX_QUALITY;
  return truncated as Quality;
}

/** 品质文案；`labels` 覆盖时该位缺失（长度不足）回退内置文案。 */
export function qualityLabel(quality: number, labels?: readonly string[]): string {
  const index = clampQuality(quality);
  const custom = labels?.[index];
  if (custom !== undefined) return custom;
  return QUALITY_LABELS[index] ?? QUALITY_LABELS[0] ?? '';
}
