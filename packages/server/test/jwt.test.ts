import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  DEFAULT_JWT_EXPIRES_IN_SECONDS,
  DEFAULT_JWT_SECRET,
  jwtExpiresAt,
  resolveExpiresInSeconds,
  signJwt,
  tokenFromUrl,
  verifyBearerHeader,
  verifyJwt,
} from '../src/common/auth/jwt.js';

const SECRET = 'unit-test-secret';
const payload = { id: 42, username: 'tester' };

let savedSecret: string | undefined;
let savedExpires: string | undefined;

beforeEach(() => {
  savedSecret = process.env.JWT_SECRET;
  savedExpires = process.env.JWT_EXPIRES_IN;
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_EXPIRES_IN = '3600';
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
  if (savedExpires === undefined) delete process.env.JWT_EXPIRES_IN;
  else process.env.JWT_EXPIRES_IN = savedExpires;
});

describe('signJwt / verifyJwt', () => {
  it('签发 → 校验往返成功', () => {
    const token = signJwt(payload);
    const decoded = verifyJwt(token);
    expect(decoded).toEqual({ id: 42, username: 'tester' });
  });

  it('缺省 username 的合法签名 → username 回退为空串，id 仍有效', () => {
    const token = jwt.sign({ id: 7 }, SECRET, { expiresIn: 60 });
    expect(verifyJwt(token)).toEqual({ id: 7, username: '' });
  });

  it('过期 → null', () => {
    const token = signJwt(payload, -1);
    expect(verifyJwt(token)).toBeNull();
  });

  it('载荷被篡改（重新编码 payload，签名不匹配）→ null', () => {
    const token = signJwt(payload);
    const parts = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ id: 999, username: 'hacker' })).toString(
      'base64url',
    );
    const forged = `${parts[0] ?? ''}.${forgedPayload}.${parts[2] ?? ''}`;
    expect(verifyJwt(forged)).toBeNull();
  });

  it('签名被篡改（改末位字符）→ null', () => {
    const token = signJwt(payload);
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(verifyJwt(tampered)).toBeNull();
  });

  it('换密钥签发 → null（密钥真正参与校验）', () => {
    const token = signJwt(payload);
    process.env.JWT_SECRET = 'another-secret';
    expect(verifyJwt(token)).toBeNull();
  });

  it('空串 / 非 token 字符串 / 畸形串 → null（不抛错）', () => {
    expect(verifyJwt('')).toBeNull();
    expect(verifyJwt('not-a-token')).toBeNull();
    expect(verifyJwt('a.b.c')).toBeNull();
    expect(verifyJwt('..')).toBeNull();
  });

  it('签名合法但载荷形状不符（缺 id / id 非数字 / id<=0 / 超安全整数）→ null', () => {
    const sign = (value: unknown): string => jwt.sign(value as object, SECRET, { expiresIn: 60 });
    expect(verifyJwt(sign({ username: 'x' }))).toBeNull();
    expect(verifyJwt(sign({ id: '42', username: 'x' }))).toBeNull();
    expect(verifyJwt(sign({ id: 0, username: 'x' }))).toBeNull();
    expect(verifyJwt(sign({ id: -1, username: 'x' }))).toBeNull();
    expect(verifyJwt(sign({ id: 1.5, username: 'x' }))).toBeNull();
    expect(verifyJwt(sign({ id: Number.MAX_SAFE_INTEGER + 1, username: 'x' }))).toBeNull();
    expect(verifyJwt(sign({ id: null, username: 'x' }))).toBeNull();
  });

  it('默认密钥兜底（未设置 JWT_SECRET 时可签发/校验）', () => {
    delete process.env.JWT_SECRET;
    const token = signJwt(payload);
    expect(verifyJwt(token)).toEqual({ id: 42, username: 'tester' });
    expect(DEFAULT_JWT_SECRET).toBeTruthy();
  });
});

describe('jwtExpiresAt', () => {
  it('返回未来时刻（exp * 1000）', () => {
    const token = signJwt(payload, 3600);
    const expiresAt = jwtExpiresAt(token);
    expect(expiresAt).toBeGreaterThan(Date.now() + 3500 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 1000);
  });

  it('无法解析的 token → 当前时刻兜底（不抛错）', () => {
    const before = Date.now();
    const value = jwtExpiresAt('not-a-token');
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });
});

describe('resolveExpiresInSeconds', () => {
  it('纯数字按秒', () => {
    expect(resolveExpiresInSeconds('3600')).toBe(3600);
    expect(resolveExpiresInSeconds('0')).toBe(0);
    expect(resolveExpiresInSeconds('-1')).toBe(-1);
    expect(resolveExpiresInSeconds('1.9')).toBe(1);
  });

  it('单位串换算（s/m/h/d/w/y）', () => {
    expect(resolveExpiresInSeconds('30s')).toBe(30);
    expect(resolveExpiresInSeconds('10m')).toBe(600);
    expect(resolveExpiresInSeconds('12h')).toBe(43_200);
    expect(resolveExpiresInSeconds('7d')).toBe(604_800);
    expect(resolveExpiresInSeconds('1w')).toBe(604_800);
    expect(resolveExpiresInSeconds('1y')).toBe(31_536_000);
    expect(resolveExpiresInSeconds(' 7D ')).toBe(604_800);
  });

  it('空串 / 非法串 → 默认 7 天；未设置环境变量 → 默认 7 天', () => {
    expect(resolveExpiresInSeconds('')).toBe(DEFAULT_JWT_EXPIRES_IN_SECONDS);
    expect(resolveExpiresInSeconds('abc')).toBe(DEFAULT_JWT_EXPIRES_IN_SECONDS);
    expect(resolveExpiresInSeconds('7x')).toBe(DEFAULT_JWT_EXPIRES_IN_SECONDS);
    delete process.env.JWT_EXPIRES_IN;
    expect(resolveExpiresInSeconds()).toBe(DEFAULT_JWT_EXPIRES_IN_SECONDS);
    expect(resolveExpiresInSeconds(undefined)).toBe(DEFAULT_JWT_EXPIRES_IN_SECONDS);
  });
});

describe('verifyBearerHeader', () => {
  it('合法 Bearer → 解析成功', () => {
    const token = signJwt(payload);
    expect(verifyBearerHeader(`Bearer ${token}`)).toEqual({ id: 42, username: 'tester' });
  });

  it('数组形式取首个', () => {
    const token = signJwt(payload);
    expect(verifyBearerHeader([`Bearer ${token}`, 'Bearer bogus'])).toEqual({
      id: 42,
      username: 'tester',
    });
  });

  it('缺失 / 非字符串 / 方案不符 / 空 token / 非法 token → null', () => {
    expect(verifyBearerHeader(undefined)).toBeNull();
    expect(verifyBearerHeader([])).toBeNull();
    expect(verifyBearerHeader('Basic abc')).toBeNull();
    expect(verifyBearerHeader('Bearer')).toBeNull();
    expect(verifyBearerHeader('Bearer   ')).toBeNull();
    expect(verifyBearerHeader('Bearer bogus')).toBeNull();
    expect(verifyBearerHeader(`bearer ${signJwt(payload)}`)).toBeNull();
  });
});

describe('tokenFromUrl', () => {
  it('取 ?token=', () => {
    expect(tokenFromUrl('/ws?token=abc.def.ghi')).toBe('abc.def.ghi');
    expect(tokenFromUrl('ws://localhost:3000/ws?token=xyz&other=1')).toBe('xyz');
  });

  it('无参数 / 无 token → 空串', () => {
    expect(tokenFromUrl('/ws')).toBe('');
    expect(tokenFromUrl('/ws?other=1')).toBe('');
    expect(tokenFromUrl('')).toBe('');
  });

  it('畸形 URL 不抛错', () => {
    expect(tokenFromUrl('http://[')).toBe('');
  });

  it('握手鉴权组合：URL token 可被 verifyJwt 接受', () => {
    const token = signJwt(payload);
    expect(verifyJwt(tokenFromUrl(`/ws?token=${token}`))).toEqual({
      id: 42,
      username: 'tester',
    });
  });
});
