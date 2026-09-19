/**
 * 背包 Action（cmd 段 inventory）—— 只做鉴权 / 参数校验 / 转发。
 *
 * ⚠️ `FlowContext` 必须**值导入**（`import type` 会让 `emitDecoratorMetadata` 退化为
 * `Function`，框架认不出首参 → 鉴权静默失效，见 `AGENTS.md` §5.2）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import {
  type ActionResult,
  type InventorySlotDto,
  INVENTORY_CMD,
} from '@idle-dark/protocol';
import { ActionError, dataOf, requireUserId, toBoolean, toFiniteInt } from '../../../common/kernel/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { InventoryLogicService } from './inventory.logic.service.js';
import {
  parseCharacterId,
  parseOpId,
  parseRequiredString,
} from '../shared/action-parse.js';

@Injectable()
@ActionController(INVENTORY_CMD.cmd)
export class InventoryAction {
  constructor(private readonly logic: InventoryLogicService) {}

  @ActionMethod(INVENTORY_CMD.list)
  async list(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.list(userId, character.value));
  }

  @ActionMethod(INVENTORY_CMD.equip)
  async equip(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const id = parseRequiredString(body, 'id');
    if (!id.ok) return id.fail;
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.equip(userId, id.value, opId.value, character.value),
    );
  }

  @ActionMethod(INVENTORY_CMD.unequip)
  async unequip(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const id = parseRequiredString(body, 'id');
    if (!id.ok) return id.fail;
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.unequip(userId, id.value, opId.value, character.value),
    );
  }

  @ActionMethod(INVENTORY_CMD.sell)
  async sell(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const id = parseRequiredString(body, 'id');
    if (!id.ok) return id.fail;
    const rawCount = body['count'];
    const count = rawCount === undefined ? 1 : toFiniteInt(rawCount);
    if (count === undefined || count <= 0) return this.invalid('出售数量非法');
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.sell(userId, id.value, count, opId.value, character.value),
    );
  }

  @ActionMethod(INVENTORY_CMD.lock)
  async lock(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const id = parseRequiredString(body, 'id');
    if (!id.ok) return id.fail;
    const locked = toBoolean(body['locked']);
    if (locked === undefined) return this.invalid('locked 必须是布尔值');
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.lock(userId, id.value, locked, opId.value, character.value),
    );
  }

  @ActionMethod(INVENTORY_CMD.sort)
  async sort(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.sort(userId, opId.value, character.value));
  }

  @ActionMethod(INVENTORY_CMD.usePackage)
  async usePackage(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const id = parseRequiredString(body, 'id');
    if (!id.ok) return id.fail;
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.usePackage(userId, id.value, opId.value, character.value),
    );
  }

  @ActionMethod(INVENTORY_CMD.expand)
  async expand(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const count = toFiniteInt(body['count']);
    if (count === undefined || count <= 0) return this.invalid('扩容数量非法');
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.expand(userId, count, opId.value, character.value),
    );
  }

  private invalid<T>(message: string): ActionResult<T> {
    // 直接返回失败结果（Action 不抛业务异常）。
    return ActionError.invalidParam(message);
  }
}
