/**
 * 秘境 Action（cmd 140；09 R3）
 *
 * 只做参数校验 + 角色归属校验 + 转发；业务在 `DungeonLogicService`。
 * ⚠️ `FlowContext` **值导入**（`emitDecoratorMetadata` 鉴权可见性前提）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import type {
  ActionResult,
  ChallengeQueueDto,
  DungeonResetResultDto,
  WorldSnapshotDto,
} from '@idle-dark/protocol';
import { DUNGEON_CMD } from '@idle-dark/protocol';
import {
  ActionError,
  dataOf,
  requireUserId,
  toFiniteInt,
  toNonEmptyString,
} from '../../../common/kernel/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { BATTLE_COMMAND, type BattleCommandPort } from '../shared/index.js';
import { DungeonLogicService } from './dungeon.logic.service.js';

@Injectable()
@ActionController(DUNGEON_CMD.cmd)
export class DungeonAction {
  constructor(
    private readonly dungeons: DungeonLogicService,
    @Inject(BATTLE_COMMAND) private readonly battle: BattleCommandPort,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @ActionMethod(DUNGEON_CMD.queueGet)
  async queueGet(ctx: FlowContext, data: unknown): Promise<ActionResult<ChallengeQueueDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    return guardAction(() => this.dungeons.queueGet(userId, resolved.key));
  }

  @ActionMethod(DUNGEON_CMD.queueSet)
  async queueSet(ctx: FlowContext, data: unknown): Promise<ActionResult<ChallengeQueueDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const resolved = this.resolveKey(userId, body['key']);
    if (!resolved.ok) return resolved.fail;
    if (!Array.isArray(body['entries'])) return ActionError.invalidParam('entries 必须是数组');
    return guardAction(() => this.dungeons.queueSet(userId, resolved.key, body['entries']));
  }

  @ActionMethod(DUNGEON_CMD.queueAdd)
  async queueAdd(ctx: FlowContext, data: unknown): Promise<ActionResult<ChallengeQueueDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const resolved = this.resolveKey(userId, body['key']);
    if (!resolved.ok) return resolved.fail;
    const entry = body['entry'] ?? body;
    return guardAction(() => this.dungeons.queueAdd(userId, resolved.key, entry));
  }

  @ActionMethod(DUNGEON_CMD.queueRemove)
  async queueRemove(ctx: FlowContext, data: unknown): Promise<ActionResult<ChallengeQueueDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const resolved = this.resolveKey(userId, body['key']);
    if (!resolved.ok) return resolved.fail;
    const index = toFiniteInt(body['index']);
    if (index === undefined) return ActionError.invalidParam('index 必须是整数');
    return guardAction(() => this.dungeons.queueRemove(userId, resolved.key, index));
  }

  @ActionMethod(DUNGEON_CMD.queueClear)
  async queueClear(ctx: FlowContext, data: unknown): Promise<ActionResult<ChallengeQueueDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    return guardAction(() => this.dungeons.queueClear(userId, resolved.key));
  }

  @ActionMethod(DUNGEON_CMD.enter)
  async enter(ctx: FlowContext, data: unknown): Promise<ActionResult<WorldSnapshotDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const resolved = this.resolveKey(userId, body['key']);
    if (!resolved.ok) return resolved.fail;
    const map = toNonEmptyString(body['map']);
    if (!map) return ActionError.invalidParam('缺少地图');
    const limited = this.rateLimiter.consumeOrFail(`dungeon:enter:${userId}`, 30);
    if (limited) return limited;
    const opId = toNonEmptyString(body['opId']);
    return guardAction(() =>
      this.dungeons.enter(userId, resolved.key, map, ...(opId !== undefined ? [opId] : [])),
    );
  }

  @ActionMethod(DUNGEON_CMD.leave)
  async leave(ctx: FlowContext, data: unknown): Promise<ActionResult<null>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const resolved = this.resolveKey(userId, dataOf(data)['key']);
    if (!resolved.ok) return resolved.fail;
    return guardAction(() => this.dungeons.leave(userId, resolved.key));
  }

  @ActionMethod(DUNGEON_CMD.reset)
  async reset(ctx: FlowContext, data: unknown): Promise<ActionResult<DungeonResetResultDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const resolved = this.resolveKey(userId, body['key']);
    if (!resolved.ok) return resolved.fail;
    const map = toNonEmptyString(body['map']);
    if (!map) return ActionError.invalidParam('缺少地图');
    const limited = this.rateLimiter.consumeOrFail(`dungeon:reset:${userId}`, 20);
    if (limited) return limited;
    const endlessLevel = toFiniteInt(body['endlessLevel']);
    return guardAction(() =>
      this.dungeons.reset(
        userId,
        resolved.key,
        map,
        ...(endlessLevel !== undefined ? [endlessLevel] : []),
      ),
    );
  }

  private resolveKey(
    userId: number,
    raw: unknown,
  ): { ok: true; key: string } | { ok: false; fail: ActionResult<never> } {
    return this.battle.resolveActiveCharacter(userId, raw);
  }
}
