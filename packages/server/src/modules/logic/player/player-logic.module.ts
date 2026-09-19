/**
 * 角色域模块（cmd 20）
 *
 * 依赖：
 * - `CharacterModule`：角色表的持久化门面（HTTP 与 WS 共用同一份实现）；
 * - `WorldLogicModule`（`@Global`）：`player.select` 需要启动世界推进。
 *
 * `PlayerContextService` / `DATA_TABLES` / `GAME_CLOCK` 来自 `@Global` 的 `LogicSharedModule`。
 */
import { Module } from '@nestjs/common';
import { CharacterModule } from '../../character/character.module.js';
import { PlayerAction } from './player.action.js';
import { PlayerLogicService } from './player-logic.service.js';

@Module({
  imports: [CharacterModule],
  providers: [PlayerLogicService, PlayerAction],
  exports: [PlayerLogicService, PlayerAction],
})
export class PlayerLogicModule {}
