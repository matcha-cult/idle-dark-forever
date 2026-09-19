/** 神力商店域模块（cmd 段 shop）。 */
import { Module } from '@nestjs/common';
import { ShopAction } from './shop.action.js';
import { ShopLogicService } from './shop.logic.service.js';

@Module({
  providers: [ShopLogicService, ShopAction],
  exports: [ShopLogicService, ShopAction],
})
export class ShopLogicModule {}
