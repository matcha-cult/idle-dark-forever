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
import { ActionError, dataOf, requireUserId, toNonEmptyString } from '../../../ionet/action-support.js';
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
    const key = this.resolveKey(userId, dataOf(data)['key']);
    if (!key) return ActionError.invalidParam('缺少角色 key');
    return guardAction(() => this.world.snapshot(userId, key));
  }

  @ActionMethod(WORLD_CMD.enterMap)
  async enterMap(ctx: FlowContext, data: unknown): Promise<ActionResult<WorldSnapshotDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const key = this.resolveKey(userId, body['key']);
    const map = toNonEmptyString(body['map']);
    if (!key || !map) return ActionError.invalidParam('缺少角色 key 或地图');
    const limited = this.rateLimiter.consumeOrFail(`world:enterMap:${userId}`, 30);
    if (limited) return limited;
    return guardAction(() => this.world.enterMap(userId, key, map));
  }

  @ActionMethod(WORLD_CMD.leave)
  async leave(ctx: FlowContext, data: unknown): Promise<ActionResult<null>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const key = this.resolveKey(userId, dataOf(data)['key']);
    if (!key) return ActionError.invalidParam('缺少角色 key');
    return guardAction(() => this.world.leave(userId, key));
  }

  @ActionMethod(WORLD_CMD.skipOffline)
  async skipOffline(ctx: FlowContext, data: unknown): Promise<ActionResult<OfflineReportDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const key = this.resolveKey(userId, dataOf(data)['key']);
    if (!key) return ActionError.invalidParam('缺少角色 key');
    return guardAction(() => this.world.skipOffline(userId, key));
  }

  /** 前端不带 key 时回退到「最近一次 select 的角色」。 */
  private resolveKey(userId: number, raw: unknown): string | undefined {
    return toNonEmptyString(raw) ?? this.world.activeCharacterOf(userId);
  }
}
