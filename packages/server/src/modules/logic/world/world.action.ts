/**
 * 世界 Action（cmd 30）
 *
 * 只做参数校验 + 限流 + 转发（业务编排在 `WorldService`）。
 * ⚠️ `FlowContext` **值导入**（`emitDecoratorMetadata` 鉴权可见性前提）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import {
  type ActionResult,
  type OfflineReportDto,
  WORLD_CMD,
  type WorldSnapshotDto,
} from '@idle-dark/protocol';
import { ActionError, dataOf, requireUserId, toNonEmptyString } from '../../../common/kernel/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { WorldService } from './world.service.js';

@Injectable()
@ActionController(WORLD_CMD.cmd)
export class WorldAction {
  constructor(
    private readonly world: WorldService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @ActionMethod(WORLD_CMD.snapshot)
  async snapshot(ctx: FlowContext, data: unknown): Promise<ActionResult<WorldSnapshotDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    return guardAction(() => this.world.snapshot(userId, resolved.key));
  }

  @ActionMethod(WORLD_CMD.enterMap)
  async enterMap(ctx: FlowContext, data: unknown): Promise<ActionResult<WorldSnapshotDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const resolved = this.resolveKey(userId, body['key']);
    const map = toNonEmptyString(body['map']);
    if (!resolved.ok) return resolved.fail;
    if (!map) return ActionError.invalidParam('缺少地图');
    const limited = this.rateLimiter.consumeOrFail(`world:enterMap:${userId}`, 30);
    if (limited) return limited;
    const opId = toNonEmptyString(body['opId']);
    return guardAction(() =>
      this.world.enterMap(userId, resolved.key, map, ...(opId !== undefined ? [opId] : [])),
    );
  }

  @ActionMethod(WORLD_CMD.leave)
  async leave(ctx: FlowContext, data: unknown): Promise<ActionResult<null>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    return guardAction(() => this.world.leave(userId, resolved.key));
  }

  @ActionMethod(WORLD_CMD.skipOffline)
  async skipOffline(ctx: FlowContext, data: unknown): Promise<ActionResult<OfflineReportDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    return guardAction(() => this.world.skipOffline(userId, resolved.key));
  }

  /**
   * 角色归属校验：见 `WorldService.resolveActiveCharacter`。
   * 显式 key 必须等于本账号当前角色，否则直接失败（不允许操作别的角色）。
   */
  private resolveKey(
    userId: number,
    raw: unknown,
  ): { ok: true; key: string } | { ok: false; fail: ActionResult<never> } {
    return this.world.resolveActiveCharacter(userId, raw);
  }
}
