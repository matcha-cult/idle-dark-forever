/**
 * 地图（开放世界）控制器门面（cmd 130；09 §2.2 / §4.1）
 *
 * 拓扑 B：`map` 是**控制器**（地图目录、解锁判定、位置/种子、进图决策），
 * battle 是**唯一仿真器与会话宿主**。本服务因此：
 * - **决定**能不能进哪张图（解锁判定用 shared 的 `evaluateMapUnlock`，唯一实现）；
 * - 把"执行会话切换"这一步**命令**给 battle（R2 阶段过渡为直接调用 `WorldService`，
 *   R4 改为正式命令契约；`map → battle` 已在边界门禁的过渡白名单里，禁止增长）。
 *
 * `world.*`(30) 的兼容入口保持不变。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ActionResult, MapDto, WorldSnapshotDto } from '@idle-dark/protocol';
import { BusinessErrorCode, fail, ok } from '@idle-dark/protocol';
import {
  PlayerContextService,
  evaluateMapUnlock,
  mapListDtoOf,
  pickOpenWorldMap,
  resolveWorldPosition,
} from '../shared/index.js';
import { BATTLE_COMMAND, type BattleCommandPort } from '../shared/index.js';

@Injectable()
export class MapLogicService {
  constructor(
    private readonly contexts: PlayerContextService,
    @Inject(BATTLE_COMMAND) private readonly battle: BattleCommandPort,
  ) {}

  /** 地图目录 + 解锁状态（客户端只渲染，不做数值推导）。 */
  async list(userId: number, characterId: string): Promise<ActionResult<MapDto[]>> {
    const player = await this.contexts.load(userId, characterId);
    if (player === null) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    const extras = await this.contexts.extrasOf(userId);
    const position = resolveWorldPosition(this.contexts.tables, extras.worldMaps[characterId]);
    return ok(mapListDtoOf(this.contexts.tables, player, extras, position.map));
  }

  /** 当前世界快照（与 `world.snapshot` 同形；控制器统一入口）。 */
  async snapshot(userId: number, characterId: string): Promise<ActionResult<WorldSnapshotDto>> {
    return this.battle.snapshot(userId, characterId);
  }

  /**
   * 进入地图：**控制器先做进图决策**（地图存在 + 解锁），再命令 battle 执行会话切换。
   *
   * `opId` 幂等由 battle 会话宿主统一负责（同 opId 重放不重复切换 / 不重复扣费）。
   */
  async enter(
    userId: number,
    characterId: string,
    mapKey: string,
    opId?: string,
  ): Promise<ActionResult<WorldSnapshotDto>> {
    const map = this.contexts.tables.maps[mapKey];
    if (!map) return fail(BusinessErrorCode.MAP_LOCKED, '地图不存在');
    const player = await this.contexts.load(userId, characterId);
    if (player === null) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    const extras = await this.contexts.extrasOf(userId);
    const position = resolveWorldPosition(this.contexts.tables, extras.worldMaps[characterId]);
    if (!evaluateMapUnlock(map.requirement, player, position.map, extras)) {
      return fail(BusinessErrorCode.MAP_LOCKED);
    }
    return this.battle.enterMap(userId, characterId, mapKey, ...(opId !== undefined ? [opId] : []));
  }

  /** 离开当前地图（关会话）。 */
  async leave(userId: number, characterId: string): Promise<ActionResult<null>> {
    return this.battle.leave(userId, characterId);
  }

  /**
   * 控制器间命令：**队列耗尽后转入非秘境战斗图**（RD3/RD4，供 dungeon 控制器调用）。
   *
   * 目标图优先级：`candidate`（= `run.outside`）→ 角色持久化位置 → `home`（`pickOpenWorldMap`）。
   */
  async continueOpenWorld(
    userId: number,
    characterId: string,
    candidate?: string,
  ): Promise<ActionResult<WorldSnapshotDto>> {
    const extras = await this.contexts.extrasOf(userId);
    const position = resolveWorldPosition(this.contexts.tables, extras.worldMaps[characterId]);
    const target = pickOpenWorldMap(this.contexts.tables, candidate, position.map);
    return this.enter(userId, characterId, target);
  }
}
