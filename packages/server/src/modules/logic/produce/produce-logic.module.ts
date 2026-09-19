/** 生产域模块（cmd 段 produce）。 */
import { Module } from '@nestjs/common';
import { ProduceAction } from './produce.action.js';
import { ProduceLogicService } from './produce.logic.service.js';

@Module({
  providers: [ProduceLogicService, ProduceAction],
  exports: [ProduceLogicService, ProduceAction],
})
export class ProduceLogicModule {}
