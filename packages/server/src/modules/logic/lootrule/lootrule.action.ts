/**
 * 拾取规则 Action（cmd 段 lootrule）—— 只做鉴权 / 参数校验 / 转发。
 *
 * 前端域名是 `api.lootrule`（单数小写，见任务书附录 A）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import {
  type ActionResult,
  type LootRuleEntryDto,
  type LootRuleStateDto,
  type LootRuleUpdateInput,
  LOOTRULE_CMD,
} from '@idle-dark/protocol';
import { ActionError, dataOf, requireUserId, toBoolean, toFiniteInt } from '../../../ionet/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { LootRuleLogicService } from './lootrule.logic.service.js';
import { parseCharacterId } from '../inventory/internal/action-parse.js';

@Injectable()
@ActionController(LOOTRULE_CMD.cmd)
export class LootRuleAction {
  constructor(private readonly logic: LootRuleLogicService) {}

  @ActionMethod(LOOTRULE_CMD.get)
  async get(ctx: FlowContext, data: unknown): Promise<ActionResult<LootRuleStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const character = parseCharacterId(dataOf(data));
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.get(userId, character.value));
  }

  @ActionMethod(LOOTRULE_CMD.update)
  async update(ctx: FlowContext, data: unknown): Promise<ActionResult<LootRuleStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);

    const input: LootRuleUpdateInput = {};
    if (body['enabled'] !== undefined) {
      const enabled = toBoolean(body['enabled']);
      if (enabled === undefined) return ActionError.invalidParam('enabled 必须是布尔值');
      input.enabled = enabled;
    }
    if (body['rules'] !== undefined) {
      const rules = parseRules(body['rules']);
      if (!rules.ok) return rules.fail;
      input.rules = rules.value;
    }
    if (input.enabled === undefined && input.rules === undefined) {
      return ActionError.invalidParam('缺少要更新的字段');
    }

    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.update(userId, input, character.value));
  }

  @ActionMethod(LOOTRULE_CMD.setMinLevel)
  async setMinLevel(ctx: FlowContext, data: unknown): Promise<ActionResult<LootRuleStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const minLevel = toFiniteInt(body['minLevel']);
    if (minLevel === undefined) return ActionError.invalidParam('minLevel 非法');
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.setMinLevel(userId, minLevel, character.value));
  }
}

function parseRules(raw: unknown): { ok: true; value: LootRuleEntryDto[] } | { ok: false; fail: ReturnType<typeof ActionError.invalidParam> } {
  if (!Array.isArray(raw)) {
    return { ok: false, fail: ActionError.invalidParam('rules 必须是数组') };
  }
  const out: LootRuleEntryDto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, fail: ActionError.invalidParam('规则条目非法') };
    }
    const entry = item as Record<string, unknown>;
    const id = typeof entry['id'] === 'string' ? entry['id'].trim() : '';
    if (id === '') return { ok: false, fail: ActionError.invalidParam('规则 id 非法') };
    const minQuality = toFiniteInt(entry['minQuality']);
    const minLevel = toFiniteInt(entry['minLevel']);
    const action = toFiniteInt(entry['action']);
    const enabled = toBoolean(entry['enabled']);
    if (minQuality === undefined || minQuality < 0 || minQuality > 6) {
      return { ok: false, fail: ActionError.invalidParam('minQuality 非法') };
    }
    if (minLevel === undefined || minLevel < 0) {
      return { ok: false, fail: ActionError.invalidParam('minLevel 非法') };
    }
    if (action !== 0 && action !== 1 && action !== 2) {
      return { ok: false, fail: ActionError.invalidParam('action 非法') };
    }
    if (enabled === undefined) return { ok: false, fail: ActionError.invalidParam('enabled 非法') };
    out.push({ id, minQuality, minLevel, action, enabled });
  }
  return { ok: true, value: out };
}
