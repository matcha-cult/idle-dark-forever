/**
 * 健康检测 HTTP 控制器
 *
 * - `GET /api/health`，`@Public()` 免 JWT（容器监控 / 探针）；
 * - DB 可用 → 200；DB 不可用 → 503（`degraded`）。
 *
 * 这里用结构化的 `res`（而不是 `import type { Response } from 'express'`）：
 * 本工程未安装 `@types/express`，且只需要 `status()` 一个能力。
 */
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { HealthService, type HealthReport } from './health.service.js';

interface StatusWritable {
  status(code: number): unknown;
}

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: StatusWritable): Promise<HealthReport> {
    const report = await this.healthService.overall();
    res.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
