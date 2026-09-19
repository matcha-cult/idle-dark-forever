/**
 * 地图 Action（cmd 130；09 R2）
 *
 * 只做参数校验 + 限流 + 角色归属校验 + 转发；业务编排在 `MapLogicService`。
 * ⚠️ `FlowContext` **值导入**（`emitDecoratorMetadata` 鉴权可见性前提）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import type { ActionResult, MapDto, WorldSnapshotDto } from '@idle-dark/protocol';
import { MAP_CMD } from '@idle-dark/protocol';
import { ActionError, dataOf, requireUserId, toNonEmptyString } from '../../../common/kernel/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { WorldService } from '../world/world.service.js';
import { MapLogicService } from './map.logic.service.js';

@Injectable()
@ActionController(MAP_CMD.cmd)
export class MapAction {
  constructor(
    private readonly maps: MapLogicService,
    private readonly world: WorldService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @ActionMethod(MAP_CMD.list)
  async list(ctx: FlowContext, data: unknown): Promise<ActionResult<MapDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    return guardAction(() => this.maps.list(userId, resolved.key));
  }

  @ActionMethod(MAP_CMD.snapshot)
  async snapshot(ctx: FlowContext, data: unknown): Promise<ActionResult<WorldSnapshotDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    return guardAction(() => this.maps.snapshot(userId, resolved.key));
  }

  @ActionMethod(MAP_CMD.enter)
  async enter(ctx: FlowContext, data: unknown): Promise<ActionResult<WorldSnapshotDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const resolved = this.resolveKey(userId, body['key']);
    if (!resolved.ok) return resolved.fail;
    const map = toNonEmptyString(body['map']);
    if (!map) return ActionError.invalidParam('缺少地图');
    const limited = this.rateLimiter.consumeOrFail(`map:enter:${userId}`, 30);
    if (limited) return limited;
    const opId = toNonEmptyString(body['opId']);
    return guardAction(() =>
      this.maps.enter(userId, resolved.key, map, ...(opId !== undefined ? [opId] : [])),
    );
  }

  @ActionMethod(MAP_CMD.leave)
  async leave(ctx: FlowContext, data: unknown): Promise<ActionResult<null>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    return guardAction(() => this.maps.leave(userId, resolved.key));
  }

  /** 角色归属校验：唯一入口在 `WorldService.resolveActiveCharacter`（AGENTS §15）。 */
  private resolveKey(
    userId: number,
    raw: unknown,
  ): { ok: true; key: string } | { ok: false; fail: ActionResult<never> } {
    return this.world.resolveActiveCharacter(userId, raw);
  }
}
