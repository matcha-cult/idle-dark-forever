/**
 * 认证模块
 *
 * 提供并导出 `AuthService` + `AuthAction`。
 * `AuthService` 必须导出：`JwtAuthGuard` 虽已改为纯函数校验、不再注入它，
 * 但后续域（角色创建归属、账号级资源）与 WS `AuthAction` 都需要，
 * 且 `APP_GUARD` 由 AppModule 注册、跨模块解析更稳。
 */
import { Module } from '@nestjs/common';
import { AuthAction } from './auth.action.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthAction],
  exports: [AuthService, AuthAction],
})
export class AuthModule {}
