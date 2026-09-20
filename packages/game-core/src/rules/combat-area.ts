/**
 * 战斗区域判定（09 §6.1）——**唯一定义**，map / idle 共用
 *
 * ```
 * isCombatArea(map) = map != null && (map.monsters?.length ?? 0) > 0
 * ```
 *
 * 语义：只有"会发生实际战斗"的地图才值得做离线结算 —— 安全区（如无怪的 `home`）离线
 * 不产生任何收益（RD1）。
 *
 * 边界（一律 `false`，绝不放行）：`undefined` / `null`、`monsters` 缺失或非数组、
 * 未知 mapKey（调用方查表失败即为 `undefined`）。
 *
 * ⚠️ 禁止在消费侧复制本判定（对齐 `AGENTS.md` §11 的"只允许一处定义"纪律）。
 */
import type { MapData } from '../contracts/data.js';

/** 只依赖判定所需的一列，便于用窄对象单测。 */
export type CombatAreaMap = Pick<MapData, 'monsters'>;

export function isCombatArea(map: CombatAreaMap | null | undefined): boolean {
  if (map === null || map === undefined) return false;
  const monsters = map.monsters;
  return Array.isArray(monsters) && monsters.length > 0;
}
