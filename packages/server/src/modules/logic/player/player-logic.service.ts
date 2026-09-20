/**
 * `PlayerLogicService` —— 角色域编排（cmd 20）
 *
 * 返回形状严格遵循 `ai-docs/02-wave2-任务书.md` 附录 A.1：
 * - `list`   → `PlayerMetaDto[]`（数组）
 * - `create` → `PlayerMetaDto`（单个对象）
 * - `remove` → `null`
 * - `importSave` → `PlayerMetaDto`
 * - `exportSave` → `{ key, filename, content }`（形状对齐 `ionet-transport` 的 `PlayerExportSaveDto`）
 * - `select` → `PlayerStateDto`
 */
import { Inject, Injectable } from '@nestjs/common';
import { worldStop, type DataTables, type Player } from '@idle-dark/game-core';
import {
  type ActionResult,
  BusinessErrorCode,
  type PlayerMetaDto,
  type PlayerStateDto,
  fail,
  ok,
} from '@idle-dark/protocol';
import { OpIdempotencyService } from '../../game/op-idempotency.service.js';
import { CharacterService } from '../../character/character.service.js';
import {
  DATA_TABLES,
  GAME_CLOCK,
  PlayerContextService,
  type NowSource,
  playerStateDtoOf,
} from '../shared/index.js';
import { BATTLE_COMMAND, type BattleCommandPort } from '../shared/index.js';
import { PanelCharacterService } from '../shared/panel-character.service.js';
import { parseLegacyPlayerSave } from './internal/save-import.js';

/** `exportSave` 的返回形状（与 `@idle-dark/ionet-transport` 的 `PlayerExportSaveDto` 对齐）。 */
export interface PlayerExportSaveDto {
  key: string;
  filename: string;
  content: string;
  /**
   * `content` 的别名。
   *
   * `protocol` 未定义该 DTO（见交付报告"未闭合项"），而 `game-flow-smoke.mjs` 按 `save`
   * 字段读取；这里同时给出 `content` 与 `save`，两种读取都成立。
   */
  save: string;
}

export interface PlayerCreateCommand {
  name: string;
  role: string;
  career?: string;
}

export interface PlayerImportSaveCommand {
  name: string;
  role: string;
  content: string;
  opId?: string;
}

@Injectable()
export class PlayerLogicService {
  private readonly tables: DataTables;
  private readonly now: NowSource;

  constructor(
    private readonly characters: CharacterService,
    private readonly playerContext: PlayerContextService,
    @Inject(BATTLE_COMMAND) private readonly battle: BattleCommandPort,
    private readonly opIds: OpIdempotencyService,
    private readonly panelCharacters: PanelCharacterService,
    @Inject(GAME_CLOCK) now: NowSource,
    @Inject(DATA_TABLES) tables: DataTables,
  ) {
    this.now = now;
    this.tables = tables;
  }

  list(userId: number): Promise<ActionResult<PlayerMetaDto[]>> {
    return this.characters.list(userId);
  }

  create(userId: number, command: PlayerCreateCommand): Promise<ActionResult<PlayerMetaDto>> {
    return this.characters.create(userId, {
      name: command.name,
      role: command.role,
      ...(command.career !== undefined ? { career: command.career } : {}),
    });
  }

  async remove(userId: number, characterId: string): Promise<ActionResult<null>> {
    // 先停世界，避免删除后仍有内存会话在跑。
    await this.battle.stopSession(userId, characterId).catch(() => undefined);
    return this.characters.remove(userId, characterId);
  }

  async select(userId: number, characterId: string): Promise<ActionResult<PlayerStateDto>> {
    // ⚠️ 一个账号同一时刻**只能有一个活跃角色会话**。
    // 旧实现只 `start(新角色)` 不停旧会话 → 两个角色的世界同时 tick，而框架的定向推送
    // 是按 userId 扇出到该账号的**全部**连接，于是会出现「两条连接互相收到/推进对方的角色」
    // = 串号 + 双份推送。
    const previous = this.battle.activeCharacterOf(userId);
    const started = await this.battle.startSession(userId, characterId);
    if (!started) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    if (previous !== undefined && previous !== characterId) {
      await this.battle.stopSession(userId, previous);
    }
    const player = this.playerContext.peek(userId, characterId);
    if (!player) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    // 同步面板域的「当前角色」注册表。面板请求的载荷不带 characterId，
    // 不同步的话多角色账号会一直操作「最近创建」的那个角色（两个注册表必须一起写）。
    this.panelCharacters.setActive(userId, characterId);
    const extras = await this.playerContext.extrasOf(userId);
    const position = this.battle.positionOf(userId, characterId) ?? { map: 'home' };
    return ok(
      playerStateDtoOf(this.tables, player, {
        extras,
        map: position.map,
        pendingOfflineMs: this.battle.pendingOfflineMs(userId, characterId),
        usableByKey: this.battle.usableByKey(),
      }),
    );
  }

  /**
   * 导入《永夜2016典藏重置版》本地存档。
   *
   * 幂等：带 `opId` 时走 `OpIdempotencyService`（重放返回首次结果；失败必须 abort）。
   */
  async importSave(
    userId: number,
    command: PlayerImportSaveCommand,
  ): Promise<ActionResult<PlayerMetaDto>> {
    const claim = this.opIds.begin(userId, command.opId);
    if (claim.kind === 'invalid') {
      return fail(BusinessErrorCode.INVALID_PARAM, claim.reason);
    }
    if (claim.kind === 'duplicate') {
      if (claim.inFlight) return fail(BusinessErrorCode.DUPLICATE_OPERATION, '存档导入正在处理中');
      return ok(claim.result as PlayerMetaDto);
    }

    try {
      const parsed = parseLegacyPlayerSave(command.content);
      if (!parsed.ok) {
        this.opIds.abort(userId, command.opId ?? '');
        return fail(parsed.code, parsed.message);
      }

      // 存档里的 role 优先；请求里的 role 只是缺失时的兜底。
      const role = parsed.role ?? command.role;
      const result = await this.characters.createFromSave(userId, {
        name: command.name,
        role,
        state: parsed.state,
      });
      if (!result.success) {
        this.opIds.abort(userId, command.opId ?? '');
        return result;
      }
      this.opIds.settle(userId, command.opId ?? '', result.data);
      return result;
    } catch (error) {
      this.opIds.abort(userId, command.opId ?? '');
      throw error;
    }
  }

  async exportSave(
    userId: number,
    characterId: string,
  ): Promise<ActionResult<PlayerExportSaveDto>> {
    const player = await this.playerContext.load(userId, characterId);
    if (!player) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    return ok(buildExportSave(player));
  }
}

/** 导出存档（`worldStop` 可逆混淆，等价原版「下载存档」）。 */
export function buildExportSave(player: Player): PlayerExportSaveDto {
  const content = worldStop(player.toJSON(), { injectRandom: false });
  const safeName = player.name.replace(/[^\p{L}\p{N}_-]/gu, '_') || 'player';
  return {
    key: player.key,
    filename: `idle-dark-${safeName}-${player.key}.save`,
    content,
    save: content,
  };
}
