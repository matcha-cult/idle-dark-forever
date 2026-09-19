/**
 * 世界域模块（cmd 30）
 *
 * 提供并导出 `WorldService` / `WorldAction`。`WorldService` 在 `onModuleInit`
 * 注册 tick 推送合并器并启动受管心跳。
 */
import { Module } from '@nestjs/common';
import { WorldAction } from './world.action.js';
import { WorldService } from './world.service.js';

@Module({
  providers: [WorldService, WorldAction],
  exports: [WorldService, WorldAction],
})
export class WorldLogicModule {}
