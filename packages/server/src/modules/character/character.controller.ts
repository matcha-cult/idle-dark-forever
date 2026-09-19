/**
 * 角色 HTTP 控制器（受全局 JwtAuthGuard 保护）
 *
 * - `GET  /api/characters`  角色列表
 * - `POST /api/characters`  创建角色（写入 `state = {}` 占位）
 *
 * 返回协议 `ActionResult<T>`。Body 采用防御式读取（不用 class-validator）。
 */
import { Body, Controller, Get, Post } from '@nestjs/common';
import { type ActionResult, type PlayerMetaDto } from '@idle-dark/protocol';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { CharacterService, type CreateCharacterInput } from './character.service.js';

@Controller('characters')
export class CharacterController {
  constructor(private readonly characterService: CharacterService) {}

  @Get()
  async list(@UserId() userId: number): Promise<ActionResult<PlayerMetaDto[]>> {
    return this.characterService.list(userId);
  }

  @Post()
  async create(
    @UserId() userId: number,
    @Body() body: unknown,
  ): Promise<ActionResult<PlayerMetaDto>> {
    return this.characterService.create(userId, readCreateInput(body));
  }
}

function readCreateInput(body: unknown): CreateCharacterInput {
  const source =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const input: CreateCharacterInput = {
    name: typeof source['name'] === 'string' ? source['name'] : '',
  };
  if (typeof source['role'] === 'string') input.role = source['role'];
  if (typeof source['career'] === 'string') input.career = source['career'];
  return input;
}
