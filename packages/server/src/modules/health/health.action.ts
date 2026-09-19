/**
 * 系统 / 健康 Action（cmd 段 system）
 *
 * - `system.ping`：免鉴权（PUBLIC_ACTION_KEYS），用于 WS 冒烟与**应用层心跳**；
 *   同时充当在线会话的 touch 源（未鉴权连接 userId=0n，userIdOf 返回 null → 不登记）。
 * - `system.version`：免鉴权，返回 `PROTOCOL_VERSION`，客户端据此提示刷新。
 *
 * 作为容器 provider 由 HealthModule 提供；框架在 onModuleInit 经 resolveAction 解析实例，
 * 因此具备 DI（这里注入 @Global 的 OnlineSessionService）。
 *
 * ⚠️ `FlowContext` 必须**值导入**：`import type` 会被 tsc 擦除，`design:paramtypes`
 *    退化为 Function，框架把首参当 DATA → 鉴权静默失效。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import { ok, type ActionResult, type SystemPingDto, type SystemVersionDto } from '@idle-dark/protocol';
import { PROTOCOL_VERSION, SYSTEM_CMD, WS_PATH } from '../../ionet/cmd.js';
import { userIdOf } from '../../ionet/action-support.js';
import { OnlineSessionService } from '../online/online-session.service.js';

/**
 * ⚠️ 这两个 Action 必须遵循**全项目统一约定** `ActionResult<T>`：
 * 响应信封的 `data` 形如 `{ success: true, data: <DTO> }`，而非裸 DTO。
 * 客户端的 typed API（`SystemApi.ping/version`）按该约定声明，裸 DTO 会让
 * `result.success` 恒为 `undefined`，两级错误判定把它当成业务失败。
 *
 * ⚠️ 字段名 `serverTime` 也是硬契约：客户端 `extractServerTime()` 只识别
 * `serverTime` / `serverTimeMs`（含 `data.*` 嵌套），用于计算与服务端的时钟偏移；
 * 若改用 `timestamp` 等别名，时钟对齐会**静默失效**。
 */
@Injectable()
@ActionController(SYSTEM_CMD.cmd)
export class HealthAction {
  constructor(private readonly onlineSessions: OnlineSessionService) {}

  @ActionMethod(SYSTEM_CMD.ping)
  ping(ctx: FlowContext): ActionResult<SystemPingDto> {
    const userId = userIdOf(ctx);
    if (userId !== null) this.onlineSessions.touch(userId);
    return ok<SystemPingDto>({
      status: 'ok',
      service: 'idle-dark-forever',
      serverTime: Date.now(),
    });
  }

  @ActionMethod(SYSTEM_CMD.version)
  version(): ActionResult<SystemVersionDto> {
    return ok<SystemVersionDto>({
      serverVersion: process.env['npm_package_version'] ?? '0.1.0',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: Date.now(),
      wsPath: WS_PATH,
    });
  }
}
