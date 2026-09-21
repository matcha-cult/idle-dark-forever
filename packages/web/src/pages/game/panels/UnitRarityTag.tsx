/**
 * 怪物稀有度徽标（W11）。
 *
 * 只渲染**非普通**档位（普通不贴标，与装备 `RarityTag` 一致）；档位文案来自协议
 * `UNIT_RARITY_NAMES`，档位值来自服务端 `UnitStateDto.rarity`（**前端零推导** —— 不要在这里
 * 用 `boss` / `elite` / `quality` 自己拼档位，`quality` 是敌人词缀条数、随手拼就会错）。
 *
 * ⚠️ 刻意**不用** antd `Tag color={hex}`：那条分支会把背景按 HSL 亮度 0.95 提亮、文字设成同色，
 * 浅色（如 `#ffff77`）会变成「浅底浅字」完全看不见（`AGENTS.md` §18 有留档）。
 * 这里显式给 `backgroundColor` / `color`。
 */
import { theme } from 'antd';
import { useRarityColor } from '@idle-dark/ui-kit';

import { unitRarityToneOf } from '../../../theme/unit-rarity.js';

export interface UnitRarityTagProps {
  /** 服务端派生的档位（0 普通 / 1 稀有 / 2 精英 / 3 传奇）。 */
  rarity: number | undefined;
}

export function UnitRarityTag({ rarity }: UnitRarityTagProps) {
  const { token } = theme.useToken();
  // 借用装备稀有度色板拿「稀有 / 传奇」的设计色（徽标底不随主题变）。
  const rareTone = useRarityColor(1);
  const legendTone = useRarityColor(2);
  const tone = unitRarityToneOf(
    rarity,
    { purple: token.purple, colorWhite: token.colorWhite },
    rareTone,
    legendTone,
  );
  if (tone === null) {
    return null;
  }
  return (
    <span
      data-testid="unit-rarity"
      data-rarity={rarity}
      style={{
        backgroundColor: tone.chip,
        color: tone.chipText,
        border: `1px solid ${tone.chip}`,
        borderRadius: token.borderRadiusSM,
        paddingInline: token.paddingXXS,
        fontSize: token.fontSizeSM,
        lineHeight: token.lineHeightSM,
        whiteSpace: 'nowrap',
      }}
    >
      {tone.label}
    </span>
  );
}
