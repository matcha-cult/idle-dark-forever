/**
 * 认证 HTTP 控制器
 *
 * - `POST /api/auth/register`
 * - `POST /api/auth/login`
 *
 * `@Public()`：注册/登录是拿到 token 的唯一入口，不能要求 JWT。
 * 返回协议 `ActionResult<LoginResponseDto>`（`{success, message?, data:{token,expiresAt,userId,displayName}}`），
 * 与 WS Action 同形，前端只需一套两级错误判定（AGENTS.md §5.1）。
 */
import { Body, Controller, Post } from '@nestjs/common';
import { type ActionResult, type LoginResponseDto } from '@idle-dark/protocol';
import { Public } from '../../common/decorators/public.decorator.js';
import { AuthService } from './auth.service.js';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: unknown): Promise<ActionResult<LoginResponseDto>> {
    const { username, password } = readCredentials(body);
    return this.authService.register(username, password);
  }

  @Post('login')
  async login(@Body() body: unknown): Promise<ActionResult<LoginResponseDto>> {
    const { username, password } = readCredentials(body);
    return this.authService.login(username, password);
  }
}

/**
 * 防御式读取凭据：不用 class-validator / ValidationPipe（本工程未引入），
 * 与 WS Action 的 `dataOf()` 口径保持一致（非法输入 → 空串，由 Service 统一校验并返回业务码）。
 */
function readCredentials(body: unknown): { username: string; password: string } {
  const source =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  return {
    username: typeof source['username'] === 'string' ? source['username'] : '',
    password: typeof source['password'] === 'string' ? source['password'] : '',
  };
}
