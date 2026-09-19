/**
 * 生产 Action（cmd 段 produce）—— 只做鉴权 / 参数校验 / 转发。
 *
 * `produce.medicineReset` 入参 `{ currency }`；`produce.medicineUse` 入参 `{ material, count }`。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import {
  type ActionResult,
  type DecomposeResultDto,
  type EnchantCostsDto,
  type InventorySlotDto,
  type MedicineStateDto,
  PRODUCE_CMD,
} from '@idle-dark/protocol';
import {
  ActionError,
  dataOf,
  requireUserId,
  toFiniteInt,
} from '../../../ionet/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { ProduceLogicService } from './produce.logic.service.js';
import {
  parseCharacterId,
  parseOpId,
  parseOptionalStringArray,
  parseRequiredString,
} from '../inventory/internal/action-parse.js';

@Injectable()
@ActionController(PRODUCE_CMD.cmd)
export class ProduceAction {
  constructor(private readonly logic: ProduceLogicService) {}

  @ActionMethod(PRODUCE_CMD.enchantCosts)
  async enchantCosts(ctx: FlowContext, data: unknown): Promise<ActionResult<EnchantCostsDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const id = parseRequiredString(body, 'id');
    if (!id.ok) return id.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.enchantCosts(userId, id.value, character.value));
  }

  @ActionMethod(PRODUCE_CMD.enchant)
  async enchant(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const id = parseRequiredString(body, 'id');
    if (!id.ok) return id.fail;
    const locked = parseOptionalStringArray(body, 'lockedAffixKeys');
    if (!locked.ok) return locked.fail;
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.enchant(userId, id.value, locked.value, opId.value, character.value),
    );
  }

  @ActionMethod(PRODUCE_CMD.rebuild)
  async rebuild(ctx: FlowContext, data: unknown): Promise<ActionResult<InventorySlotDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const id = parseRequiredString(body, 'id');
    if (!id.ok) return id.fail;
    const affixKey = parseRequiredString(body, 'affixKey');
    if (!affixKey.ok) return affixKey.fail;
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.rebuild(userId, id.value, affixKey.value, opId.value, character.value),
    );
  }

  @ActionMethod(PRODUCE_CMD.decompose)
  async decompose(ctx: FlowContext, data: unknown): Promise<ActionResult<DecomposeResultDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);

    const rawId = body['id'];
    const rawIds = body['ids'];
    let id: string | undefined;
    let ids: string[] | undefined;

    if (rawId !== undefined && rawId !== null) {
      const parsed = parseRequiredString(body, 'id');
      if (!parsed.ok) return parsed.fail;
      id = parsed.value;
    }
    if (rawIds !== undefined && rawIds !== null) {
      const parsed = parseOptionalStringArray(body, 'ids');
      if (!parsed.ok) return parsed.fail;
      ids = parsed.value;
    }
    if (id === undefined && (ids === undefined || ids.length === 0)) {
      return ActionError.invalidParam('缺少分解目标');
    }

    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.decompose(userId, id, ids, opId.value, character.value),
    );
  }

  @ActionMethod(PRODUCE_CMD.medicineState)
  async medicineState(ctx: FlowContext, data: unknown): Promise<ActionResult<MedicineStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const character = parseCharacterId(dataOf(data));
    if (!character.ok) return character.fail;
    return guardAction(() => this.logic.medicineState(userId, character.value));
  }

  @ActionMethod(PRODUCE_CMD.medicineUse)
  async medicineUse(ctx: FlowContext, data: unknown): Promise<ActionResult<MedicineStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const material = parseRequiredString(body, 'material');
    if (!material.ok) return material.fail;
    const rawCount = body['count'];
    const count = rawCount === undefined ? 1 : toFiniteInt(rawCount);
    if (count === undefined || count <= 0) return ActionError.invalidParam('投入数量非法');
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.medicineUse(userId, material.value, count, opId.value, character.value),
    );
  }

  @ActionMethod(PRODUCE_CMD.medicineReset)
  async medicineReset(ctx: FlowContext, data: unknown): Promise<ActionResult<MedicineStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const currency = body['currency'];
    if (currency !== 'gold' && currency !== 'diamonds') {
      return ActionError.invalidParam('currency 必须是 gold 或 diamonds');
    }
    const opId = parseOpId(body);
    if (!opId.ok) return opId.fail;
    const character = parseCharacterId(body);
    if (!character.ok) return character.fail;
    return guardAction(() =>
      this.logic.medicineReset(userId, currency, opId.value, character.value),
    );
  }
}
