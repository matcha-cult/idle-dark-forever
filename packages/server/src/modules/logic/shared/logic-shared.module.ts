/**
 * 逻辑域共享模块（`@Global`）
 *
 * 提供 Wave 2 各域都要用的横切件：
 * - `DATA_TABLES`：`createDefaultTables()` 的**单例**（数据表内含函数与活动注册顺序，
 *   必须全局唯一，否则 `registerYear2018` 会重复追加红包掉落）；
 * - `GAME_CLOCK`：注入的毫秒时间源（组合根唯一允许出现 `Date.now()` 的地方）；
 * - `PlayerContextService`：DB ↔ game-core 的胶水层。
 *
 * 依赖只指向基础设施（`GameModule` 已 `@Global`），不依赖任何业务域。
 */
import { Global, Module } from '@nestjs/common';
import { createDefaultTables } from '@idle-dark/game-core';
import { DATA_TABLES, GAME_CLOCK, type NowSource } from './game-clock.js';
import { PlayerContextService } from './player-context.service.js';

@Global()
@Module({
  providers: [
    { provide: DATA_TABLES, useFactory: () => createDefaultTables() },
    // 组合根：唯一允许出现裸 Date.now() 的地方（业务逻辑一律注入本令牌）。
    { provide: GAME_CLOCK, useFactory: (): NowSource => () => Date.now() },
    PlayerContextService,
  ],
  exports: [DATA_TABLES, GAME_CLOCK, PlayerContextService],
})
export class LogicSharedModule {}
