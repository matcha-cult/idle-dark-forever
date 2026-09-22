/**
 * 钱包分组（**纯函数**，无 React / 无 store）—— `WalletPanel` 的展示分组规则。
 *
 * 为什么单独一个文件：`hygiene` 之外，仓库既有先例是把行表/分组拆出面板
 * （见 ui-kit `player-attributes-groups.ts`），便于**不渲染**地跑边界单测。
 *
 * 纪律：分组只按服务端下发的 `key` **命名空间**做展示分流，**不读数值、不做推导**；
 * 数量为 0 的条目服务端已在 `walletDtoOf` 过滤，这里不再过滤（渲染层不改变语义）。
 */
import type { WalletEntryDto } from '@idle-dark/protocol';

export type WalletGroupKey = 'currency' | 'essence' | 'other';

/** 展示顺序（通货 → 精华 → 其他）。 */
export const WALLET_GROUP_ORDER: readonly WalletGroupKey[] = ['currency', 'essence', 'other'];

/** 分组标题。 */
export const WALLET_GROUP_LABELS: Readonly<Record<WalletGroupKey, string>> = {
  currency: '通货',
  essence: '精华',
  other: '其他',
};

/**
 * 由 key 判定分组。
 *
 * 边界：非字符串（`undefined` / `null` / 数字）/ 不含 `.` 的前缀字符串 / 空串 / 未知命名空间
 * 一律落 `other`，绝不抛错。
 */
export function walletGroupOf(key: unknown): WalletGroupKey {
  if (typeof key !== 'string') return 'other';
  if (key.startsWith('currency.')) return 'currency';
  if (key.startsWith('essence.')) return 'essence';
  return 'other';
}

/**
 * 把钱包条目按分组归类，**保持服务端下发的顺序**（不重排）。
 *
 * 边界：`undefined` / `null` / 非数组 → 三个空分组；数组里的 `null` / 非对象条目跳过。
 */
export function groupWalletEntries(
  entries: readonly WalletEntryDto[] | null | undefined,
): Record<WalletGroupKey, WalletEntryDto[]> {
  const groups: Record<WalletGroupKey, WalletEntryDto[]> = { currency: [], essence: [], other: [] };
  if (!Array.isArray(entries)) return groups;
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue;
    groups[walletGroupOf(entry.key)].push(entry);
  }
  return groups;
}
