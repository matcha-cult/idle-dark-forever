/**
 * 职业域纯逻辑（不依赖 Nest / IO）。
 *
 * 对应原版 `world.selectSkill` / `unselectSkill` / `selectEnhance` / `unselectEnhance`
 * 与 `Player.selectCareer`。所有改动就地完成，调用方负责落库。
 */
import {
  checkRequirement,
  type DataTables,
  type Player,
  type RequirementContext,
} from '@idle-dark/game-core';
import type { CareerPanelDto, SkillDto } from '@idle-dark/protocol';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { careerProgressListDtoOf, enhanceListDtoOf } from '../../shared/index.js';
import { OpError } from '../../shared/op-error.js';

/**
 * 技能展示态列表（本地实现）。
 *
 * ⚠️ 为什么不直接用 `shared/player-dto.ts#skillListDtoOf`：该函数调用
 * `skill.coolDown(0)`，但数据表里 89 处 `coolDown` 形如
 * `(level, unit) => unit.runAttrHooks(8000, 'xxxCoolDown')`，缺第二个参数会抛
 * `Cannot read properties of undefined`，使 `career.list` 整体 500。
 * 这里用最小 `unit` 替身并 try/catch 兜底（`coolDown` 仅用于展示）。
 * 已作为共享件缺陷写入交付报告。
 */
export function skillListOf(tables: DataTables, player: Player): SkillDto[] {
  const careerData = player.careerData;
  const info = player.careerInfo;
  const out: SkillDto[] = [];
  if (!careerData) return out;
  const selected = new Set(info?.selectedSkills ?? []);
  const unitStub = { runAttrHooks: (_value: number) => _value };
  for (const key of Object.keys(careerData.skills)) {
    const skill = tables.skills[key];
    if (!skill) continue;
    const unlockLevel = careerData.skills[key] ?? 0;
    const description = typeof skill.description === 'string' ? skill.description : '';
    let coolDown = 0;
    try {
      coolDown =
        typeof skill.coolDown === 'function'
          ? Number((skill.coolDown as unknown as (level: number, unit: unknown) => number)(0, unitStub))
          : skill.coolDown;
    } catch {
      coolDown = 0;
    }
    out.push({
      key,
      name: skill.name,
      group: skill.group,
      description,
      level: player.getSkillLevel(key),
      unlockLevel,
      unlocked: (info?.level ?? 0) >= unlockLevel,
      selected: selected.has(key),
      isAttack: !!skill.isAttack,
      coolDown: Number.isFinite(coolDown) ? coolDown : 0,
      usable: false,
    });
  }
  return out;
}

/** 面板汇总（`career.list`）：不含 `currentCareer` / `selectedSkills`（那些在 `PlayerStateDto`）。 */
export function careerPanelOf(tables: DataTables, player: Player): CareerPanelDto {
  return {
    careers: careerProgressListDtoOf(tables, player),
    skills: skillListOf(tables, player),
    enhances: enhanceListDtoOf(tables, player),
    maxSkillCount: player.maxSkillCount,
    maxEnhanceCount: player.maxEnhanceCount,
  };
}

function requirementContext(player: Player): RequirementContext {
  return { player, map: null };
}

/** 切换职业（需通过职业解锁条件）。 */
export function opSwitchCareer(
  tables: DataTables,
  player: Player,
  career: string,
): void {
  const data = tables.careers[career];
  if (!data) throw new OpError(BusinessErrorCode.INVALID_PARAM, '职业不存在');
  if (!player.careers.has(career) && !checkRequirement(data.requirement, requirementContext(player))) {
    throw new OpError(BusinessErrorCode.CAREER_LOCKED);
  }
  player.selectCareer(career);
}

/** 装备主动技能。 */
export function opSelectSkill(player: Player, skill: string): void {
  const career = player.careerData;
  const info = player.careerInfo;
  if (!career || !info) throw new OpError(BusinessErrorCode.INVALID_PARAM, '当前没有职业');
  const unlockLevel = career.skills[skill];
  if (unlockLevel === undefined) throw new OpError(BusinessErrorCode.INVALID_PARAM, '该技能不属于当前职业');
  if (info.level < unlockLevel) throw new OpError(BusinessErrorCode.SKILL_LOCKED);
  if (info.selectedSkills.includes(skill)) return;
  if (info.selectedSkills.length >= player.maxSkillCount) {
    throw new OpError(BusinessErrorCode.SKILL_SLOT_FULL);
  }
  info.selectedSkills.unshift(skill);
}

/** 卸下主动技能（不存在时幂等成功）。 */
export function opUnselectSkill(player: Player, skill: string): void {
  const info = player.careerInfo;
  if (!info) throw new OpError(BusinessErrorCode.INVALID_PARAM, '当前没有职业');
  info.selectedSkills = info.selectedSkills.filter((key) => key !== skill);
}

/** 装备强化（被动）。 */
export function opSelectEnhance(player: Player, enhance: string): void {
  const career = player.careerData;
  const info = player.careerInfo;
  if (!career || !info) throw new OpError(BusinessErrorCode.INVALID_PARAM, '当前没有职业');
  const unlockLevel = career.enhances[enhance];
  if (unlockLevel === undefined) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '该强化不属于当前职业');
  }
  if (info.level < unlockLevel) throw new OpError(BusinessErrorCode.ENHANCE_LOCKED);
  if (info.selectedEnhances.includes(enhance)) return;
  if (info.selectedEnhances.length >= player.maxEnhanceCount) {
    throw new OpError(BusinessErrorCode.ENHANCE_SLOT_FULL);
  }
  info.selectedEnhances.unshift(enhance);
}

/** 卸下强化（不存在时幂等成功）。 */
export function opUnselectEnhance(player: Player, enhance: string): void {
  const info = player.careerInfo;
  if (!info) throw new OpError(BusinessErrorCode.INVALID_PARAM, '当前没有职业');
  info.selectedEnhances = info.selectedEnhances.filter((key) => key !== enhance);
}
