/**
 * 世界域模块（cmd 30）
 *
 * `@Global`：角色 HTTP 列表（`CharacterService.inBattle`）与其它域都需要世界运行时，
 * 而被登记的模块由 `app.module.ts` 统一导入一次即可全应用可见。
 *
 * `WorldService` 在 `onModuleInit` 注册 tick 推送合并器并启动受管心跳。
 */
import { Global, Module } from '@nestjs/common';
import { WorldAction } from './world.action.js';
import { WorldService } from './world.service.js';

@Global()
@Module({
  providers: [WorldService, WorldAction],
  exports: [WorldService, WorldAction],
})
export class WorldLogicModule {}
