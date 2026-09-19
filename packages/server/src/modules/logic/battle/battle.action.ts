/**
 * 战斗 Action（cmd 40）
 *
 * 本波只落地 `battle.focus`（切换目标）。`battle.log` / `battle.loot` 是**推送路由**
 * （`world.tick` 与掉落记录已经承担），不注册请求 Action。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import { type ActionResult, BATTLE_CMD, ok } from '@idle-dark/protocol';
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
    const characterId =
      toNonEmptyString(body['key']) ?? this.world.activeCharacterOf(userId);
    // 协议附录 A.1：`battle.focus` 入参是 `{ targetId }`（**没有** `unitId`）。
    // `targetId` 为 null 表示取消目标（transport 的 `BattleFocusInput` 允许 null）。
    const targetId = body['targetId'];
    if (!characterId) return ActionError.invalidParam('尚无已选角色');
    if (targetId !== null && toNonEmptyString(targetId) === undefined) {
      return ActionError.invalidParam('缺少 targetId');
    }
    const target = toNonEmptyString(targetId);
    if (!target) return ok(null); // 取消目标：当前无「无目标」运行时状态，直接成功。
    return guardAction(() => this.world.focus(userId, characterId, target));
  }
}
