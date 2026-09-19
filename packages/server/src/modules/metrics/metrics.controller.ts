/**
 * 指标 HTTP 控制器：`GET /api/metrics`（免 JWT，仅计数/比值，无玩家数据）。
 */
import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { MetricsService, type MetricsSnapshot } from './metrics.service.js';

@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  get(): MetricsSnapshot {
    return this.metrics.snapshot();
  }
}
