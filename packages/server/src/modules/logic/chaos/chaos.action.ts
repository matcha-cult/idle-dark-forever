/**
 * 混沌仪 Action（cmd 140；W6）
 *
 * 只做参数校验 + 限流 + 角色归属校验 + 转发；业务编排在 `ChaosLogicService`。
 * ⚠️ `FlowContext` **值导入**（`emitDecoratorMetadata` 鉴权可见性前提）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import type { ActionResult, ChaosStateDto } from '@idle-dark/protocol';
import { CHAOS_CMD } from '@idle-dark/protocol';
import { ActionError, dataOf, requireUserId, toNonEmptyString } from '../../../common/kernel/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { BATTLE_COMMAND, type BattleCommandPort } from '../shared/index.js';
import { ChaosLogicService } from './chaos.logic.service.js';

@Injectable()
@ActionController(CHAOS_CMD.cmd)
export class ChaosAction {
  constructor(
    private readonly chaos: ChaosLogicService,
    @Inject(BATTLE_COMMAND) private readonly battle: BattleCommandPort,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @ActionMethod(CHAOS_CMD.state)
  async state(ctx: FlowContext, data: unknown): Promise<ActionResult<ChaosStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    return guardAction(() => this.chaos.state(userId, resolved.key));
  }

  @ActionMethod(CHAOS_CMD.setSequence)
  async setSequence(ctx: FlowContext, data: unknown): Promise<ActionResult<ChaosStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const resolved = this.resolveKey(userId, body['key']);
    if (!resolved.ok) return resolved.fail;
    if (!Array.isArray(body['sequence'])) return ActionError.invalidParam('缺少钥石序列');
    return guardAction(() => this.chaos.setSequence(userId, resolved.key, body['sequence']));
  }

  @ActionMethod(CHAOS_CMD.setFailMode)
  async setFailMode(ctx: FlowContext, data: unknown): Promise<ActionResult<ChaosStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const resolved = this.resolveKey(userId, body['key']);
    if (!resolved.ok) return resolved.fail;
    const failMode = toNonEmptyString(body['failMode']);
    if (failMode === undefined) return ActionError.invalidParam('缺少失败选项');
    return guardAction(() => this.chaos.setFailMode(userId, resolved.key, failMode));
  }

  @ActionMethod(CHAOS_CMD.start)
  async start(ctx: FlowContext, data: unknown): Promise<ActionResult<ChaosStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    const limited = this.rateLimiter.consumeOrFail(`chaos:start:${userId}`, 10);
    if (limited) return limited;
    return guardAction(() => this.chaos.start(userId, resolved.key));
  }

  @ActionMethod(CHAOS_CMD.stop)
  async stop(ctx: FlowContext, data: unknown): Promise<ActionResult<ChaosStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    const limited = this.rateLimiter.consumeOrFail(`chaos:stop:${userId}`, 10);
    if (limited) return limited;
    return guardAction(() => this.chaos.stop(userId, resolved.key));
  }

  /** 角色归属校验：唯一入口在 battle 命令端口（`resolveActiveCharacter`，AGENTS §15）。 */
  private resolveKey(
    userId: number,
    raw: unknown,
  ): { ok: true; key: string } | { ok: false; fail: ActionResult<never> } {
    return this.battle.resolveActiveCharacter(userId, raw);
  }
}
