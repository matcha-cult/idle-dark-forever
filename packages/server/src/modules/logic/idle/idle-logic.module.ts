/**
 * 离线结算模块（cmd 120）
 */
import { Module } from '@nestjs/common';
import { IdleAction } from './idle.action.js';
import { IdleService } from './idle-logic.service.js';

@Module({
  providers: [IdleService, IdleAction],
  exports: [IdleService, IdleAction],
})
export class IdleLogicModule {}
