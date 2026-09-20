/**
 * `Unit` → `UnitStateDto` 投影（服务端权威）
 *
 * 前端 `world.tick` 只做整体替换，不做任何推导，因此这里把资源 / 目标 / 读条 / Buff
 * 全部算好。
 */
import type { UnitStateDto } from '@idle-dark/protocol';
import { EnemyUnit, PlayerUnit, Unit } from '@idle-dark/game-core';

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * `EnemyUnit.quality`（敌人**词缀条数**）→ DTO。
 *
 * ⚠️ 这不是装备品质：装备品质已是 `Quality = 0|1|2`，而敌人词缀条数可 >2。
 * 因此 `UnitStateDto.quality` 的类型是 `number`（12 号任务书 §3.6 第 8 条）。
 */
function qualityOf(value: number): number {
  const n = finite(value);
  if (n < 0) return 0;
  if (n > 6) return 6;
  return n;
}

/** 单位类型标识。 */
export function unitKindOf(unit: Unit, playerUnit: PlayerUnit | null): string {
  if (playerUnit !== null && unit === playerUnit) return 'player';
  if (unit.summoner != null) return 'summon';
  return 'enemy';
}

function typeKeyOf(unit: Unit, playerUnit: PlayerUnit | null): string {
  if (playerUnit !== null && unit === playerUnit) {
    const player = playerUnit.player as unknown as { key?: unknown } | null;
    const key = player?.key;
    return key === undefined || key === null ? '' : String(key);
  }
  if (unit instanceof EnemyUnit) return unit.type;
  return '';
}

function castingProgressOf(unit: Unit): number | null {
  if (!unit.casting) return null;
  const total = finite(unit.castingTime);
  if (total <= 0) return 1;
  const rest = finite(unit.castingRest, total);
  const ratio = 1 - rest / total;
  if (!Number.isFinite(ratio)) return null;
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

export function unitStateDtoOf(unit: Unit, playerUnit: PlayerUnit | null): UnitStateDto {
  const buffs: UnitStateDto['buffs'] = [];
  for (const buff of unit.buffs) {
    const data = buff.buffData;
    if (!data || data.hidden) continue;
    const expireAt = buff.expireAt;
    const remainMs = expireAt === null ? 0 : Math.max(0, expireAt - buff.clock.getTime());
    buffs.push({ key: buff.type, name: data.name, stack: finite(buff.stack, 1), remainMs });
  }

  const quality = unit instanceof EnemyUnit ? unit.quality : 0;
  return {
    id: unit.id,
    kind: unitKindOf(unit, playerUnit),
    typeKey: typeKeyOf(unit, playerUnit),
    name: unit.displayName,
    camp: String(unit.camp),
    level: finite(unit.level),
    quality: qualityOf(quality),
    hp: finite(unit.hp),
    maxHp: finite(unit.maxHp),
    mp: finite(unit.mp),
    maxMp: finite(unit.maxMp),
    rp: finite(unit.rp),
    maxRp: finite(unit.maxRp),
    ep: finite(unit.ep),
    maxEp: finite(unit.maxEp),
    comboPoint: finite(unit.comboPoint),
    targetId: unit.target ? unit.target.id : null,
    castingProgress: castingProgressOf(unit),
    buffs,
  };
}
