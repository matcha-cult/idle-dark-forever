/**
 * 稀有度色板（**游戏设计色，归应用层**）。
 *
 * 为什么不在 ui-kit：色值是具体 hex，而 ui-kit 有「源码零内联 hex」硬门禁；
 * 且亮色主题需要可读的**名称文字**变体 —— 这属于本应用的视觉决策。
 *
 * **徽标底色两种主题完全一致**（就是设计给定的两个色），随主题变的只有**名称文字**：
 * 徽标是实色块 + 深色字，摆在任何底色的面板上都成立；而名称是**面板底色上的文字**，
 * `#ffff77` 对白底只有 1.06:1，必须换成同色系更深的变体。
 *
 * 取值依据（对比度按 WCAG 相对亮度实算，正文文字要求 ≥ 4.5:1）：
 *
 * | 主题 | 档位 | 徽标底（`chip`） | 名称文字（`name`） | 对比度 |
 * |---|---|---|---|---|
 * | dark | 稀有 | `#ffff77` | `#ffff77` | 对 `#141414` **17.4:1** |
 * | dark | 传奇 | `#ef6916` | `#ef6916` | 对 `#141414` **5.9:1** |
 * | light | 稀有 | `#ffff77` | `#7a6c00` | 对白底 **5.3:1** |
 * | light | 传奇 | `#ef6916` | `#c25200` | 对白底 **4.7:1** |
 *
 * 徽标上的文字（`chipText`）压在对应底色上：`#3d3600`/`#ffff77` = 11.5:1、
 * `#2b1000`/`#ef6916` = 5.7:1，**同样两种主题共用**。
 *
 * ⚠️ 反例留档：`#ffff77` 对白底 **1.06:1** —— 这就是它**不能**当亮色主题名称文字的原因，
 * `packages/web/test/rarity-palette.test.ts` 里有这条断言兜底。
 */
import type { RarityPalette, ThemeMode } from '@idle-dark/ui-kit';

/** 亮 / 暗两套色板（唯一真相）。 */
export const RARITY_PALETTES: Readonly<Record<ThemeMode, RarityPalette>> = {
  dark: {
    rare: { name: '#ffff77', chip: '#ffff77', chipText: '#3d3600' },
    legend: { name: '#ef6916', chip: '#ef6916', chipText: '#2b1000' },
  },
  light: {
    // 徽标底刻意与暗色主题**完全一致**：设计色就是 #ffff77 / #ef6916，换主题不换徽标
    rare: { name: '#7a6c00', chip: '#ffff77', chipText: '#3d3600' },
    legend: { name: '#c25200', chip: '#ef6916', chipText: '#2b1000' },
  },
};

/** 取某主题的色板；非法入参回退暗色（默认主题）。 */
export function rarityPaletteOf(mode: ThemeMode): RarityPalette {
  return RARITY_PALETTES[mode] ?? RARITY_PALETTES.dark;
}
