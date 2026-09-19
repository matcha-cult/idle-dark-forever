/**
 * 离线结算 Action（cmd 120）
 *
 * `report` = 查看/触发离线结算报告；`claim` = 领取（清空待领取报告）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import { type ActionResult, IDLE_CMD, type OfflineReportDto } from '@idle-dark/protocol';
import { dataOf, requireUserId } from '../../../common/kernel/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { WorldService } from '../world/world.service.js';
import { IdleService } from './idle-logic.service.js';

@Injectable()
@ActionController(IDLE_CMD.cmd)
export class IdleAction {
  constructor(
    private readonly idle: IdleService,
    private readonly world: WorldService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @ActionMethod(IDLE_CMD.report)
  async report(ctx: FlowContext, data: unknown): Promise<ActionResult<OfflineReportDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    const limited = this.rateLimiter.consumeOrFail(`idle:report:${userId}`, 20);
    if (limited) return limited;
    return guardAction(() => this.idle.report(userId, resolved.key));
  }

  @ActionMethod(IDLE_CMD.claim)
  async claim(ctx: FlowContext, data: unknown): Promise<ActionResult<OfflineReportDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    const limited = this.rateLimiter.consumeOrFail(`idle:claim:${userId}`, 20);
    if (limited) return limited;
    return guardAction(() => this.idle.claim(userId, resolved.key));
  }

  /** 角色归属校验：见 `WorldService.resolveActiveCharacter`（显式 key 必须等于当前角色）。 */
  private resolveKey(
    userId: number,
    raw: unknown,
  ): { ok: true; key: string } | { ok: false; fail: ActionResult<never> } {
    return this.world.resolveActiveCharacter(userId, raw);
  }
}
