/**
 * 角色服务（**本次只做最小 HTTP 面**：列表 + 创建占位）
 *
 * 游戏内的角色创建 / 选择 / 存档导入导出由后续任务接续：
 * - 本服务只负责 users/characters/account_state 三张表的读写骨架；
 * - `characters.state` 本次写入 `{}` 占位，后续由 game-core 的存档编码器填充；
 * - **不 import game-core**（其实现由并行任务在写），避免耦合未冻结的实现。
 *
 * 表（scripts/init-db.mjs）：
 *   characters(id text pk, user_id bigint, name text, role text, career text,
 *              level int, peak_level int, state jsonb, created_at timestamptz, last_settle_at timestamptz)
 *   account_state(user_id bigint pk, …, player_slot_count int, …)
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type ActionResult, BusinessErrorCode, type PlayerMetaDto, fail, ok } from '@idle-dark/protocol';
import { bigintToSafeNumber } from '../../common/utils/safe-bigint.js';
import { DatabaseService } from '../database/database.service.js';

const NAME_MAX_LENGTH = 24;
const DEFAULT_ROLE = 'warrior';
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

@Injectable()
export class CharacterService {
  constructor(private readonly database: DatabaseService) {}

  /** 角色列表（轻量元数据，用于选择界面）。 */
  async list(userId: number): Promise<ActionResult<PlayerMetaDto[]>> {
    const rows = await this.database.query<CharacterRow>(
      `SELECT id, user_id, name, role, career, level, peak_level, created_at
         FROM characters
        WHERE user_id = $1
        ORDER BY created_at ASC, id ASC`,
      [userId],
    );
    return ok(rows.rows.map((row) => toMeta(row)));
  }

  /** 创建角色（写入 `state = {}` 占位；栏位来自 account_state.player_slot_count）。 */
  async create(userId: number, input: CreateCharacterInput): Promise<ActionResult<PlayerMetaDto>> {
    const name = input.name.trim();
    if (!name) return fail(BusinessErrorCode.INVALID_PARAM, '角色名不能为空');
    if (name.length > NAME_MAX_LENGTH) {
      return fail(BusinessErrorCode.INVALID_PARAM, `角色名最长 ${NAME_MAX_LENGTH} 个字符`);
    }

    const slotCount = await this.getPlayerSlotCount(userId);
    const used = await this.countCharacters(userId);
    if (used >= slotCount) {
      return fail(BusinessErrorCode.PLAYER_SLOT_FULL);
    }

    const role = input.role?.trim() || DEFAULT_ROLE;
    const career = input.career?.trim() || DEFAULT_CAREER;

    // TODO(后续任务): 角色名唯一性 / game-core 默认存档（state 占位 {} → 完整存档）
    const inserted = await this.database.query<CharacterRow>(
      `INSERT INTO characters (id, user_id, name, role, career, level, peak_level, state, last_settle_at)
       VALUES ($1, $2, $3, $4, $5, 1, 0, '{}'::jsonb, CURRENT_TIMESTAMP)
       RETURNING id, user_id, name, role, career, level, peak_level, created_at`,
      [randomUUID(), userId, name, role, career],
    );
    const row = inserted.rows[0];
    if (!row) return fail(BusinessErrorCode.INTERNAL, '角色创建失败');
    return ok(toMeta(row));
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

function toMeta(row: CharacterRow): PlayerMetaDto {
  return {
    key: row.id,
    name: row.name,
    role: row.role,
    // 展示名映射（roleName / careerName）依赖 game-core 数据表，后续任务补；当前回退为原始 key
    roleName: row.role,
    currentCareer: row.career,
    currentCareerName: row.career,
    level: row.level,
    peakLevel: row.peak_level,
    createdAt: toEpochMs(row.created_at),
    // 战斗运行时由后续 world 域维护；HTTP 列表阶段恒为 false
    inBattle: false,
  };
}

function toEpochMs(value: Date | string): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
