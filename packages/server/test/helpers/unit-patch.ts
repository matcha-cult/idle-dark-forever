/**
 * 测试用：把一串 `(world, tick)` 帧的 `patch` 折叠成「当前单位表」。
 *
 * **刻意不复用前端实现**：这里独立实现一遍协议语义，用来交叉验证服务端发出来的
 * 补丁流真的能被「按序应用」还原成正确状态（前端 `applyPatch` 如果写错，这里不会跟着错）。
 */
import type { UnitPatchOpDto, UnitStateDto, WorldTickDto } from '@idle-dark/protocol';

/** 按序应用补丁（原地修改 `map`）。未知 id 的 `chg` 记录到 `desynced`。 */
export function applyPatchOps(
  map: Map<string, UnitStateDto>,
  patch: readonly UnitPatchOpDto[],
  desynced?: { count: number },
): void {
  for (const op of patch) {
    if (op.op === 'reset') {
      map.clear();
      for (const unit of op.units ?? []) map.set(unit.id, unit);
    } else if (op.op === 'add') {
      if (op.unit !== undefined && typeof op.unit.id === 'string') map.set(op.unit.id, op.unit);
    } else if (op.op === 'del') {
      map.delete(op.id);
    } else {
      const existing = map.get(op.id);
      if (existing === undefined) {
        if (desynced !== undefined) desynced.count += 1;
        continue;
      }
      map.set(op.id, { ...existing, ...op.fields });
    }
  }
}

/** 把一串 tick 帧折叠成最终单位表。 */
export function foldPatches(ticks: readonly WorldTickDto[]): Map<string, UnitStateDto> {
  const map = new Map<string, UnitStateDto>();
  for (const tick of ticks) applyPatchOps(map, tick.patch ?? []);
  return map;
}

/** 所有帧里出现过的单位 id（含中途被 `del` 掉的）。 */
export function seenUnitIds(ticks: readonly WorldTickDto[]): Set<string> {
  const ids = new Set<string>();
  for (const tick of ticks) {
    for (const op of tick.patch ?? []) {
      if (op.op === 'reset') for (const unit of op.units ?? []) ids.add(unit.id);
      else if (op.op === 'add') ids.add(op.unit.id);
      else ids.add(op.id);
    }
  }
  return ids;
}
