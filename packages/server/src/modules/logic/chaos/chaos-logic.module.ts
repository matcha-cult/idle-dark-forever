/**
 * 混沌仪模块（cmd 140；W6）—— 归 `idle` 逻辑服（离线结算 + 混沌推进同源）。
 *
 * 依赖经 `@Global` 的 `LogicSharedModule`（`EVENT_BUS` / `PlayerContextService`）与
 * `WorldLogicModule`（`BATTLE_COMMAND`），不 import 其它服的 service。
 */
import { Module } from '@nestjs/common';
import { ChaosAction } from './chaos.action.js';
import { ChaosLogicService } from './chaos.logic.service.js';

@Module({
  providers: [ChaosLogicService, ChaosAction],
  exports: [ChaosLogicService, ChaosAction],
})
export class ChaosLogicModule {}
