import { describe, expect, it } from 'vitest';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { OpError } from '../../../src/modules/logic/shared/op-error.js';
import {
  careerPanelOf,
  opSelectEnhance,
  opSelectSkill,
  opSwitchCareer,
  opUnselectEnhance,
  opUnselectSkill,
} from '../../../src/modules/logic/career/internal/career-ops.js';
import { makeFixture } from '../_helpers.js';

function codeOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof OpError) return error.code;
    throw error;
  }
  throw new Error('expected throw');
}

const EMPTY_STORIES = new Map<string, string>();

describe('career 面板与操作', () => {
  it('面板含三种进度，且不含 currentCareer / selectedSkills 顶层字段', () => {
    const fixture = makeFixture();
    const panel = careerPanelOf(fixture.tables, fixture.player);
    expect(panel.careers.length).toBeGreaterThan(0);
    expect(panel.skills.length).toBeGreaterThan(0);
    expect(panel.maxSkillCount).toBeGreaterThan(0);
    expect((panel as Record<string, unknown>)['currentCareer']).toBeUndefined();
    expect((panel as Record<string, unknown>)['selectedSkills']).toBeUndefined();
  });

  it('切换不存在的职业 → INVALID_PARAM；条件不满足 → CAREER_LOCKED', () => {
    const fixture = makeFixture('Eyer');
    expect(
      codeOf(() => opSwitchCareer(fixture.tables, fixture.player, 'nope', EMPTY_STORIES)),
    ).toBe(BusinessErrorCode.INVALID_PARAM);
    expect(
      codeOf(() => opSwitchCareer(fixture.tables, fixture.player, 'sorceress', EMPTY_STORIES)),
    ).toBe(BusinessErrorCode.CAREER_LOCKED);
  });

  it('切换满足条件的职业成功（Aleanor → sorceress）', () => {
    const fixture = makeFixture('Aleanor');
    opSwitchCareer(fixture.tables, fixture.player, 'sorceress', EMPTY_STORIES);
    expect(fixture.player.currentCareer).toBe('sorceress');
  });

  it('选择未知技能 → INVALID_PARAM；未解锁 → SKILL_LOCKED', () => {
    const fixture = makeFixture();
    expect(codeOf(() => opSelectSkill(fixture.player, 'nope'))).toBe(
      BusinessErrorCode.INVALID_PARAM,
    );
    expect(codeOf(() => opSelectSkill(fixture.player, 'thump'))).toBe(
      BusinessErrorCode.SKILL_LOCKED,
    );
  });

  it('技能栏已满 → SKILL_SLOT_FULL', () => {
    const fixture = makeFixture();
    fixture.player.level = 40; // maxSkillCount = 5
    expect(fixture.player.maxSkillCount).toBe(5);
    opSelectSkill(fixture.player, 'thump');
    opSelectSkill(fixture.player, 'meleeForRage');
    opSelectSkill(fixture.player, 'cleave');
    opSelectSkill(fixture.player, 'thumpHead');
    expect(fixture.player.careerInfo!.selectedSkills).toHaveLength(5);
    expect(codeOf(() => opSelectSkill(fixture.player, 'cleaveBlast'))).toBe(
      BusinessErrorCode.SKILL_SLOT_FULL,
    );
  });

  it('强化：未解锁 / 栏位已满', () => {
    const fixture = makeFixture();
    expect(codeOf(() => opSelectEnhance(fixture.player, 'weaponMastery'))).toBe(
      BusinessErrorCode.ENHANCE_LOCKED,
    );

    fixture.player.level = 60; // maxEnhanceCount = 4
    expect(fixture.player.maxEnhanceCount).toBe(4);
    opSelectEnhance(fixture.player, 'weaponMastery');
    opSelectEnhance(fixture.player, 'rageForHp');
    opSelectEnhance(fixture.player, 'ragingAttack');
    opSelectEnhance(fixture.player, 'ironBody');
    expect(codeOf(() => opSelectEnhance(fixture.player, 'rageFromHeart'))).toBe(
      BusinessErrorCode.ENHANCE_SLOT_FULL,
    );
  });

  it('卸下不存在的技能 / 强化是幂等的', () => {
    const fixture = makeFixture();
    opUnselectSkill(fixture.player, 'thump');
    opUnselectEnhance(fixture.player, 'weaponMastery');
    expect(fixture.player.careerInfo!.selectedSkills).not.toContain('thump');
  });

  it('重复选择已选技能不报错且不重复入列', () => {
    const fixture = makeFixture();
    opSelectSkill(fixture.player, 'melee');
    expect(fixture.player.careerInfo!.selectedSkills.filter((key) => key === 'melee')).toHaveLength(1);
  });
});
