/**
 * 稀有度色板 —— **由应用层注入**（游戏专属配色不进通用组件库）。
 *
 * 为什么不让 ui-kit 自带色值：
 * 1. 本包有硬门禁「源码零内联 hex」（`hygiene.test.ts`），而稀有度色是**具体色值**；
 * 2. 「金黄色 / 橙色」是这款游戏的视觉身份，且亮色主题下**名称文字**需要同色系更深的变体 ——
 *    这属于**应用层决策**，通用组件库只提供「取哪一档颜色」的契约。
 *
 * 未注入时回退到 antd token（`green` / `gold`），组件在任何环境下都能渲染。
 * `普通` 档不参与色板：它默认不显示徽标，取色时一律用主题正文色。
 */
import { theme } from 'antd';
import { createContext, useContext, useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { COMMON_QUALITY, clampQuality } from './quality.js';

/** 一档稀有度的配色。 */
export interface RarityColor {
  /** **名称文字**色 —— 随主题（亮色主题要用更深的同色系变体才看得清）。 */
  readonly name: string;
  /** **徽标底色** —— 不随主题的设计色（实色块，两种主题下都是同一个色）。 */
  readonly chip: string;
  /** 徽标上的文字色（与 `chip` 成对比）。 */
  readonly chipText: string;
}

/** 稀有（档位 1）与传奇（档位 2）的色板。 */
export interface RarityPalette {
  readonly rare: RarityColor;
  readonly legend: RarityColor;
}

const RarityPaletteContext = createContext<RarityPalette | null>(null);

export interface RarityPaletteProviderProps {
  /** 缺省 / `undefined` 时用 antd token 回退色。 */
  palette?: RarityPalette;
  children: ReactNode;
}

export function RarityPaletteProvider(props: RarityPaletteProviderProps) {
  const { palette, children } = props;
  return <RarityPaletteContext.Provider value={palette ?? null}>{children}</RarityPaletteContext.Provider>;
}

/**
 * 取某档配色。**夹取后**再查表，因此 `quality` 为 `NaN` / 负 / 小数 / 越界都安全。
 * 普通档返回主题正文色（该档默认不渲染徽标，此色只用于物品名）。
 */
export function useRarityColor(quality: number): RarityColor {
  const palette = useContext(RarityPaletteContext);
  const { token } = theme.useToken();
  const safe = clampQuality(quality);
  if (safe === COMMON_QUALITY) return { name: token.colorText, chip: token.colorTextSecondary, chipText: token.colorWhite };
  if (palette !== null) return safe === 1 ? palette.rare : palette.legend;
  const fallback = safe === 1 ? token.green : token.gold;
  return { name: fallback, chip: fallback, chipText: token.colorWhite };
}

/**
 * 徽标样式。**实色底 + 对比文字色**（`outlined` 只上文字与描边色）。
 *
 * 刻意不吃 antd `Tag color` 的自定义色分支：那条路径会把背景按 HSL 亮度 0.95 提亮、
 * 并把文字设成同一个颜色 —— 浅色（如金黄色）会因此变成「浅底浅字」而完全看不见。
 */
export function useRarityTagStyle(quality: number, outlined: boolean): CSSProperties {
  const { chip, chipText } = useRarityColor(quality);
  return useMemo(
    () => (outlined ? { color: chip, borderColor: chip } : { backgroundColor: chip, color: chipText, borderColor: chip }),
    [chip, chipText, outlined],
  );
}
