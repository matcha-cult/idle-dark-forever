/**
 * **怪物**稀有度四阶的展示色（应用层，W11）。
 *
 * 为什么单独一份、不复用装备的 `RarityTag`：这是**两条不同的轴** ——
 * 装备品质只有 3 档（普通 / 稀有 / 传奇），而怪物是 4 档
 * （`普通 / 稀有 / 精英 / 传奇`，见协议 `UNIT_RARITY_NAMES`）。把两条轴混用会出现
 * 「精英被画成传奇」这种错位。
 *
 * 取色口径（与装备稀有度一致的部分直接复用**设计色**，其余用主题 token）：
 *
 * | 档位 | 徽标底色 | 来源 |
 * |---|---|---|
 * | 普通 | —— | **不显示徽标**（与装备 `RarityTag` 的「普通不贴标」一致） |
 * | 稀有 | `#ffff77` | 设计色（装备稀有同色） |
 * | 精英 | `token.purple` | 主题 token（不新挑 hex；紫色与稀有的黄、传奇的橙都不撞） |
 * | 传奇 | `#ef6916` | 设计色（装备传奇同色） |
 *
 * ⚠️ 颜色只在**应用层**（ui-kit 有「源码零内联 hex」硬门禁）；
 * ⚠️ 徽标底**不随主题变**（设计色就是设计色），只有名称文字随主题变 —— 这条沿用
 * `rarity-palette.ts` 的结论，所以这里直接复用它的 `chip` / `chipText`。
 */
import { UNIT_RARITY_NAMES } from '@idle-dark/protocol';
import type { RarityColor } from '@idle-dark/ui-kit';

/** 一个档位的展示态。 */
export interface UnitRarityTone {
  label: string;
  chip: string;
  chipText: string;
}

/** 取色所需的最小 token 视图（避免把整个 antd `GlobalToken` 拖进纯函数签名）。 */
export interface UnitRarityTokens {
  /** 精英档底色（antd 预设色 `purple`）。 */
  purple: string;
  /** 压在深色底上的文字色。 */
  colorWhite: string;
}

/**
 * 派生某只怪物的展示态；**普通档返回 `null`**（不贴徽标，保持面板干净）。
 *
 * 入参 `rarity` 直接来自服务端（`UnitStateDto.rarity`，前端零推导）：
 * 越界 / 缺失 / 非数字一律按「普通」处理（`null`）。
 */
export function unitRarityToneOf(
  rarity: number | null | undefined,
  tokens: UnitRarityTokens,
  rareTone: Pick<RarityColor, 'chip' | 'chipText'>,
  legendTone: Pick<RarityColor, 'chip' | 'chipText'>,
): UnitRarityTone | null {
  switch (rarity) {
    case 1:
      return { label: UNIT_RARITY_NAMES[1] ?? '稀有', chip: rareTone.chip, chipText: rareTone.chipText };
    case 2:
      return { label: UNIT_RARITY_NAMES[2] ?? '精英', chip: tokens.purple, chipText: tokens.colorWhite };
    case 3:
      return {
        label: UNIT_RARITY_NAMES[3] ?? '传奇',
        chip: legendTone.chip,
        chipText: legendTone.chipText,
      };
    default:
      return null;
  }
}
