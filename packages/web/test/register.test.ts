/**
 * 注册（登录页新增能力）的边界测试。
 *
 * 覆盖三层：
 * 1. `validateAuthForm` 纯校验（不需要 DOM / 网络）
 * 2. `RestClient.register` 打到正确的端点、且业务失败不抛
 * 3. `SessionStore.register` 的状态机、token 落盘、换账号清理、异常兜底
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AUTH_LIMITS,
  AUTH_MESSAGES,
  AUTH_MODE_LOGIN,
  AUTH_MODE_REGISTER,
  normalizeUsername,
  validateAuthForm,
} from '../src/pages/login/auth-form.js';
import { RestClient } from '../src/services/game-client.js';
import { createMemoryStorage } from '../src/services/storage.js';
import { ME_STORAGE_KEY, SessionStore, TOKEN_STORAGE_KEY } from '../src/stores/session-store.js';
import { ToastStore } from '../src/stores/toast-store.js';

// ─────────────────────────── 1. 纯校验 ───────────────────────────

describe('validateAuthForm', () => {
  const okValues = { username: 'nightwalker', password: 'secret123', confirm: 'secret123' };

  it('合法输入返回 null', () => {
    expect(validateAuthForm(AUTH_MODE_LOGIN, okValues)).toBeNull();
    expect(validateAuthForm(AUTH_MODE_REGISTER, okValues)).toBeNull();
  });

  it('账号长度边界：刚好 3 / 32 合法，2 / 33 非法', () => {
    const withUser = (u: string) => ({ ...okValues, username: u });
    expect(validateAuthForm(AUTH_MODE_LOGIN, withUser('abc'))).toBeNull();
    expect(validateAuthForm(AUTH_MODE_LOGIN, withUser('a'.repeat(32)))).toBeNull();
    expect(validateAuthForm(AUTH_MODE_LOGIN, withUser('ab'))).toBe(AUTH_MESSAGES.username);
    expect(validateAuthForm(AUTH_MODE_LOGIN, withUser('a'.repeat(33)))).toBe(AUTH_MESSAGES.username);
  });

  it('账号长度按**归一化后**算：全空白 / 带空白导致不足 3 字符都要拦', () => {
    expect(validateAuthForm(AUTH_MODE_LOGIN, { ...okValues, username: '   ' })).toBe(AUTH_MESSAGES.username);
    expect(validateAuthForm(AUTH_MODE_LOGIN, { ...okValues, username: '  ab  ' })).toBe(AUTH_MESSAGES.username);
    expect(validateAuthForm(AUTH_MODE_LOGIN, { ...okValues, username: '  abc  ' })).toBeNull();
  });

  it('账号缺失（undefined / null 语义）→ 长度校验失败', () => {
    expect(validateAuthForm(AUTH_MODE_LOGIN, { password: 'secret123' })).toBe(AUTH_MESSAGES.username);
    expect(validateAuthForm(AUTH_MODE_LOGIN, { username: undefined })).toBe(AUTH_MESSAGES.username);
  });

  it('口令长度边界：刚好 6 合法，5 非法；口令**不 trim**（空格算字符）', () => {
    expect(validateAuthForm(AUTH_MODE_LOGIN, { ...okValues, password: 'abcdef' })).toBeNull();
    expect(validateAuthForm(AUTH_MODE_LOGIN, { ...okValues, password: 'abcde' })).toBe(AUTH_MESSAGES.password);
    expect(validateAuthForm(AUTH_MODE_LOGIN, { ...okValues, password: '' })).toBe(AUTH_MESSAGES.password);
    expect(validateAuthForm(AUTH_MODE_LOGIN, { ...okValues, password: '  a  b' })).toBeNull();
  });

  it('登录模式忽略 confirm（不校验一致性）', () => {
    expect(validateAuthForm(AUTH_MODE_LOGIN, { ...okValues, confirm: '不一样' })).toBeNull();
    expect(validateAuthForm(AUTH_MODE_LOGIN, { username: 'abc', password: 'secret123' })).toBeNull();
  });

  it('注册模式：confirm 缺失 → 提示再次输入；不一致 → 提示不一致', () => {
    expect(validateAuthForm(AUTH_MODE_REGISTER, { ...okValues, confirm: undefined })).toBe(
      AUTH_MESSAGES.confirmRequired,
    );
    expect(validateAuthForm(AUTH_MODE_REGISTER, { ...okValues, confirm: '' })).toBe(
      AUTH_MESSAGES.confirmRequired,
    );
    expect(validateAuthForm(AUTH_MODE_REGISTER, { ...okValues, confirm: 'secret124' })).toBe(
      AUTH_MESSAGES.confirm,
    );
  });

  it('注册模式 confirm 也不 trim（与 password 的收紧保持一致）', () => {
    expect(validateAuthForm(AUTH_MODE_REGISTER, { ...okValues, confirm: ' secret123 ' })).toBe(
      AUTH_MESSAGES.confirm,
    );
  });

  it('校验顺序：账号 → 口令 → confirm（保证提示的是第一处错误）', () => {
    expect(
      validateAuthForm(AUTH_MODE_REGISTER, { username: 'ab', password: 'x', confirm: 'y' }),
    ).toBe(AUTH_MESSAGES.username);
    expect(validateAuthForm(AUTH_MODE_REGISTER, { username: 'abc', password: 'x', confirm: 'y' })).toBe(
      AUTH_MESSAGES.password,
    );
  });

  it('normalizeUsername 处理 undefined / 空白', () => {
    expect(normalizeUsername(undefined)).toBe('');
    expect(normalizeUsername('  a b  ')).toBe('a b');
    expect(normalizeUsername('')).toBe('');
  });
});

// ─────────────────────────── 2. RestClient ───────────────────────────

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

function makeRest(response: { status?: number; body: unknown }): { rest: RestClient; captured: Captured[] } {
  const captured: Captured[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    captured.push({
      url: String(input),
      method: String(init?.method ?? 'GET'),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const status = response.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(response.body),
    } as unknown as Response;
  }) as typeof fetch;
  return { rest: new RestClient('http://test/api', () => undefined, fetchImpl), captured };
}

describe('RestClient.register', () => {
  it('打到 POST /auth/register 并透传凭据', async () => {
    const { rest, captured } = makeRest({
      body: { success: true, data: { token: 't', expiresAt: 1, userId: 'u1', displayName: 'd' } },
    });
    const result = await rest.register({ username: 'alice', password: 'secret123' });
    expect(result.success).toBe(true);
    expect(captured[0]?.url).toBe('http://test/api/auth/register');
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.body).toEqual({ username: 'alice', password: 'secret123' });
  });

  it('业务失败（同账号已存在）作为值返回、不抛', async () => {
    const { rest } = makeRest({
      body: { success: false, message: '账号已存在', data: { code: 'PLAYER_NAME_TAKEN' } },
    });
    const result = await rest.register({ username: 'alice', password: 'secret123' });
    expect(result.success).toBe(false);
  });

  it('HTTP 失败（如 500）抛出（由 store 兜底），不当成业务失败静默吞掉', async () => {
    const { rest } = makeRest({ status: 500, body: { message: 'boom' } });
    await expect(rest.register({ username: 'alice', password: 'secret123' })).rejects.toThrow();
  });
});

// ─────────────────────────── 3. SessionStore ───────────────────────────

function makeSession(registerResult: unknown | Error): {
  session: SessionStore;
  storage: ReturnType<typeof createMemoryStorage>;
  calls: number;
} {
  let calls = 0;
  const rest = {
    register: async () => {
      calls += 1;
      if (registerResult instanceof Error) throw registerResult;
      return registerResult;
    },
  } as unknown as RestClient;
  const storage = createMemoryStorage();
  const session = new SessionStore({} as never, rest, storage, new ToastStore());
  return {
    session,
    storage,
    get calls() {
      return calls;
    },
  };
}

const SUCCESS = { success: true, data: { token: 'jwt-9', expiresAt: 1, userId: 'u9', displayName: '新玩家' } };

describe('SessionStore.register', () => {
  it('成功 → 已登录、token 与 me 落盘', async () => {
    const { session, storage } = makeSession(SUCCESS);
    await expect(session.register('alice', 'secret123')).resolves.toBe(true);
    expect(session.status).toBe('authenticated');
    expect(session.token).toBe('jwt-9');
    expect(session.errorMessage).toBeNull();
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-9');
    expect(JSON.parse(storage.getItem(ME_STORAGE_KEY) ?? '{}')).toMatchObject({ userId: 'u9' });
  });

  it('成功时清掉上一个会话的角色列表与选中角色（换账号不串数据）', async () => {
    const { session } = makeSession(SUCCESS);
    session.players = [{ key: 'old' } as never];
    session.activePlayerKey = 'old';
    await session.register('alice', 'secret123');
    expect(session.activePlayerKey).toBeNull();
    expect(session.players).toEqual([]);
  });

  it('业务失败 → 匿名 + errorMessage + 返回 false，且**不落盘**', async () => {
    const { session, storage } = makeSession({
      success: false,
      message: '账号已存在',
      data: { code: 'PLAYER_NAME_TAKEN' },
    });
    await expect(session.register('alice', 'secret123')).resolves.toBe(false);
    expect(session.status).toBe('anonymous');
    expect(session.errorMessage).toBe('账号已存在');
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('业务失败但服务端没给 message 时回落到业务码', async () => {
    const { session } = makeSession({ success: false, data: { code: 'INVALID_PARAM' } });
    await session.register('alice', 'secret123');
    expect(session.errorMessage).toBe('INVALID_PARAM');
  });

  it('响应缺少 token → 返回 false 且不抛（视作注册失败）', async () => {
    const { session } = makeSession({ success: true, data: { userId: 'u9' } });
    await expect(session.register('alice', 'secret123')).resolves.toBe(false);
    expect(session.status).toBe('anonymous');
    expect(session.errorMessage).toContain('缺少 token');
  });

  it('响应 data 为 undefined → 返回 false 且不抛', async () => {
    const { session } = makeSession({ success: true });
    await expect(session.register('alice', 'secret123')).resolves.toBe(false);
    expect(session.status).toBe('anonymous');
  });

  it('网络异常 → 返回 false + errorMessage（不冒泡）', async () => {
    const { session } = makeSession(new Error('fetch failed'));
    await expect(session.register('alice', 'secret123')).resolves.toBe(false);
    expect(session.status).toBe('anonymous');
    expect(session.errorMessage).toBe('fetch failed');
  });

  it('busy 在成功与失败后都归位（不会卡住按钮）', async () => {
    const okRun = makeSession(SUCCESS);
    await okRun.session.register('alice', 'secret123');
    expect(okRun.session.busy).toBe(false);

    const badRun = makeSession(new Error('boom'));
    await badRun.session.register('alice', 'secret123');
    expect(badRun.session.busy).toBe(false);
  });

  it('clearError 清掉内联错误（登录/注册切换用）', async () => {
    const { session } = makeSession({ success: false, data: { code: 'X' } });
    await session.register('alice', 'secret123');
    expect(session.errorMessage).toBe('X');
    session.clearError();
    expect(session.errorMessage).toBeNull();
    session.clearError(); // 幂等
    expect(session.errorMessage).toBeNull();
  });

  it('AUTH_LIMITS 与后端 AuthService 的校验一致（防前端放宽）', () => {
    // 服务端：USERNAME_MIN_LENGTH=3 / USERNAME_MAX_LENGTH=32 / PASSWORD_MIN_LENGTH=6
    expect(AUTH_LIMITS).toEqual({ usernameMin: 3, usernameMax: 32, passwordMin: 6 });
  });

  it('跨包护栏：直接读服务端源码，确认阈值逐字一致（防将来漂移）', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../server/src/modules/auth/auth.service.ts'),
      'utf8',
    );
    const readConst = (name: string): number => {
      const matched = new RegExp(`const ${name} = (\\d+);`).exec(source);
      if (matched === null) throw new Error(`服务端源码里找不到 ${name}`);
      return Number(matched[1]);
    };
    expect(readConst('USERNAME_MIN_LENGTH')).toBe(AUTH_LIMITS.usernameMin);
    expect(readConst('USERNAME_MAX_LENGTH')).toBe(AUTH_LIMITS.usernameMax);
    expect(readConst('PASSWORD_MIN_LENGTH')).toBe(AUTH_LIMITS.passwordMin);
  });
});
