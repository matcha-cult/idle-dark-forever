/**
 * 稀有度色板单测（纯数据 + 对比度门禁，无 DOM）。
 *
 * 覆盖：
 * - 暗色主题**必须**是设计指定的 `#ffff77` / `#ef6916`（改动即失败，防止被顺手「优化」掉）；
 * - **徽标底色两种主题完全一致**（这就是设计色，不随主题换）—— 关键回归；
 * - 名称文字在亮色主题是**同色系的更深变体**（不得与暗色相同，也不得不可读）；
 * - 每一档都同时给出名称色、徽标底色、徽标上的对比文字色；
 * - 非法主题入参回退暗色；
 * - **对比度门禁**：名称文字 ≥ 4.5:1（WCAG AA），徽标上的文字同样 ≥ 4.5:1。
 *   这条门禁的意义：`#ffff77` 对白底只有 1.06:1 —— 谁把它挪到亮色主题的**名称文字**，测试立刻红。
 */
import { describe, expect, it } from 'vitest';
import type { ThemeMode } from '@idle-dark/ui-kit';
import { RARITY_PALETTES, rarityPaletteOf } from '../src/theme/rarity-palette.js';

/** 暗色主题的内容底色（antd `darkAlgorithm` 的 `colorBgContainer`）。 */
const DARK_BG = '#141414';
/** 亮色主题的内容底色。 */
const LIGHT_BG = '#ffffff';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度。 */
function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度（1~21）。 */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

describe('RARITY_PALETTES', () => {
  it('暗色主题的名称色就是设计给定的两个色值', () => {
    expect(RARITY_PALETTES.dark.rare.name).toBe('#ffff77');
    expect(RARITY_PALETTES.dark.legend.name).toBe('#ef6916');
  });

  it('徽标底色两种主题完全一致（设计色不随主题换）', () => {
    for (const tier of ['rare', 'legend'] as const) {
      expect(RARITY_PALETTES.light[tier].chip).toBe(RARITY_PALETTES.dark[tier].chip);
      expect(RARITY_PALETTES.light[tier].chipText).toBe(RARITY_PALETTES.dark[tier].chipText);
    }
    // 徽标底就是用户给的那两个色，不能被「亮色变体」替换掉
    expect(RARITY_PALETTES.light.rare.chip).toBe('#ffff77');
    expect(RARITY_PALETTES.light.legend.chip).toBe('#ef6916');
  });

  it('亮色主题的名称文字是同色系深色变体（两档都与暗色不同）', () => {
    expect(RARITY_PALETTES.light.rare.name).not.toBe(RARITY_PALETTES.dark.rare.name);
    expect(RARITY_PALETTES.light.legend.name).not.toBe(RARITY_PALETTES.dark.legend.name);
    // 更深 = 相对亮度更低
    expect(luminance(RARITY_PALETTES.light.rare.name)).toBeLessThan(
      luminance(RARITY_PALETTES.dark.rare.name),
    );
    expect(luminance(RARITY_PALETTES.light.legend.name)).toBeLessThan(
      luminance(RARITY_PALETTES.dark.legend.name),
    );
  });

  it('每档都给了非空且合法的三色', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const tier of ['rare', 'legend'] as const) {
        const entry = RARITY_PALETTES[mode][tier];
        expect(entry.name).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(entry.chip).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(entry.chipText).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('名称文字对比度 ≥ 4.5:1（暗色对内容底、亮色对白底）', () => {
    for (const tier of ['rare', 'legend'] as const) {
      expect(contrast(RARITY_PALETTES.dark[tier].name, DARK_BG)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(RARITY_PALETTES.light[tier].name, LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('徽标上的文字对比度 ≥ 4.5:1（两种主题同一组色）', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const tier of ['rare', 'legend'] as const) {
        const { chip, chipText } = RARITY_PALETTES[mode][tier];
        expect(contrast(chipText, chip)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('反例留档：#ffff77 对白底只有约 1.06:1，绝不能当亮色主题的名称文字', () => {
    expect(contrast('#ffff77', LIGHT_BG)).toBeLessThan(1.1);
    expect(RARITY_PALETTES.light.rare.name).not.toBe('#ffff77');
  });
});

describe('rarityPaletteOf', () => {
  it('按主题返回对应色板', () => {
    expect(rarityPaletteOf('dark')).toBe(RARITY_PALETTES.dark);
    expect(rarityPaletteOf('light')).toBe(RARITY_PALETTES.light);
  });

  it('非法入参回退暗色（默认主题）', () => {
    expect(rarityPaletteOf('sepia' as ThemeMode)).toBe(RARITY_PALETTES.dark);
    expect(rarityPaletteOf(undefined as unknown as ThemeMode)).toBe(RARITY_PALETTES.dark);
  });
});
