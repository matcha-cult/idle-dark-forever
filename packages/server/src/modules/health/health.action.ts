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
import { PROTOCOL_VERSION, SYSTEM_CMD, WS_PATH } from '../../ionet/cmd.js';
import { userIdOf } from '../../ionet/action-support.js';
import { OnlineSessionService } from '../online/online-session.service.js';

export interface PingResult {
  status: 'ok';
  service: string;
  timestamp: number;
}

export interface VersionResult {
  version: number;
  wsPath: string;
  serverTime: number;
}

@Injectable()
@ActionController(SYSTEM_CMD.cmd)
export class HealthAction {
  constructor(private readonly onlineSessions: OnlineSessionService) {}

  @ActionMethod(SYSTEM_CMD.ping)
  ping(ctx: FlowContext): PingResult {
    const userId = userIdOf(ctx);
    if (userId !== null) this.onlineSessions.touch(userId);
    return { status: 'ok', service: 'idle-dark-forever', timestamp: Date.now() };
  }

  @ActionMethod(SYSTEM_CMD.version)
  version(): VersionResult {
    return { version: PROTOCOL_VERSION, wsPath: WS_PATH, serverTime: Date.now() };
  }
}
