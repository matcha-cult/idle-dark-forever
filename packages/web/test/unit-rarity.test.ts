/**
 * **怪物**稀有度四阶展示单测（W11）。
 *
 * 覆盖：
 * - 档位 → 文案一一对应，且文案来自协议 `UNIT_RARITY_NAMES`（防两侧漂移）；
 * - **精英（2）与传奇（3）不是同一个颜色** —— 这是把四阶做出来的意义所在；
 * - 稀有 / 传奇**复用装备稀有度的设计色**（`#ffff77` / `#ef6916`），不另挑颜色；
 * - 普通（0）/ 越界 / 缺失 / 非数字 → `null`（不贴徽标）；
 * - 徽标底与徽标文字对比度 ≥ 4.5:1（WCAG AA）—— 防止出现「浅底浅字」。
 */
import { describe, expect, it } from 'vitest';
import { UNIT_RARITY_NAMES } from '@idle-dark/protocol';
import type { RarityColor } from '@idle-dark/ui-kit';

import { unitRarityToneOf } from '../src/theme/unit-rarity.js';
import { RARITY_PALETTES } from '../src/theme/rarity-palette.js';

const DARK = RARITY_PALETTES.dark;
/** 与主题无关的徽标底/文字（颜色只在应用层，测试里直接给这份契约）。 */
const RARE: RarityColor = { name: DARK.rare.name, chip: DARK.rare.chip, chipText: DARK.rare.chipText };
const LEGEND: RarityColor = {
  name: DARK.legend.name,
  chip: DARK.legend.chip,
  chipText: DARK.legend.chipText,
};
/** antd 预设色 `purple` 与白色（真实值来自 `theme.useToken()`）。 */
const TOKENS = { purple: '#722ed1', colorWhite: '#ffffff' };

function tone(rarity: number | undefined) {
  return unitRarityToneOf(rarity, TOKENS, RARE, LEGEND);
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  return (
    0.2126 * channel(Number.parseInt(raw.slice(0, 2), 16)) +
    0.7152 * channel(Number.parseInt(raw.slice(2, 4), 16)) +
    0.0722 * channel(Number.parseInt(raw.slice(4, 6), 16))
  );
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

describe('unitRarityToneOf：怪物四阶展示', () => {
  it('文案与协议 UNIT_RARITY_NAMES 一致（普通档不贴标）', () => {
    expect(tone(1)?.label).toBe(UNIT_RARITY_NAMES[1]);
    expect(tone(2)?.label).toBe(UNIT_RARITY_NAMES[2]);
    expect(tone(3)?.label).toBe(UNIT_RARITY_NAMES[3]);
    expect(UNIT_RARITY_NAMES[2]).toBe('精英');
  });

  it('普通（0）→ null（不贴徽标，与装备 RarityTag 的普通档一致）', () => {
    expect(tone(0)).toBeNull();
  });

  it('越界 / 缺失 / 非数字 → null，绝不抛错', () => {
    for (const bad of [-1, 4, 99, Number.NaN, Infinity, -Infinity, null, undefined]) {
      expect(tone(bad as number), `rarity=${String(bad)}`).toBeNull();
    }
  });

  it('稀有 / 传奇复用装备稀有度的设计色（不另挑 hex）', () => {
    expect(tone(1)?.chip).toBe(DARK.rare.chip);
    expect(tone(1)?.chipText).toBe(DARK.rare.chipText);
    expect(tone(3)?.chip).toBe(DARK.legend.chip);
    expect(tone(3)?.chipText).toBe(DARK.legend.chipText);
  });

  it('**精英与传奇颜色必须不同**（否则四阶退化成三阶）', () => {
    expect(tone(2)?.chip).not.toBe(tone(3)?.chip);
    expect(tone(2)?.chip).not.toBe(tone(1)?.chip);
    expect(tone(2)?.chip).toBe(TOKENS.purple);
  });

  it('徽标上的对比度 ≥ 4.5:1（WCAG AA）', () => {
    for (const rarity of [1, 2, 3]) {
      const t = tone(rarity)!;
      expect(contrast(t.chip, t.chipText), `rarity=${rarity}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
