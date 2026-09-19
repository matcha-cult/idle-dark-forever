/**
 * 指标模块（07 T-A1）：`GET /api/metrics`。
 *
 * `WorldService` / `PlayerContextService` / `GAME_CLOCK` 均来自 `@Global` 的
 * `WorldLogicModule` / `LogicSharedModule`，本模块不额外 import。
 */
import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
