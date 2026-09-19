/**
 * 对外服模块（Edge，@Global）
 *
 * - 提供 `NotificationPort` 实现，供任意业务域经端口投递广播 / 推送；
 * - `useExisting` 保证 `NOTIFICATION_PORT` 与 `EdgeService` 是**同一个实例**
 *   （而不是两个各自持状态的副本）；
 * - 只注入 ionet 的 WS 外部服务，不依赖任何业务模块。
 */
import { Global, Module } from '@nestjs/common';
import { NOTIFICATION_PORT } from '../../common/ports/notification.port.js';
import { EdgeService } from './edge.service.js';

@Global()
@Module({
  providers: [EdgeService, { provide: NOTIFICATION_PORT, useExisting: EdgeService }],
  exports: [NOTIFICATION_PORT, EdgeService],
})
export class EdgeModule {}
