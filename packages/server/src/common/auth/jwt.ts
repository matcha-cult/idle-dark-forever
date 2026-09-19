/**
 * JWT 签发 / 校验（纯函数，无依赖注入）
 *
 * 为什么抽成纯函数：HTTP 侧（AuthService / JwtAuthGuard）与 WS **握手鉴权**
 * （`IonetModule.forRoot({ wsServer: { authenticate } })`）需要同一套密钥与语义，
 * 共用本文件可避免两个入口的密钥 / 过期策略分叉。
 *
 * 环境变量（**惰性读取**，因此不依赖 `dotenv/config` 的加载顺序，也便于单测逐例改环境）：
 * - `JWT_SECRET`        默认 `dev-secret-change-me`（仅开发）
 * - `JWT_EXPIRES_IN`   秒数或 `7d` / `12h` / `30m` 这类时长串；默认 7 天
 *                       （兼容参考实现的 `JWT_EXPIRES_IN_SECONDS`）
 *
 * 安全约定：`verifyJwt` 永不抛错——非法 / 过期 / 被篡改 / 载荷形状不符一律返回 null。
 */
import jwt from 'jsonwebtoken';

/** 已签发 token 的载荷（业务只用 id + username）。 */
export interface JwtPayload {
  id: number;
  username: string;
}

export const DEFAULT_JWT_SECRET = 'dev-secret-change-me';
export const DEFAULT_JWT_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
  y: 365 * 24 * 60 * 60,
};

function jwtSecret(): string {
  const raw = process.env.JWT_SECRET;
  return raw !== undefined && raw.length > 0 ? raw : DEFAULT_JWT_SECRET;
}

/** 解析 `JWT_EXPIRES_IN`：纯数字按秒；`7d` 这类串按单位换算；非法 → 默认值。 */
export function resolveExpiresInSeconds(raw: string | undefined = process.env.JWT_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN_SECONDS): number {
  if (raw === undefined) return DEFAULT_JWT_EXPIRES_IN_SECONDS;
  const text = raw.trim();
  if (text === '') return DEFAULT_JWT_EXPIRES_IN_SECONDS;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return Math.floor(numeric);
  const matched = /^(\d+)\s*(s|m|h|d|w|y)$/.exec(text.toLowerCase());
  if (matched) {
    const amount = Number(matched[1]);
    const unit = matched[2];
    const multiplier = unit === undefined ? undefined : UNIT_SECONDS[unit];
    if (Number.isFinite(amount) && multiplier !== undefined) {
      return Math.floor(amount * multiplier);
    }
  }
  return DEFAULT_JWT_EXPIRES_IN_SECONDS;
}

/**
 * 签发 token。
 *
 * @param payload 业务载荷（id 必须是正安全整数）
 * @param expiresInSeconds 覆盖默认过期秒数；负数 / 0 可用于测试「已过期」分支
 */
export function signJwt(
  payload: JwtPayload,
  expiresInSeconds: number = resolveExpiresInSeconds(),
): string {
  return jwt.sign(
    { id: payload.id, username: payload.username },
    jwtSecret(),
    { expiresIn: expiresInSeconds },
  );
}

/**
 * 校验 token；非法 / 过期 / 被篡改 / 载荷形状不符 → null（不抛错）。
 *
 * 载荷校验是防「签名合法但形状不对」的纵深防御：WS 握手会把 `payload.id` 交给
 * `BigInt()`，若形状不校验，`BigInt(undefined)` 会在升级阶段抛 500 而非 401。
 */
export function verifyJwt(token: string): JwtPayload | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const decoded = jwt.verify(token, jwtSecret());
    if (decoded === null || typeof decoded !== 'object') return null;
    const raw = decoded as Record<string, unknown>;
    const id = raw['id'];
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
    const username = raw['username'];
    return { id, username: typeof username === 'string' ? username : '' };
  } catch {
    return null;
  }
}

/**
 * 从 `Authorization: Bearer <token>` 形式的头里取出并校验用户。
 * 头缺失 / 格式不符 / 校验失败 → null。HTTP Guard 与 WS 握手共用。
 */
export function verifyBearerHeader(raw: string | string[] | undefined): JwtPayload | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length).trim();
  if (!token) return null;
  return verifyJwt(token);
}

/**
 * 从 WS 握手 URL 中取 `?token=<jwt>`（浏览器 WebSocket 无法设置请求头时的凭据通道）。
 * 解析失败 / 无该参数 → 空串。
 */
export function tokenFromUrl(url: string): string {
  try {
    return new URL(url, 'http://localhost').searchParams.get('token') ?? '';
  } catch {
    return '';
  }
}

/**
 * 取 token 的过期时刻（毫秒）。仅用于回填 `LoginResponseDto.expiresAt`；
 * 不校验签名（token 刚由本进程签发）。无 `exp` / 解析失败 → 当前时刻。
 */
export function jwtExpiresAt(token: string): number {
  const decoded = jwt.decode(token);
  if (decoded !== null && typeof decoded === 'object') {
    const exp = (decoded as Record<string, unknown>)['exp'];
    if (typeof exp === 'number' && Number.isFinite(exp)) return Math.trunc(exp * 1000);
  }
  return Date.now();
}
