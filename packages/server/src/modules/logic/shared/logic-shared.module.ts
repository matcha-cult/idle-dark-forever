/**
 * 逻辑域共享模块（`@Global`）
 *
 * 提供 Wave 2 各域都要用的横切件：
 * - `DATA_TABLES`：`createDefaultTables()` 的**单例**（数据表内含函数与活动注册顺序，
 *   必须全局唯一，否则 `registerYear2018` 会重复追加红包掉落）；
 * - `GAME_CLOCK`：注入的毫秒时间源（组合根唯一允许出现 `Date.now()` 的地方）；
 * - `PlayerContextService`：DB ↔ game-core 的胶水层；
 * - `EVENT_BUS`：跨服事件总线（08 §2.3 解环；进程内实现，接口面向未来跨进程）。
 *
 * 依赖只指向基础设施（`GameModule` 已 `@Global`），不依赖任何业务域。
 */
import { Global, Module } from '@nestjs/common';
import { createDefaultTables } from '@idle-dark/game-core';
import { DATA_TABLES, GAME_CLOCK, type NowSource } from './game-clock.js';
import { PlayerContextService } from './player-context.service.js';
import { EVENT_BUS } from './events.js';
import { InProcessEventBus } from './event-bus.js';

@Global()
@Module({
  providers: [
    { provide: DATA_TABLES, useFactory: () => createDefaultTables() },
    // 组合根：唯一允许出现裸 Date.now() 的地方（业务逻辑一律注入本令牌）。
    { provide: GAME_CLOCK, useFactory: (): NowSource => () => Date.now() },
    PlayerContextService,
    // 跨服事件总线：进程内同步派发，保持解环前的调用时序。
    { provide: EVENT_BUS, useClass: InProcessEventBus },
  ],
  exports: [DATA_TABLES, GAME_CLOCK, PlayerContextService, EVENT_BUS],
})
export class LogicSharedModule {}
