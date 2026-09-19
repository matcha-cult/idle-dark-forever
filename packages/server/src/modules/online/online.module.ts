/**
 * 在线会话模块（@Global）
 *
 * `system.ping`（健康 Action）与后续战斗/挂机 tick 都要用；它不依赖任何业务域，
 * 因此不构成跨逻辑服依赖，做成全局模块。
 * 无构造选项 provider：TTL 用默认值，测试可 `new OnlineSessionService(null)` 后改 `now`。
 */
import { Global, Module } from '@nestjs/common';
import { OnlineSessionService } from './online-session.service.js';

@Global()
@Module({
  providers: [OnlineSessionService],
  exports: [OnlineSessionService],
})
export class OnlineModule {}
