/**
 * 游戏基础设施模块（@Global）
 *
 * 只放**与业务域无关**的横切能力：
 * - `GameDatabaseService`：事务化数据库访问（复用 DatabaseService 的池）
 * - `RateLimiterService`：自建限流（框架 `RateLimitInOut` 无法短路，见该文件注释）
 *
 * 后续每个游戏域应新建自己的 `<domain>-logic.module.ts` 并在
 * `ionet/game-actions.ts` 登记，而不是往本模块里塞业务。
 */
import { Global, Module } from '@nestjs/common';
import { RateLimiterService } from '../../common/services/rate-limiter.service.js';
import { GameDatabaseService } from './game-database.service.js';

@Global()
@Module({
  providers: [GameDatabaseService, RateLimiterService],
  exports: [GameDatabaseService, RateLimiterService],
})
export class GameModule {}
