/** 拾取规则域模块（cmd 段 lootrule）。 */
import { Module } from '@nestjs/common';
import { LootRuleAction } from './lootrule.action.js';
import { LootRuleLogicService } from './lootrule.logic.service.js';

@Module({
  providers: [LootRuleLogicService, LootRuleAction],
  exports: [LootRuleLogicService, LootRuleAction],
})
export class LootRuleLogicModule {}
