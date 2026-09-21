/**
 * **怪物**稀有度（4 档）展示契约 —— 普通 / 稀有 / 精英 / 传奇。
 *
 * ## 为什么必须有这一份、而不能继续用 `quality`
 *
 * `UnitStateDto.quality` 是**敌人词缀条数**（可 > 2），**不是稀有度**；把它当品质渲染是
 * 「同名不同义」陷阱。上线时 `UnitCard` 正是这么做的（`<RarityTag quality={unit.quality} />`），
 * 于是「两条词缀的精英怪」被画成**传奇**，与真正的守关 BOSS 撞色 —— 同一只怪身上同时出现
 * 「传奇」和「精英」两个标签（用户截图报的就是这个）。
 *
 * 现在改由协议 `UnitStateDto.rarity`（服务端派生）驱动：
 *
 * | 档位 | 来源 | 徽标底色 |
 * |---|---|---|
 * | 普通 | `quality 0` | **不渲染**（与 `RarityTag` 的普通档一致） |
 * | 稀有 | `quality 1` | 设计色（同装备稀有） |
 * | 精英 | `quality 2`（每 10 波保底） | `token.purple` |
 * | 传奇 | 守关 BOSS | 设计色（同装备传奇） |
 *
 * ## 为什么文案在本地再写一份
 *
 * `@idle-dark/protocol` 的 `UNIT_RARITY_NAMES` 是**值**导出，本包红线是「运行时只依赖
 * antd + react」，只能 `import type`。因此这里复制 4 档文案，并由 `unit-rarity.test.ts`
 * 直接读 protocol 源码做**一致性断言**（与 `quality.ts` 同一套做法，漂移会在 `pnpm test` 挂）。
 *
 * **颜色不在这里**：设计色由应用层经 `RarityPaletteProvider` 注入；精英档用 antd token
 * （`token.purple`），因为本包源码**零内联 hex**（`hygiene.test.ts`）。
 */
import type { RarityColor } from './rarity-palette.js';

/** 4 档稀有度文案（与 protocol `UNIT_RARITY_NAMES` 一致，由门禁测试断言）。 */
export const UNIT_RARITY_LABELS: readonly string[] = ['普通', '稀有', '精英', '传奇'];

/** 最高档位（0 起算，传奇 = 3）。 */
export const MAX_UNIT_RARITY = 3;

/** 最低档位（普通）—— 默认**不渲染**徽标。 */
export const COMMON_UNIT_RARITY = 0;

/**
 * 把任意入参夹取到合法档位 `0..3`（不抛错）：
 * `NaN` / `undefined` / `null` → 0（未知按最低档），`+Infinity` → 3，`-Infinity` / 负数 → 0，
 * 小数 `Math.trunc`。
 */
export function clampUnitRarity(value: number | null | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return numeric > 0 ? MAX_UNIT_RARITY : 0;
  const truncated = Math.trunc(numeric);
  if (truncated <= 0) return 0;
  if (truncated >= MAX_UNIT_RARITY) return MAX_UNIT_RARITY;
  return truncated;
}

/** 档位文案；`labels` 覆盖时该位缺失（长度不足）回退内置文案。 */
export function unitRarityLabel(rarity: number, labels?: readonly string[]): string {
  const index = clampUnitRarity(rarity);
  const custom = labels?.[index];
  if (custom !== undefined) return custom;
  return UNIT_RARITY_LABELS[index] ?? UNIT_RARITY_LABELS[0] ?? '';
}

/** 展示态：文案 + 徽标底色 + 徽标上的文字色 + 归一后的档位。 */
export interface UnitRarityTone {
  rarity: number;
  label: string;
  chip: string;
  chipText: string;
}

/**
 * 派生某只怪物的展示态；**普通档返回 `null`**（不贴徽标，保持单位卡干净）。
 *
 * @param palette 应用层注入的稀有度设计色（`useRarityColor(1)` / `useRarityColor(2)`）。
 * @param tokens  精英档底色与徽标文字色（`token.purple` / `token.colorWhite`）。
 */
export function unitRarityToneOf(
  rarity: number | null | undefined,
  palette: { rare: RarityColor; legend: RarityColor },
  tokens: { elite: string; chipText: string },
  labels?: readonly string[],
): UnitRarityTone | null {
  const index = clampUnitRarity(rarity);
  if (index === COMMON_UNIT_RARITY) return null;
  if (index === 1) {
    return {
      rarity: index,
      label: unitRarityLabel(index, labels),
      chip: palette.rare.chip,
      chipText: palette.rare.chipText,
    };
  }
  if (index === 2) {
    return {
      rarity: index,
      label: unitRarityLabel(index, labels),
      chip: tokens.elite,
      chipText: tokens.chipText,
    };
  }
  return {
    rarity: index,
    label: unitRarityLabel(index, labels),
    chip: palette.legend.chip,
    chipText: palette.legend.chipText,
  };
}
