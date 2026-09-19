/**
 * 健康检测服务：探测 PostgreSQL 可用性（本工程不接 Redis）。
 *
 * - 单检 2s 超时，保证容器探针快速失败；
 * - 返回 `status: 'ok' | 'degraded'`（Controller 据此决定 200 / 503）。
 */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

const CHECK_TIMEOUT_MS = 2_000;

export interface CheckResult {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
  checks: { database: CheckResult };
}

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`check timeout after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async checkDatabase(): Promise<CheckResult> {
    const started = Date.now();
    try {
      await this.withTimeout(this.database.query('SELECT 1'), CHECK_TIMEOUT_MS);
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async overall(): Promise<HealthReport> {
    const database = await this.checkDatabase();
    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      service: 'idle-dark-forever',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks: { database },
    };
  }
}
