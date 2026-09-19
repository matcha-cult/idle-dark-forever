/**
 * 健康 / 系统模块
 *
 * - `HealthAction`：WS `system.ping`（免鉴权 / 心跳 / 在线 touch）+ `system.version`
 * - `HealthController`：`GET /api/health`（免 JWT）
 * - `HealthService`：DB 可用性探测
 */
import { Module } from '@nestjs/common';
import { HealthAction } from './health.action.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  controllers: [HealthController],
  providers: [HealthService, HealthAction],
  exports: [HealthAction],
})
export class HealthModule {}
