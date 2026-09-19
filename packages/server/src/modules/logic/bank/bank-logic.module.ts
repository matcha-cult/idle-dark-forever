/** 储藏箱域模块（cmd 段 bank）。 */
import { Module } from '@nestjs/common';
import { BankAction } from './bank.action.js';
import { BankLogicService } from './bank.logic.service.js';

@Module({
  providers: [BankLogicService, BankAction],
  exports: [BankLogicService, BankAction],
})
export class BankLogicModule {}
