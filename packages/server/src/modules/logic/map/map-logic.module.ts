/** 地图（开放世界）控制器模块（cmd 130；09 R2）。 */
import { Module } from '@nestjs/common';
import { MapAction } from './map.action.js';
import { MapLogicService } from './map.logic.service.js';

@Module({
  providers: [MapLogicService, MapAction],
  exports: [MapLogicService, MapAction],
})
export class MapLogicModule {}
