/**
 * 神力商店 Action（cmd 段 shop）—— 只做鉴权 / 参数校验 / 转发。
 *
 * `shop.exchange` 入参 `{ from, to, count? }`（`count` 省略 = 1 份）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import { type ActionResult, SHOP_CMD, type ShopStateDto } from '@idle-dark/protocol';
import { ActionError, dataOf, requireUserId, toFiniteInt } from '../../../ionet/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { ShopLogicService } from './shop.logic.service.js';
import {
  parseCharacterId,
  parseOpId,
  parseRequiredString,
} from '../shared/action-parse.js';

@Injectable()
@ActionController(SHOP_CMD.cmd)
export class ShopAction {
  constructor(private readonly logic: ShopLogicService) {}

  @ActionMethod(SHOP_CMD.state)
  async state(ctx: FlowContext, data: unknown): Promise<ActionResult<ShopStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const character = parseCharacterId(dataOf(data));
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.state(userId, character.value));
  }

  @ActionMethod(SHOP_CMD.buyPlayerSlot)
  async buyPlayerSlot(ctx: FlowContext, data: unknown): Promise<ActionResult<ShopStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.buyPlayerSlot(userId, opId.value, character.value));
  }

  @ActionMethod(SHOP_CMD.exchange)
  async exchange(ctx: FlowContext, data: unknown): Promise<ActionResult<ShopStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const from = parseRequiredString(body, 'from');
    if (!from.ok) return from.fail;
    const to = parseRequiredString(body, 'to');
    if (!to.ok) return to.fail;
    const rawCount = body['count'];
    const count = rawCount === undefined ? 1 : toFiniteInt(rawCount);
    if (count === undefined || count <= 0) return ActionError.invalidParam('兑换数量非法');
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.exchange(userId, from.value, to.value, count, opId.value, character.value),
    );
  }
}
