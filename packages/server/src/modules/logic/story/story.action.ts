/**
 * 故事 Action（cmd 段 story）—— 只做鉴权 / 参数校验 / 转发。
 *
 * `story.finish` 返回 `ActionResult<StoryDto>`（更新后的单条剧情态）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import { type ActionResult, STORY_CMD, type StoryDto, type StoryPlayDto } from '@idle-dark/protocol';
import { dataOf, requireUserId } from '../../../ionet/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { StoryLogicService } from './story.logic.service.js';
import { parseCharacterId, parseRequiredString } from '../shared/action-parse.js';

@Injectable()
@ActionController(STORY_CMD.cmd)
export class StoryAction {
  constructor(private readonly logic: StoryLogicService) {}

  @ActionMethod(STORY_CMD.list)
  async list(ctx: FlowContext, data: unknown): Promise<ActionResult<StoryDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const character = parseCharacterId(dataOf(data));
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.list(userId, character.value));
  }

  @ActionMethod(STORY_CMD.play)
  async play(ctx: FlowContext, data: unknown): Promise<ActionResult<StoryPlayDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const key = parseRequiredString(body, 'key');
    if (!key.ok) return key.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.play(userId, key.value, character.value));
  }

  @ActionMethod(STORY_CMD.finish)
  async finish(ctx: FlowContext, data: unknown): Promise<ActionResult<StoryDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const key = parseRequiredString(body, 'key');
    if (!key.ok) return key.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.finish(userId, key.value, character.value));
  }
}
