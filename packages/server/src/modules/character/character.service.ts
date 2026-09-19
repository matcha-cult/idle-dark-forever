/**
 * 角色服务（持久化门面）
 *
 * 职责：`characters` 表的最小 CRUD + 真实存档生成。
 *
 * 本次改造（Wave 2）：`state` 从 `'{}'` 占位换成 **game-core 的真实 `Player` 存档**
 * （`Player.toJSON()`），展示名（`roleName` / `currentCareerName`）取自 `DataTables`。
 * 真正的存档逻辑在 `PlayerContextService`（DB ↔ game-core 胶水层），本服务只做表级编排。
 *
 * 表（scripts/init-db.mjs）：
 *   characters(id text pk, user_id bigint, name text, role text, career text,
 *              level int, peak_level int, state jsonb, created_at timestamptz, last_settle_at timestamptz)
 *   account_state(user_id bigint pk, diamonds int, player_slot_count int, highest_endless_level int, data jsonb, …)
 */
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type ActionResult, BusinessErrorCode, type PlayerMetaDto, fail, ok } from '@idle-dark/protocol';
import {
  BATTLE_COMMAND,
  DATA_TABLES,
  PlayerContextService,
  careerDisplayName,
  roleDisplayName,
  type BattleCommandPort,
} from '../logic/shared/index.js';
import type { DataTables, Player } from '@idle-dark/game-core';
import { bigintToSafeNumber } from '../../common/utils/safe-bigint.js';
import { DatabaseService } from '../database/database.service.js';

const NAME_MAX_LENGTH = 24;
/** 默认角色（`DataTables.roles` 的真实 key，不是职业）。 */
const DEFAULT_ROLE = 'Eyer';
const DEFAULT_CAREER = 'warrior';

interface CharacterRow {
  id: string;
  user_id: string;
  name: string;
  role: string;
  career: string;
  level: number;
  peak_level: number;
  created_at: Date | string;
}

export interface CreateCharacterInput {
  name: string;
  role?: string;
  career?: string;
}

/** 导入旧存档时使用的创建入参。 */
export interface CreateCharacterFromSaveInput {
  name: string;
  role: string;
  state: unknown;
}

@Injectable()
export class CharacterService {
  private readonly tables: DataTables;

  constructor(
    private readonly database: DatabaseService,
    private readonly playerContext: PlayerContextService,
    @Inject(BATTLE_COMMAND) private readonly battle: BattleCommandPort,
    @Inject(DATA_TABLES) tables: DataTables,
  ) {
    this.tables = tables;
  }

  /** 角色列表（轻量元数据，用于选择界面）。 */
  async list(userId: number): Promise<ActionResult<PlayerMetaDto[]>> {
    const rows = await this.database.query<CharacterRow>(
      `SELECT id, user_id, name, role, career, level, peak_level, created_at
         FROM characters
        WHERE user_id = $1
        ORDER BY created_at ASC, id ASC`,
      [userId],
    );
    return ok(rows.rows.map((row) => this.metaOfRow(userId, row)));
  }

  /** 创建角色：写入真实存档（`Player.postCreate` 的产物）。 */
  async create(userId: number, input: CreateCharacterInput): Promise<ActionResult<PlayerMetaDto>> {
    const name = input.name.trim();
    const invalid = this.validateName(name);
    if (invalid) return invalid;
    if (await this.nameTaken(userId, name)) return fail(BusinessErrorCode.PLAYER_NAME_TAKEN);

    const slotCheck = await this.checkSlot(userId);
    if (slotCheck) return slotCheck;

    const role = this.resolveRole(input.role);
    const career = this.resolveCareer(input.career ?? this.tables.roles[role]?.defaultCareer);

    const id = randomUUID();
    const inserted = await this.insertRow(userId, id, name, role, career);
    if (inserted) return inserted;

    try {
      const player = await this.playerContext.create(userId, id, role, career);
      return ok(this.metaOfPlayer(player, userId));
    } catch (error) {
      // 回滚半成品行，避免列表里出现无法加载的坏角色。
      await this.database.query('DELETE FROM characters WHERE id = $1 AND user_id = $2', [id, userId]);
      throw error;
    }
  }

  /** 用一份已解析的旧存档创建角色（`player.importSave`）。 */
  async createFromSave(
    userId: number,
    input: CreateCharacterFromSaveInput,
  ): Promise<ActionResult<PlayerMetaDto>> {
    const name = input.name.trim();
    const invalid = this.validateName(name);
    if (invalid) return invalid;
    if (await this.nameTaken(userId, name)) return fail(BusinessErrorCode.PLAYER_NAME_TAKEN);

    const slotCheck = await this.checkSlot(userId);
    if (slotCheck) return slotCheck;

    const role = this.resolveRole(input.role);
    const id = randomUUID();
    const inserted = await this.insertRow(userId, id, name, role, '');
    if (inserted) return inserted;

    try {
      const player = await this.playerContext.adopt(userId, id, input.state);
      // 存档里的 role 优先（`adopt` 已经从 state 里读回真实 role）。
      const career = player.currentCareer ?? '';
      await this.database.query(
        'UPDATE characters SET role = $1, career = $2, level = $3, peak_level = $4 WHERE id = $5 AND user_id = $6',
        [player.role, career, finiteInt(player.level, 1), finiteInt(player.peakLevel, 0), id, userId],
      );
      return ok(this.metaOfPlayer(player, userId));
    } catch (error) {
      await this.database.query('DELETE FROM characters WHERE id = $1 AND user_id = $2', [id, userId]);
      throw error;
    }
  }

  /** 删除角色（同时移出内存缓存）。 */
  async remove(userId: number, characterId: string): Promise<ActionResult<null>> {
    const result = await this.database.query<{ id: string }>(
      'DELETE FROM characters WHERE id = $1 AND user_id = $2 RETURNING id',
      [characterId, userId],
    );
    if (result.rows.length === 0) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    this.playerContext.invalidate(userId, characterId);
    return ok(null);
  }

  /** 单角色元数据（`player.select` 后回吐）。 */
  metaOfPlayer(player: Player, userId: number): PlayerMetaDto {
    const career = player.currentCareer;
    return {
      key: player.key,
      name: player.name,
      role: player.role,
      roleName: roleDisplayName(this.tables, player.role),
      currentCareer: career ?? '',
      currentCareerName: careerDisplayName(this.tables, career),
      level: finiteInt(player.level, 1),
      peakLevel: finiteInt(player.peakLevel, 0),
      createdAt: finiteInt(player.timestamp, 0),
      inBattle: this.battle.isInBattle(userId, player.key),
    };
  }

  // ────────────────────────────── 内部 ──────────────────────────────

  private metaOfRow(userId: number, row: CharacterRow): PlayerMetaDto {
    return {
      key: row.id,
      name: row.name,
      role: row.role,
      roleName: roleDisplayName(this.tables, row.role),
      currentCareer: row.career,
      currentCareerName: careerDisplayName(this.tables, row.career),
      level: finiteInt(row.level, 1),
      peakLevel: finiteInt(row.peak_level, 0),
      createdAt: toEpochMs(row.created_at),
      inBattle: this.battle.isInBattle(userId, row.id),
    };
  }

  private validateName(name: string): ActionResult<PlayerMetaDto> | null {
    if (!name) return fail(BusinessErrorCode.INVALID_PARAM, '角色名不能为空');
    if (name.length > NAME_MAX_LENGTH) {
      return fail(BusinessErrorCode.INVALID_PARAM, `角色名最长 ${NAME_MAX_LENGTH} 个字符`);
    }
    return null;
  }

  private resolveRole(role: string | undefined): string {
    const candidate = role?.trim();
    if (candidate && this.tables.roles[candidate]) return candidate;
    return DEFAULT_ROLE;
  }

  private resolveCareer(career: string | undefined): string {
    const candidate = career?.trim();
    if (candidate && this.tables.careers[candidate]) return candidate;
    return DEFAULT_CAREER;
  }

  private async nameTaken(userId: number, name: string): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      'SELECT id FROM characters WHERE user_id = $1 AND name = $2 LIMIT 1',
      [userId, name],
    );
    return result.rows.length > 0;
  }

  private async checkSlot(userId: number): Promise<ActionResult<PlayerMetaDto> | null> {
    const slotCount = await this.getPlayerSlotCount(userId);
    const used = await this.countCharacters(userId);
    if (used >= slotCount) return fail(BusinessErrorCode.PLAYER_SLOT_FULL);
    return null;
  }

  private async insertRow(
    userId: number,
    id: string,
    name: string,
    role: string,
    career: string,
  ): Promise<ActionResult<PlayerMetaDto> | null> {
    const inserted = await this.database.query<CharacterRow>(
      `INSERT INTO characters (id, user_id, name, role, career, level, peak_level, state, last_settle_at)
       VALUES ($1, $2, $3, $4, $5, 1, 0, '{}'::jsonb, CURRENT_TIMESTAMP)
       RETURNING id, user_id, name, role, career, level, peak_level, created_at`,
      [id, userId, name, role, career],
    );
    if (!inserted.rows[0]) return fail(BusinessErrorCode.INTERNAL, '角色创建失败');
    return null;
  }

  private async countCharacters(userId: number): Promise<number> {
    const result = await this.database.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM characters WHERE user_id = $1',
      [userId],
    );
    return bigintToSafeNumber(result.rows[0]?.count ?? '0', 'characters.count');
  }

  private async getPlayerSlotCount(userId: number): Promise<number> {
    const result = await this.database.query<{ player_slot_count: number | null }>(
      'SELECT player_slot_count FROM account_state WHERE user_id = $1',
      [userId],
    );
    const slots = result.rows[0]?.player_slot_count ?? 1;
    return Number.isSafeInteger(slots) && slots > 0 ? slots : 1;
  }
}

function finiteInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function toEpochMs(value: Date | string): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
