/**
 * 数据库服务（用户系统库：users / account_state / characters）
 *
 * - 基于 `pg.Pool` 的轻量 `query()`；**不使用任何 ORM**。
 * - 连接串取自 `DATABASE_URL`；缺失时回落到 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME
 *   拼装（与参考实现一致，便于本地一条 `DATABASE_URL` 起库）。
 * - `connect()` 暴露池连接，供需要事务（BEGIN/COMMIT/ROLLBACK）的上层使用
 *   —— 见 `modules/game/game-database.service.ts`，全进程只维护一个池。
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

const { Pool } = pg;

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

/** 由分散的 DB_* 变量拼装连接串（仅在 DATABASE_URL 缺失时使用）。 */
export function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== '') {
    return process.env.DATABASE_URL;
  }
  const user = process.env.DB_USER ?? 'postgres';
  const password = process.env.DB_PASSWORD ?? 'postgres';
  const host = process.env.DB_HOST ?? 'localhost';
  const port = process.env.DB_PORT ?? '5432';
  const name = process.env.DB_NAME ?? 'idle_dark';
  return `postgresql://${user}:${password}@${host}:${port}/${name}`;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor() {
    this.pool = new Pool({ connectionString: resolveDatabaseUrl() });
  }

  async query<T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.pool.query<T>(sql, params as never[]);
    return { rows: result.rows, rowCount: result.rowCount };
  }

  /** 取一个池连接（调用方负责 `release()`；事务见 GameDatabaseService）。 */
  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
