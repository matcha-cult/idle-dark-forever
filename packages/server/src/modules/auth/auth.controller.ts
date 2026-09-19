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
import { Body, Controller, Get, Post } from '@nestjs/common';
import { type ActionResult, type LoginResponseDto, type MeDto } from '@idle-dark/protocol';
import { Public } from '../../common/decorators/public.decorator.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { AuthService } from './auth.service.js';

/**
 * ⚠️ `@Public()` 标在**方法**上而不是类上：类上标会让 `GET /auth/me` 也免鉴权，
 * 那样 `@UserId()` 取不到身份会抛错。注册/登录是唯一需要豁免 JWT 的两个入口。
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() body: unknown): Promise<ActionResult<LoginResponseDto>> {
    const { username, password } = readCredentials(body);
    return this.authService.register(username, password);
  }

  @Public()
  @Post('login')
  async login(@Body() body: unknown): Promise<ActionResult<LoginResponseDto>> {
    const { username, password } = readCredentials(body);
    return this.authService.login(username, password);
  }

  /**
   * 账号级信息（`ActionResult<MeDto>`）。
   *
   * 前端 `RestClient.me()` 打的就是这条；虽当前 UI 走 WS 的 `AUTH_CMD.me`，
   * 但 REST 面缺这条会让「带 REST 兜底的客户端」拿到 404。
   */
  @Get('me')
  async me(@UserId() userId: number): Promise<ActionResult<MeDto>> {
    return this.authService.me(userId);
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
