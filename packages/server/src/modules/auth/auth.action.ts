/**
 * 认证 Action（WS 通道，cmd 段 auth）
 *
 * - `auth.login`   免鉴权白名单成员（PUBLIC_ACTION_KEYS），但**握手鉴权要求连接本身带 token**，
 *                  因此实际入口是 REST 登录；本 Action 保留以对齐协议段位规划。
 * - `auth.logout`  需鉴权；清掉内存在线登记（WS 连接本身由客户端关闭）。
 * - `auth.me`      需鉴权；返回账号级信息 `MeDto`。
 *
 * ⚠️ `FlowContext` 值导入（鉴权可见性前提，见文件头注释）。
 */
import { Injectable } from '@nestjs/common';
import { ActionController, ActionMethod, FlowContext } from '@nbb-ionet/core-framework';
import { type ActionResult, AUTH_CMD, type LoginResponseDto, type MeDto, ok } from '@idle-dark/protocol';
import { ActionError, dataOf, requireUserId, toNonEmptyString } from '../../ionet/action-support.js';
import { guardAction } from '../../common/kernel/result.js';
import { OnlineSessionService } from '../online/online-session.service.js';
import { AuthService } from './auth.service.js';

@Injectable()
@ActionController(AUTH_CMD.cmd)
export class AuthAction {
  constructor(
    private readonly authService: AuthService,
    private readonly onlineSessions: OnlineSessionService,
  ) {}

  @ActionMethod(AUTH_CMD.login)
  async login(data: unknown): Promise<ActionResult<LoginResponseDto>> {
    const body = dataOf(data);
    const username = toNonEmptyString(body['username']);
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    if (!username || !password) {
      return ActionError.invalidParam('用户名和密码不能为空');
    }
    return this.authService.login(username, password);
  }

  @ActionMethod(AUTH_CMD.logout)
  logout(ctx: FlowContext): ActionResult<{ ok: true }> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    this.onlineSessions.forget(userId);
    return ok({ ok: true } as const);
  }

  @ActionMethod(AUTH_CMD.me)
  async me(ctx: FlowContext): Promise<ActionResult<MeDto>> {
    const userId = requireUserId(ctx);
    if (typeof userId !== 'number') return userId;
    return this.authService.me(userId);
  }
}
