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
import type { CareerPanelDto } from '@idle-dark/protocol';
import { BusinessErrorCode } from '@idle-dark/protocol';
import {
  careerProgressListDtoOf,
  enhanceListDtoOf,
  skillListDtoOf,
  slotLimitsOf,
} from '../../shared/index.js';
import { OpError } from '../../inventory/internal/op-error.js';

/** 面板汇总（`career.list`）：不含 `currentCareer` / `selectedSkills`（那些在 `PlayerStateDto`）。 */
export function careerPanelOf(tables: DataTables, player: Player): CareerPanelDto {
  return {
    careers: careerProgressListDtoOf(tables, player),
    skills: skillListDtoOf(tables, player),
    enhances: enhanceListDtoOf(tables, player),
    maxSkillCount: player.maxSkillCount,
    maxEnhanceCount: player.maxEnhanceCount,
  };
}

function requirementContext(player: Player, storiesMap: ReadonlyMap<string, string>): RequirementContext {
  return { player, map: null, storiesMap };
}

/** 切换职业（需通过职业解锁条件）。 */
export function opSwitchCareer(
  tables: DataTables,
  player: Player,
  career: string,
  storiesMap: ReadonlyMap<string, string>,
): void {
  const data = tables.careers[career];
  if (!data) throw new OpError(BusinessErrorCode.INVALID_PARAM, '职业不存在');
  if (!player.careers.has(career) && !checkRequirement(data.requirement, requirementContext(player, storiesMap))) {
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
