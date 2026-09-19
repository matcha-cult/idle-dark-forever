/**
 * 战斗域模块（cmd 40）
 *
 * 依赖 `WorldLogicModule` 取得世界运行时（切换目标需要活着的单位表）。
 */
import { Module } from '@nestjs/common';
import { WorldLogicModule } from '../world/world-logic.module.js';
import { BattleAction } from './battle.action.js';

@Module({
  imports: [WorldLogicModule],
  providers: [BattleAction],
  exports: [BattleAction],
})
export class BattleLogicModule {}
