/**
 * `Unit` → `UnitStateDto` 投影（服务端权威）
 *
 * 前端 `world.tick` 只做整体替换，不做任何推导，因此这里把资源 / 目标 / 读条 / Buff
 * 全部算好。
 */
import type { UnitStateDto } from '@idle-dark/protocol';
import { Camps, EnemyUnit, PlayerUnit, Unit } from '@idle-dark/game-core';
import { playerAttributesOf } from './player-attributes.js';

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
  const dto: UnitStateDto = {
    id: unit.id,
    kind: unitKindOf(unit, playerUnit),
    typeKey: typeKeyOf(unit, playerUnit),
    name: unit.displayName,
    camp: String(unit.camp),
    level: finite(unit.level),
    quality: qualityOf(quality),
    // P2：`hp` 夹到 `>= 0`（`Unit.damage` 只做 `hp -= v`，阵亡瞬间可能为负），
    // 并由服务端显式下发 `alive` —— 前端零推导，不再靠 `hp <= 0` 猜死亡。
    hp: Math.max(0, finite(unit.hp)),
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
    // ⚠️ 与 `MUTABLE_UNIT_FIELDS` 必须一致：`alive` 是 `camp === 'ghost'` 的派生量，
    // 二者**同时**变化；差分靠 `camp` 就能捕捉死亡，`alive` 只是给前端的显式语义。
    alive: unit.camp !== Camps.ghost,
  };
  // W4：守关 BOSS 显式标记（**不要用 key 比较**：同一敌人既可能是某图 BOSS 又是另一图普通怪）。
  if (unit instanceof EnemyUnit && unit.worldBoss) dto.boss = true;
  // 属性面板 + 经验只属于**玩家单位**（原版 `PlayerPanel` 是每张玩家卡的属性表）。
  // 用 `instanceof` 而不是 `unit === playerUnit`：即使调用方没传 playerUnit（离线结算等），
  // 玩家单位也照样带上属性；反之敌方单位无论如何都拿不到这两个字段。
  if (unit instanceof PlayerUnit) {
    dto.attributes = playerAttributesOf(unit);
    dto.exp = finite(unit.exp);
    dto.maxExp = finite(unit.maxExp);
  }
  return dto;
}
