/**
 * 世界域模块（cmd 30；battle 逻辑服的会话宿主）
 *
 * `@Global`：角色 HTTP 列表（`CharacterService.inBattle`）与其它域都需要世界运行时，
 * 而被登记的模块由 `app.module.ts` 统一导入一次即可全应用可见。
 *
 * `WorldService` 在 `onModuleInit` 注册 tick 推送合并器并启动受管心跳。
 *
 * **对外命令端口**：`BATTLE_COMMAND` 令牌以 `useExisting: WorldService` 绑定，
 * 供 map / dungeon / character 注入 —— 它们只依赖 `shared/battle-command.ts` 的契约，
 * 不再 import 本服的 `world.service.js`（C3）。
 */
import { Global, Module } from '@nestjs/common';
import { BATTLE_COMMAND } from '../shared/battle-command.js';
import { WorldAction } from './world.action.js';
import { WorldService } from './world.service.js';

@Global()
@Module({
  providers: [WorldService, WorldAction, { provide: BATTLE_COMMAND, useExisting: WorldService }],
  exports: [WorldService, WorldAction, BATTLE_COMMAND],
})
export class WorldLogicModule {}
