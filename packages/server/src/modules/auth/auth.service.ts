/**
 * 认证服务（REST + WS 共用）
 *
 * 范围：注册 / 登录 / 读取当前账号（me）。
 * - 密码散列：bcryptjs（salt rounds 10）
 * - token：HS256 JWT（见 common/auth/jwt.ts，与 WS 握手校验共用同一密钥/语义）
 * - 返回：协议 `ActionResult<T>`（与 WS Action 同形，HTTP 侧也走两级错误判定）
 *
 * 表（见 scripts/init-db.mjs）：
 *   users(id bigserial, username text unique, password_hash text, display_name text, created_at)
 *   account_state(user_id bigint pk, diamonds int, player_slot_count int,
 *                 player_slot_count int, data jsonb, updated_at)
 */
import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import {
  type ActionResult,
  BusinessErrorCode,
  type LoginResponseDto,
  type MeDto,
  fail,
  ok,
} from '@idle-dark/protocol';
import { jwtExpiresAt, signJwt } from '../../common/auth/jwt.js';
import { bigintToSafeNumber } from '../../common/utils/safe-bigint.js';
import { DatabaseService } from '../database/database.service.js';

const SALT_ROUNDS = 10;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;
const PASSWORD_MIN_LENGTH = 6;

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  /** 注册：创建 users 行 + account_state 默认行，签发 token。 */
  async register(username: string, password: string): Promise<ActionResult<LoginResponseDto>> {
    const name = username.trim();
    if (name.length < USERNAME_MIN_LENGTH || name.length > USERNAME_MAX_LENGTH) {
      return fail(
        BusinessErrorCode.INVALID_PARAM,
        `用户名长度需在 ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} 个字符之间`,
      );
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      return fail(BusinessErrorCode.INVALID_PARAM, `密码至少 ${PASSWORD_MIN_LENGTH} 个字符`);
    }

    const existing = await this.database.query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1',
      [name],
    );
    if (existing.rows.length > 0) {
      return fail(BusinessErrorCode.INVALID_PARAM, '用户名已被占用');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const inserted = await this.database.query<UserRow>(
      `INSERT INTO users (username, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, username, password_hash, display_name`,
      [name, passwordHash, name],
    );
    const row = inserted.rows[0];
    if (!row) {
      return fail(BusinessErrorCode.INTERNAL, '注册失败，请稍后再试');
    }

    const userId = bigintToSafeNumber(row.id, 'users.id');
    await this.database.query(
      'INSERT INTO account_state (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
      [userId],
    );

    return ok(this.issueToken(userId, row.username, row.display_name));
  }

  /** 登录：校验密码，签发 token。 */
  async login(username: string, password: string): Promise<ActionResult<LoginResponseDto>> {
    const name = username.trim();
    if (!name || !password) {
      return fail(BusinessErrorCode.INVALID_PARAM, '用户名和密码不能为空');
    }

    const found = await this.database.query<UserRow>(
      'SELECT id, username, password_hash, display_name FROM users WHERE username = $1',
      [name],
    );
    const row = found.rows[0];
    // 用户不存在与密码错误返回同一文案，避免账号枚举
    if (!row) {
      return fail(BusinessErrorCode.UNAUTHORIZED, '用户名或密码错误');
    }
    const matched = await bcrypt.compare(password, row.password_hash);
    if (!matched) {
      return fail(BusinessErrorCode.UNAUTHORIZED, '用户名或密码错误');
    }

    const userId = bigintToSafeNumber(row.id, 'users.id');
    return ok(this.issueToken(userId, row.username, row.display_name));
  }

  /** 当前账号信息（REST 与 WS `auth.me` 共用）。 */
  async me(userId: number): Promise<ActionResult<MeDto>> {
    const found = await this.database.query<{
      id: string;
      display_name: string;
      diamonds: number | null;
      player_slot_count: number | null;
    }>(
      `SELECT u.id, u.display_name,
              s.diamonds, s.player_slot_count
         FROM users u
         LEFT JOIN account_state s ON s.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    );
    const row = found.rows[0];
    if (!row) {
      return fail(BusinessErrorCode.PLAYER_NOT_FOUND, '账号不存在');
    }
    return ok({
      userId: String(bigintToSafeNumber(row.id, 'users.id')),
      displayName: row.display_name,
      diamonds: row.diamonds ?? 0,
      playerSlotCount: row.player_slot_count ?? 1,
    });
  }

  private issueToken(userId: number, username: string, displayName: string): LoginResponseDto {
    const token = signJwt({ id: userId, username });
    return {
      token,
      expiresAt: jwtExpiresAt(token),
      userId: String(userId),
      displayName,
    };
  }
}
