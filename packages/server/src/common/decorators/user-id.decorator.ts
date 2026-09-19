import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 请求对象上由 JwtAuthGuard 写入的最小形状（不引入 express 类型依赖）。 */
export interface UserIdRequest {
  userId?: number;
}

/** 从已解析的请求对象取 userId；缺失 / 非法 → 抛错（受保护路由不应出现该情况）。 */
export function extractUserId(request: UserIdRequest | undefined): number {
  const userId = request?.userId;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('缺少用户身份');
  }
  return userId;
}

/** 从请求上下文读取 JWT 解析出的用户 ID（全局 Guard 已写入）。 */
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): number =>
  extractUserId(ctx.switchToHttp().getRequest<UserIdRequest>()),
);
