/**
 * 游戏基础设施数据库服务（与用户系统**同一个库、同一个池**）
 *
 * 与 `DatabaseService` 的分工：
 * - `DatabaseService`：用户系统简单读写（query）；
 * - `GameDatabaseService`：在 query 之外提供**事务**能力，供后续游戏逻辑
 *   （角色创建 + 存档写入、结算 + 掉落等需要原子性的多步写入）使用。
 *
 * 复用 `DatabaseService` 的池（`connect()`）而不是自建第二个 `pg.Pool`，
 * 避免每进程双倍连接数；`onModuleDestroy` 由 `DatabaseService` 统一 end()。
 */
import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService, type QueryResult } from '../database/database.service.js';

/** 事务句柄：与 `DatabaseService.query` 同签名，业务代码可在事务内外复用同一写法。 */
export interface GameTx {
  query<T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

@Injectable()
export class GameDatabaseService {
  constructor(private readonly database: DatabaseService) {}

  async query<T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.database.query<T>(sql, params);
  }

  /** 事务包装：`fn` 内一律通过 `tx.query` 执行；任一步抛错则整体 ROLLBACK 后原样抛出。 */
  async withTransaction<T>(fn: (tx: GameTx) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    const tx: GameTx = {
      query: async <R extends QueryResultRow = Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ): Promise<QueryResult<R>> => {
        const result = await client.query<R>(sql, params as never[]);
        return { rows: result.rows, rowCount: result.rowCount };
      },
    };
    try {
      await client.query('BEGIN');
      const value = await fn(tx);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ROLLBACK 失败（连接已断）时吞掉，向上抛原始错误更有诊断价值
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
