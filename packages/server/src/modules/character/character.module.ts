/**
 * 角色模块
 *
 * 本次只暴露 HTTP 最小面（列表 / 创建占位）。
 * 后续任务把角色域 WS Action 放进 `modules/logic/player/` 并在
 * `ionet/game-actions.ts` 登记，本模块继续承载表访问 / 查询门面。
 */
import { Module } from '@nestjs/common';
import { CharacterController } from './character.controller.js';
import { CharacterService } from './character.service.js';

@Module({
  controllers: [CharacterController],
  providers: [CharacterService],
  exports: [CharacterService],
})
export class CharacterModule {}
