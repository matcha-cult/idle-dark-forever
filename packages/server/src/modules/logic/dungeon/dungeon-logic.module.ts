/**
 * 秘境 / 挑战队列控制器模块（cmd 140；09 R3/R4）。
 *
 * `MapLogicService` 用于队列耗尽/非秘境条目 → `map.ContinueOpenWorld`（RD3/RD4），
 * 因此显式 import `MapLogicModule`（它非 `@Global`）。
 */
import { Module } from '@nestjs/common';
import { MapLogicModule } from '../map/map-logic.module.js';
import { DungeonAction } from './dungeon.action.js';
import { DungeonLogicService } from './dungeon.logic.service.js';

@Module({
  imports: [MapLogicModule],
  providers: [DungeonLogicService, DungeonAction],
  exports: [DungeonLogicService, DungeonAction],
})
export class DungeonLogicModule {}
