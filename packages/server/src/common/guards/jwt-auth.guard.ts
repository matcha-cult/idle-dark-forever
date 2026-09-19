/**
 * 全局 JWT 认证 Guard（HTTP 通道）
 *
 * 默认拦截所有 HTTP 路由；用 `@Public()` 标记公开接口（register / login / health）。
 *
 * WS 通道**不经过本 Guard**：WS 在握手阶段由 `IonetModule.forRoot` 的 `authenticate`
 * 完成鉴权（见 app.module.ts），之后整条连接绑定 userId。
 *
 * 说明：这里直接用纯函数 `verifyBearerHeader`，不注入 AuthService——
 * 保持 Guard 只依赖 Reflector（少一条 DI 边，避免 Auth ↔ Guard 的循环风险）。
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyBearerHeader } from '../auth/jwt.js';

export const IS_PUBLIC_KEY = 'idle-dark:isPublic';

/** Guard 解析后挂到请求对象上的最小形状（不引入 express 类型依赖）。 */
export interface AuthedRequest {
  userId?: number;
  headers: Record<string, string | string[] | undefined>;
}

const UNAUTHORIZED_MESSAGE = '登录状态无效，请重新登录';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const payload = verifyBearerHeader(request.headers?.['authorization']);
    if (!payload) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    request.userId = payload.id;
    return true;
  }
}
