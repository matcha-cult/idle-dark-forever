/**
 * 内存 `DatabaseService` 替身（单测用）
 *
 * 沙箱内没有可用的 PostgreSQL（`AGENTS.md` §7.7），因此所有依赖 DB 的编排都必须在
 * `packages/server/test/` 用内存替身验证。这里只实现 `PlayerContextService` /
 * `CharacterService` 用到的那几条 SQL（按关键字路由），并记录调用次数。
 */
import type { GameDatabaseService } from '../../src/modules/game/game-database.service.js';

export interface FakeCharacterRow {
  id: string;
  user_id: string;
  name: string;
  role: string;
  career: string;
  level: number;
  state: unknown;
  created_at: Date;
  last_settle_at: Date;
}

export interface FakeAccountRow {
  user_id: number;
  diamonds: number;
  player_slot_count: number;
  highest_endless_level: number;
  data: Record<string, unknown>;
}

export class FakeDatabase {
  readonly characters = new Map<string, FakeCharacterRow>();
  readonly accounts = new Map<number, FakeAccountRow>();
  /** 每次写操作（INSERT/UPDATE/DELETE）计数，供「节流」断言。 */
  writes = 0;
  queries = 0;

  seedCharacter(row: Partial<FakeCharacterRow> & { id: string; user_id: number }): void {
    this.characters.set(row.id, {
      id: row.id,
      user_id: String(row.user_id),
      name: row.name ?? row.id,
      role: row.role ?? 'Eyer',
      career: row.career ?? 'warrior',
      level: row.level ?? 1,
      state: row.state ?? {},
      created_at: row.created_at ?? new Date(0),
      last_settle_at: row.last_settle_at ?? new Date(0),
    });
  }

  seedAccount(userId: number, row: Partial<FakeAccountRow> = {}): void {
    this.accounts.set(userId, {
      user_id: userId,
      diamonds: row.diamonds ?? 0,
      player_slot_count: row.player_slot_count ?? 1,
      highest_endless_level: row.highest_endless_level ?? 0,
      data: row.data ?? {},
    });
  }

  /** 造一个满足 `GameDatabaseService` 形状的实例（只实现 `query`）。 */
  asService(): GameDatabaseService {
    return { query: this.query.bind(this) } as unknown as GameDatabaseService;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    this.queries += 1;
    const text = sql.replace(/\s+/g, ' ').trim();
    const upper = text.toUpperCase();

    if (upper.startsWith('SELECT') && upper.includes('FROM CHARACTERS')) {
      if (upper.includes('COUNT(*)')) {
        const userId = String(params[0]);
        const count = [...this.characters.values()].filter((r) => r.user_id === userId).length;
        return { rows: [{ count: String(count) } as unknown as T], rowCount: 1 };
      }
      if (upper.includes('WHERE ID = $1 AND USER_ID = $2')) {
        const row = this.characters.get(String(params[0]));
        if (!row || row.user_id !== String(params[1])) return { rows: [], rowCount: 0 };
        return { rows: [row as unknown as T], rowCount: 1 };
      }
      if (upper.includes('WHERE USER_ID = $1 AND NAME = $2')) {
        const userId = String(params[0]);
        const name = String(params[1]);
        const rows = [...this.characters.values()].filter(
          (r) => r.user_id === userId && r.name === name,
        );
        return { rows: rows.slice(0, 1) as unknown as T[], rowCount: rows.length };
      }
      if (upper.includes('WHERE USER_ID = $1')) {
        const userId = String(params[0]);
        const rows = [...this.characters.values()]
          .filter((r) => r.user_id === userId)
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
        return { rows: rows as unknown as T[], rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith('UPDATE CHARACTERS')) {
      // UPDATE ... SET state=$1, role=$2, career=$3, level=$4 WHERE id=$5 AND user_id=$6
      this.writes += 1;
      const row = this.characters.get(String(params[4]));
      if (row && row.user_id === String(params[5])) {
        row.state = parseJson(params[0]);
        row.role = String(params[1]);
        row.career = String(params[2]);
        row.level = Number(params[3]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith('INSERT INTO CHARACTERS')) {
      this.writes += 1;
      const row: FakeCharacterRow = {
        id: String(params[0]),
        user_id: String(params[1]),
        name: String(params[2]),
        role: String(params[3]),
        career: String(params[4]),
        level: 1,
        state: {},
        created_at: new Date(0),
        last_settle_at: new Date(0),
      };
      this.characters.set(row.id, row);
      return { rows: [row as unknown as T], rowCount: 1 };
    }

    if (upper.startsWith('DELETE FROM CHARACTERS')) {
      this.writes += 1;
      const id = String(params[0]);
      const row = this.characters.get(id);
      if (row && row.user_id === String(params[1])) {
        this.characters.delete(id);
        return { rows: [{ id } as unknown as T], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (upper.startsWith('SELECT') && upper.includes('FROM ACCOUNT_STATE')) {
      const row = this.accounts.get(Number(params[0]));
      if (!row) return { rows: [], rowCount: 0 };
      return { rows: [row as unknown as T], rowCount: 1 };
    }

    if (upper.startsWith('INSERT INTO ACCOUNT_STATE')) {
      this.writes += 1;
      const userId = Number(params[0]);
      const existing = this.accounts.get(userId);
      this.accounts.set(userId, {
        user_id: userId,
        diamonds: Number(params[1]),
        player_slot_count: existing?.player_slot_count ?? 1,
        highest_endless_level: existing?.highest_endless_level ?? 0,
        data: parseJson(params[2]) as Record<string, unknown>,
      });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`FakeDatabase: 未实现的 SQL → ${text}`);
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}
