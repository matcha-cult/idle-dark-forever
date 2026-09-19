/**
 * 挑战队列的**唯一定义与规范化**（09 §5.3；RC4 服务端唯一所有者）
 *
 * 两个信任边界共用同一份校验：
 * - **DB 读**（`PlayerContextService.applyAccountData`）：存档漂移 → 丢弃坏条目而非清空整条队列；
 * - **客户端写**（`dungeon.queueSet/add`）：非法条目丢弃、长度截断、未知地图拒绝。
 *
 * 队列条目形状与 `WorldSnapshotDto.pendingMaps` 一致：`{ key, endlessLevel }`。
 */
import type { DataTables } from '@idle-dark/game-core';
import { MAX_CHALLENGE_QUEUE, type ChallengeEntry } from './player-dto.js';

export { MAX_CHALLENGE_QUEUE };
export type { ChallengeEntry };

/** 单个条目的规范化：未知地图 / 非法 key → `null`（丢弃）。 */
export function normalizeChallengeEntry(
  raw: unknown,
  tables: DataTables,
): ChallengeEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const key = (raw as { key?: unknown }).key;
  if (typeof key !== 'string' || key === '' || !tables.maps[key]) return null;
  const rawLevel = (raw as { endlessLevel?: unknown }).endlessLevel;
  const endlessLevel =
    typeof rawLevel === 'number' && Number.isFinite(rawLevel) ? Math.max(0, Math.trunc(rawLevel)) : 0;
  return { key, endlessLevel };
}

/**
 * 规范化整条队列：逐条校验 + 长度上限。
 *
 * `raw` 非数组 → 空队列（**不是** null：调用方要落库，空数组才是合法状态）。
 */
export function normalizeChallengeQueue(
  raw: unknown,
  tables: DataTables,
  maxLen: number = MAX_CHALLENGE_QUEUE,
): ChallengeEntry[] {
  if (!Array.isArray(raw)) return [];
  const cap = Number.isFinite(maxLen) && maxLen > 0 ? Math.trunc(maxLen) : MAX_CHALLENGE_QUEUE;
  const out: ChallengeEntry[] = [];
  for (const item of raw) {
    if (out.length >= cap) break;
    const entry = normalizeChallengeEntry(item, tables);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** 按下标移除一条（越界 / 非法下标 → 原样副本，不抛错）。 */
export function removeChallengeEntryAt(entries: readonly ChallengeEntry[], index: number): ChallengeEntry[] {
  const list = entries.map((e) => ({ key: e.key, endlessLevel: e.endlessLevel }));
  if (typeof index !== 'number' || !Number.isFinite(index)) return list;
  const i = Math.trunc(index);
  if (i < 0 || i >= list.length) return list;
  list.splice(i, 1);
  return list;
}
