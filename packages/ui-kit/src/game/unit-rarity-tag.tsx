/**
 * 怪物稀有度徽标（4 档）—— 普通 / 稀有 / 精英 / 传奇。
 *
 * 只渲染**非普通**档位（普通不贴标，与 `RarityTag` 一致）。档位值来自服务端
 * `UnitStateDto.rarity`（**前端零推导**）：**不要**在这里用 `boss` / `elite` / `quality`
 * 自己拼档位 —— `quality` 是敌人词缀条数、可 > 2，随手拼就会错（这正是本组件存在的理由）。
 *
 * ⚠️ 刻意**不用** antd `Tag color={hex}`：那条分支会把背景按 HSL 亮度 0.95 提亮、文字设成同色，
 * 浅色（如金黄色）会变成「浅底浅字」完全看不见（`AGENTS.md` §18 有留档）。
 * 这里显式给 `backgroundColor` / `color`。
 */
import { theme } from 'antd';
import { useRarityColor } from './rarity-palette.js';
import { unitRarityToneOf } from './unit-rarity.js';

export interface UnitRarityTagProps {
  /** 服务端派生的档位（0 普通 / 1 稀有 / 2 精英 / 3 传奇）。 */
  rarity: number | undefined;
  /** 覆盖档位文案（缺省用内置 4 档，应用层一般不必传）。 */
  labels?: readonly string[];
}

export function UnitRarityTag({ rarity, labels }: UnitRarityTagProps) {
  const { token } = theme.useToken();
  // 应用层注入的设计色：稀有（index 1）/ 传奇（index 2，装备口径的最高档）。
  const rare = useRarityColor(1);
  const legend = useRarityColor(2);
  const tone = unitRarityToneOf(
    rarity,
    { rare, legend },
    { elite: token.purple, chipText: token.colorWhite },
    labels,
  );
  if (tone === null) {
    return null;
  }
  return (
    <span
      data-testid="unit-rarity"
      data-rarity={tone.rarity}
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
