/**
 * 战斗 Action（cmd 40）
 *
 * 本波只落地 `battle.focus`（切换目标）。`battle.log` / `battle.loot` 是**推送路由**
 * （`world.tick` 与掉落记录已经承担），不注册请求 Action。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import { type ActionResult, BATTLE_CMD } from '@idle-dark/protocol';
import { ActionError, dataOf, requireUserId, toNonEmptyString } from '../../../ionet/action-support.js';
import { guardAction } from '../../../common/kernel/result.js';
import { WorldService } from '../world/world.service.js';

@Injectable()
@ActionController(BATTLE_CMD.cmd)
export class BattleAction {
  constructor(private readonly world: WorldService) {}

  @ActionMethod(BATTLE_CMD.focus)
  async focus(ctx: FlowContext, data: unknown): Promise<ActionResult<null>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    const body = dataOf(data);
    const characterId = toNonEmptyString(body['key']);
    // 协议附录 A.1：`battle.focus` 入参是 `{ targetId }`（**没有** `unitId`）。
    const targetId = toNonEmptyString(body['targetId']);
    if (!characterId || !targetId) return ActionError.invalidParam('缺少角色 key 或 targetId');
    return guardAction(() => this.world.focus(userId, characterId, targetId));
  }
}
