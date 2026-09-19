/** 职业域模块（cmd 段 career）。 */
import { Module } from '@nestjs/common';
import { CareerAction } from './career.action.js';
import { CareerLogicService } from './career.logic.service.js';

@Module({
  providers: [CareerLogicService, CareerAction],
  exports: [CareerLogicService, CareerAction],
})
export class CareerLogicModule {}
