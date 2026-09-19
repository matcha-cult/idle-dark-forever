/** 秘境 / 挑战队列控制器模块（cmd 140；09 R3）。 */
import { Module } from '@nestjs/common';
import { DungeonAction } from './dungeon.action.js';
import { DungeonLogicService } from './dungeon.logic.service.js';

@Module({
  providers: [DungeonLogicService, DungeonAction],
  exports: [DungeonLogicService, DungeonAction],
})
export class DungeonLogicModule {}
