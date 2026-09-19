/**
 * 储藏箱 Action（cmd 段 bank）—— 只做鉴权 / 参数校验 / 转发。
 *
 * `bank.deposit` / `bank.withdraw` 入参 `{ id, count? }`（`count` 省略 = 整叠）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import { type ActionResult, BANK_CMD, type InventorySlotDto } from '@idle-dark/protocol';
import { ActionError, dataOf, requireUserId, toFiniteInt } from '../../../ionet/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { BankLogicService } from './bank.logic.service.js';
import {
  parseCharacterId,
  parseOpId,
  parseRequiredString,
} from '../shared/action-parse.js';

@Injectable()
@ActionController(BANK_CMD.cmd)
export class BankAction {
  constructor(private readonly logic: BankLogicService) {}

  @ActionMethod(BANK_CMD.list)
  async list(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const character = parseCharacterId(dataOf(data));
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.list(userId, character.value));
  }

  @ActionMethod(BANK_CMD.deposit)
  async deposit(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const id = parseRequiredString(body, 'id');
    if (!id.ok) return id.fail;
    const count = optionalCount(body);
    if (count === false) return ActionError.invalidParam('转移数量非法');
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.deposit(userId, id.value, count, opId.value, character.value),
    );
  }

  @ActionMethod(BANK_CMD.withdraw)
  async withdraw(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const id = parseRequiredString(body, 'id');
    if (!id.ok) return id.fail;
    const count = optionalCount(body);
    if (count === false) return ActionError.invalidParam('转移数量非法');
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.withdraw(userId, id.value, count, opId.value, character.value),
    );
  }

  @ActionMethod(BANK_CMD.expand)
  async expand(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const count = toFiniteInt(body['count']);
    if (count === undefined || count <= 0) return ActionError.invalidParam('扩容数量非法');
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.expand(userId, count, opId.value, character.value),
    );
  }
}

/** 可选数量：缺失 → undefined（整叠）；非法（非有限数 / <= 0）→ false。 */
function optionalCount(body: Record<string, unknown>): number | undefined | false {
  const raw = body['count'];
  if (raw === undefined || raw === null) return undefined;
  const count = toFiniteInt(raw);
  if (count === undefined || count <= 0) return false;
  return count;
}
