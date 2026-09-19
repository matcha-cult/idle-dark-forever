/**
 * CostList —— 费用展示（金币 / 神力 / 材料），不足标红。
 *
 * 受控纯展示：费用来自 `CostDto`（**type-only** import），持有量由 `owned` 注入。
 * 语义：只有**提供了**对应持有量时才做「不足」判定（`owned.gold === undefined`
 * 表示调用方不掌握该信息，此时一律按充足渲染，避免误报红色）。
 *
 * 颜色纪律：不足用 `token.colorError`，充足用 `token.colorTextSecondary`，
 * 金币/神力图标色取 `token.gold` / `token.purple`，零内联 hex。
 */
import { Flex, Typography, theme } from 'antd';
import type { CostDto } from '@idle-dark/protocol';
import { formatAmount } from '../format/number.js';

export interface CostListProps {
  costs: CostDto;
  /** 玩家持有量；缺省不判定不足。 */
  owned?: {
    gold?: number;
    diamonds?: number;
    materials?: Readonly<Record<string, number>>;
  };
  /** 材料 key → 展示名。 */
  materialNames?: Readonly<Record<string, string>>;
  /** 纵向排列（缺省横向自动换行）。 */
  vertical?: boolean;
  /** 无费用时的文案，缺省「免费」。 */
  freeText?: string;
}

interface CostEntry {
  key: string;
  label: string;
  need: number;
  have: number | undefined;
  tone: string;
}

export function CostList(props: CostListProps) {
  const { costs, owned, materialNames, vertical = false, freeText = '免费' } = props;
  const { token } = theme.useToken();

  const entries: CostEntry[] = [];
  if (costs.gold !== undefined && costs.gold > 0) {
    entries.push({ key: 'gold', label: '金币', need: costs.gold, have: owned?.gold, tone: token.gold });
  }
  if (costs.diamonds !== undefined && costs.diamonds > 0) {
    entries.push({ key: 'diamonds', label: '神力', need: costs.diamonds, have: owned?.diamonds, tone: token.purple });
  }
  for (const material of costs.materials ?? []) {
    entries.push({
      key: `m:${material.key}`,
      label: materialNames?.[material.key] ?? material.key,
      need: material.count,
      // `owned.materials` 一旦提供即视为权威清单：缺 key = 真的没有（0），而不是「未知」
      have: owned?.materials === undefined ? undefined : (owned.materials[material.key] ?? 0),
      tone: token.cyan,
    });
  }

  if (entries.length === 0) {
    return (
      <Typography.Text style={{ color: token.colorTextTertiary }} data-testid="cost-list-free">
        {freeText}
      </Typography.Text>
    );
  }

  return (
    <Flex
      vertical={vertical}
      align={vertical ? 'flex-start' : 'center'}
      wrap={!vertical}
      gap={token.marginXS}
      data-testid="cost-list"
    >
      {entries.map((entry) => {
        const insufficient = entry.have !== undefined && entry.have < entry.need;
        return (
          <Typography.Text
            key={entry.key}
            data-testid={`cost-${entry.key}`}
            data-insufficient={insufficient || undefined}
            style={{ color: insufficient ? token.colorError : entry.tone, whiteSpace: 'nowrap' }}
          >
            {`${entry.label} ${formatAmount(entry.need)}${
              entry.have === undefined ? '' : `/${formatAmount(entry.have)}`
            }`}
          </Typography.Text>
        );
      })}
    </Flex>
  );
}
