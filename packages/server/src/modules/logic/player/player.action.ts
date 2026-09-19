/**
 * 角色 Action（cmd 20）
 *
 * 只做参数校验 + 限流 + 转发（业务编排在 `PlayerLogicService`）。
 * ⚠️ `FlowContext` **值导入**（`emitDecoratorMetadata` 鉴权可见性前提）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import {
  type ActionResult,
  PLAYER_CMD,
  type PlayerMetaDto,
  type PlayerStateDto,
} from '@idle-dark/protocol';
import { ActionError, dataOf, requireUserId, toNonEmptyString } from '../../../ionet/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { PlayerLogicService, type PlayerExportSaveDto } from './player-logic.service.js';

@Injectable()
@ActionController(PLAYER_CMD.cmd)
export class PlayerAction {
  constructor(
    private readonly players: PlayerLogicService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  @ActionMethod(PLAYER_CMD.list)
  async list(ctx: FlowContext): Promise<ActionResult<PlayerMetaDto[]>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    return guardAction(() => this.players.list(userId));
  }

  @ActionMethod(PLAYER_CMD.create)
  async create(ctx: FlowContext, data: unknown): Promise<ActionResult<PlayerMetaDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const name = toNonEmptyString(body['name']);
    const role = toNonEmptyString(body['role']);
    if (!name || !role) return ActionError.invalidParam('缺少角色名或角色');
    const career = toNonEmptyString(body['career']);
    const limited = this.rateLimiter.consumeOrFail(`player:create:${userId}`, 10);
    if (limited) return limited;
    return guardAction(() =>
      this.players.create(userId, {
        name,
        role,
        ...(career !== undefined ? { career } : {}),
      }),
    );
  }

  @ActionMethod(PLAYER_CMD.remove)
  async remove(ctx: FlowContext, data: unknown): Promise<ActionResult<null>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const key = toNonEmptyString(dataOf(data)['key']);
    if (!key) return ActionError.invalidParam('缺少角色 key');
    const limited = this.rateLimiter.consumeOrFail(`player:remove:${userId}`, 10);
    if (limited) return limited;
    return guardAction(() => this.players.remove(userId, key));
  }

  @ActionMethod(PLAYER_CMD.importSave)
  async importSave(ctx: FlowContext, data: unknown): Promise<ActionResult<PlayerMetaDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const name = toNonEmptyString(body['name']);
    const role = toNonEmptyString(body['role']) ?? 'Eyer';
    // 兼容两种字段名：传输层定义为 `content`，端到端冒烟脚本用 `save`。
    const rawContent = body['content'] ?? body['save'];
    const content = typeof rawContent === 'string' ? rawContent : '';
    if (!name || content.trim() === '') {
      return ActionError.invalidParam('缺少角色名或存档内容');
    }
    const opId = toNonEmptyString(body['opId']);
    const limited = this.rateLimiter.consumeOrFail(`player:importSave:${userId}`, 5);
    if (limited) return limited;
    return guardAction(() =>
      this.players.importSave(userId, {
        name,
        role,
        content,
        ...(opId !== undefined ? { opId } : {}),
      }),
    );
  }

  @ActionMethod(PLAYER_CMD.exportSave)
  async exportSave(ctx: FlowContext, data: unknown): Promise<ActionResult<PlayerExportSaveDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const key = toNonEmptyString(dataOf(data)['key']);
    if (!key) return ActionError.invalidParam('缺少角色 key');
    const limited = this.rateLimiter.consumeOrFail(`player:exportSave:${userId}`, 10);
    if (limited) return limited;
    return guardAction(() => this.players.exportSave(userId, key));
  }

  @ActionMethod(PLAYER_CMD.select)
  async select(ctx: FlowContext, data: unknown): Promise<ActionResult<PlayerStateDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const key = toNonEmptyString(dataOf(data)['key']);
    if (!key) return ActionError.invalidParam('缺少角色 key');
    const limited = this.rateLimiter.consumeOrFail(`player:select:${userId}`, 20);
    if (limited) return limited;
    return guardAction(() => this.players.select(userId, key));
  }
}
