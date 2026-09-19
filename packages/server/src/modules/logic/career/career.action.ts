/**
 * 职业 / 技能 / 强化 Action（cmd 段 career）—— 只做鉴权 / 参数校验 / 转发。
 *
 * `career.list` 返回 `CareerPanelDto`（不含 `currentCareer` / `selectedSkills`，见任务书附录 A）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import { type ActionResult, CAREER_CMD, type CareerPanelDto } from '@idle-dark/protocol';
import { dataOf, requireUserId } from '../../../ionet/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { CareerLogicService } from './career.logic.service.js';
import { parseCharacterId, parseRequiredString } from '../inventory/internal/action-parse.js';

@Injectable()
@ActionController(CAREER_CMD.cmd)
export class CareerAction {
  constructor(private readonly logic: CareerLogicService) {}

  @ActionMethod(CAREER_CMD.list)
  async list(ctx: FlowContext, data: unknown): Promise<ActionResult<CareerPanelDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const character = parseCharacterId(dataOf(data));
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.list(userId, character.value));
  }

  @ActionMethod(CAREER_CMD.switchCareer)
  async switchCareer(ctx: FlowContext, data: unknown): Promise<ActionResult<CareerPanelDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const career = parseRequiredString(body, 'career');
    if (!career.ok) return career.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.switchCareer(userId, career.value, character.value));
  }

  @ActionMethod(CAREER_CMD.selectSkill)
  async selectSkill(ctx: FlowContext, data: unknown): Promise<ActionResult<CareerPanelDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const skill = parseRequiredString(body, 'skill');
    if (!skill.ok) return skill.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.selectSkill(userId, skill.value, character.value));
  }

  @ActionMethod(CAREER_CMD.unselectSkill)
  async unselectSkill(ctx: FlowContext, data: unknown): Promise<ActionResult<CareerPanelDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const skill = parseRequiredString(body, 'skill');
    if (!skill.ok) return skill.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.unselectSkill(userId, skill.value, character.value));
  }

  @ActionMethod(CAREER_CMD.selectEnhance)
  async selectEnhance(ctx: FlowContext, data: unknown): Promise<ActionResult<CareerPanelDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const enhance = parseRequiredString(body, 'enhance');
    if (!enhance.ok) return enhance.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.selectEnhance(userId, enhance.value, character.value));
  }

  @ActionMethod(CAREER_CMD.unselectEnhance)
  async unselectEnhance(ctx: FlowContext, data: unknown): Promise<ActionResult<CareerPanelDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const enhance = parseRequiredString(body, 'enhance');
    if (!enhance.ok) return enhance.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.unselectEnhance(userId, enhance.value, character.value));
  }
}
