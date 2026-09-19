/**
 * 存档二进制编解码（原版 `world.js` 的 `stop`/`start` 移植）。
 *
 * ## 格式事实（来自原版 `src/logics/world.js:672-720`）
 *
 * ```
 * 'save' + base64( secret(16B) ‖ [ md5(chunk ‖ secret)(16B) ‖ chunk ]* )
 * ```
 *
 * - 正文先做 `v ^ (i & 0xff) ^ 0x27` 混淆；
 * - `secret` 每次保存随机生成，并**明文前置**在存档里，只用于分片完整性校验；
 * - 因此这是**可逆混淆，不是加密**：只有 md5 + base64 + XOR，没有任何密钥依赖，
 *   所以「导入旧本地存档」不需要玩家提供任何密钥。
 *
 * ## 平台无关性
 *
 * md5 / base64 / UTF-8 全部为**纯 TypeScript 实现**，不 import 任何 Node 内置，
 * 也不依赖原版的 `md5` / `crypt` / `charenc` / `jsrsasign` 包。
 * 这样 game-core 在浏览器单机模式下可以原样复用（见总方案 §7.3）。
 */

import { Mulberry32Rng, SeededRngFactory } from '../rng/index.js';

// ────────────────────────────── 字节工具 ──────────────────────────────

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) {
    throw new Error('hexToBytes: odd-length hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`hexToBytes: invalid hex at offset ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}

/** 原版正文混淆：`v ^ (i & 0xff) ^ 0x27`（自逆，加解密同一个函数）。 */
export function xorObfuscateInPlace(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = bytes[i]! ^ (i & 0xff) ^ 0x27;
  }
}

// ────────────────────────────── UTF-8 ──────────────────────────────

/** 标准 UTF-8 编码（替换 `charenc/utf8.stringToBytes`）。 */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        const cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
        i += 1;
      } else {
        // 孤立高位代理：与 encodeURIComponent 一致，不静默产出错误字节
        throw new Error('utf8Encode: lone high surrogate');
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('utf8Encode: lone low surrogate');
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

/** 标准 UTF-8 解码；非法序列产出 U+FFFD（与 `TextDecoder` 的宽松行为一致）。 */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    let cp: number;
    let size: number;
    if (b0 < 0x80) {
      cp = b0;
      size = 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      size = 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      size = 3;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      size = 4;
    } else {
      cp = 0xfffd;
      size = 1;
    }
    if (size > 1) {
      let valid = true;
      for (let k = 1; k < size; k++) {
        const bk = i + k < bytes.length ? bytes[i + k]! : -1;
        if ((bk & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
        cp = (cp << 6) | (bk & 0x3f);
      }
      if (!valid) {
        cp = 0xfffd;
        size = 1;
      }
    }
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      out += '\uFFFD';
    } else if (cp <= 0xffff) {
      out += String.fromCharCode(cp);
    } else {
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
    i += size;
  }
  return out;
}

// ────────────────────────────── base64 ──────────────────────────────

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    table[BASE64_CHARS.charCodeAt(i)] = i;
  }
  return table;
})();

/** 标准 base64（带 `=` 填充），与 `crypt.bytesToBase64` 输出一致。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1]! : 0;
    const b2 = hasB2 ? bytes[i + 2]! : 0;
    out += BASE64_CHARS[b0 >> 2]!;
    out += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    out += hasB1 ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)]! : '=';
    out += hasB2 ? BASE64_CHARS[b2 & 0x3f]! : '=';
  }
  return out;
}

/**
 * 宽松 base64 解码，对齐原版 `crypt.base64ToBytes`：**忽略所有非字母表字符**（含 `=`）。
 * 额外容忍 url-safe 的 `-` / `_`（便于处理 JWT 片段）。
 */
export function base64ToBytes(input: string): Uint8Array {
  const src = input.replace(/-/g, '+').replace(/_/g, '/');
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < src.length; i++) {
    const code = src.charCodeAt(i);
    const value = code < 128 ? BASE64_LOOKUP[code]! : -1;
    if (value < 0) {
      continue;
    }
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** base64url（无填充），用于 JWT 片段。 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function base64UrlToText(segment: string): string {
  return utf8Decode(base64ToBytes(segment));
}

// ────────────────────────────── md5（纯 TS） ──────────────────────────────

// eslint-disable-next-line no-loss-of-precision
const MD5_K: readonly number[] = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

const MD5_S: readonly number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function rotl32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) | 0;
}

/** MD5（RFC 1321），返回 16 字节摘要。纯 TS，无 Node 依赖。 */
export function md5(message: Uint8Array): Uint8Array {
  const length = message.length;
  const bitLength = length * 8;
  const withPad = length + 1;
  const padLength = ((56 - (withPad % 64)) + 64) % 64;
  const total = withPad + padLength + 8;

  const buffer = new Uint8Array(total);
  buffer.set(message, 0);
  buffer[length] = 0x80;
  const view = new DataView(buffer.buffer);
  // MD5 的长度字段是 **64 位小端**：低 32 位在前（offset 56），高 32 位在后（offset 60）。
  view.setUint32(total - 8, bitLength >>> 0, true);
  view.setUint32(total - 4, Math.floor(bitLength / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const m = new Uint32Array(16);
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) {
      m[i] = view.getUint32(offset + i * 4, true);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const temp = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_K[i]! + m[g]!) | 0;
      b = (b + rotl32(sum, MD5_S[i]!)) | 0;
      a = temp;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const digest = new Uint8Array(16);
  const outView = new DataView(digest.buffer);
  outView.setUint32(0, a0 >>> 0, true);
  outView.setUint32(4, b0 >>> 0, true);
  outView.setUint32(8, c0 >>> 0, true);
  outView.setUint32(12, d0 >>> 0, true);
  return digest;
}

// ────────────────────────────── world 存档 ──────────────────────────────

/** 原版分片大小（正文每 16 字节一片）。 */
export const WORLD_SAVE_CHUNK_SIZE = 16;
/** 原版 secret 长度。 */
export const WORLD_SAVE_SECRET_SIZE = 16;
/** 原版存档前缀。 */
export const WORLD_SAVE_PREFIX = 'save';

export interface WorldStopOptions {
  /**
   * 用于生成 secret 与（可选的）`random` 干扰字段的种子。
   * 省略时走 `SeededRngFactory.nextSeed()`（game-core 里唯一被允许的真随机入口）。
   * 显式传入即可得到**逐字节确定**的存档（测试 / 复算）。
   */
  randomSeed?: number;
  /**
   * 是否写入原版的 `random` 干扰字段，默认为 **false**。
   *
   * 原版每次保存都写入 `{ random: Math.random(), ...data }`，但全仓库**没有任何地方读它**
   * （只为让每次保存的 blob 不同）。默认关闭是为了让 `worldStart(worldStop(x))` 与原数据
   * **深度相等**；需要逐字节复刻原版存档时置 true。
   */
  injectRandom?: boolean;
}

/**
 * 把存档对象编码成原版 `'save' + base64(...)` 格式（可逆混淆，无密钥）。
 */
export function worldStop(data: unknown, options: WorldStopOptions = {}): string {
  const rng = new Mulberry32Rng(options.randomSeed ?? new SeededRngFactory().nextSeed());
  const secret = new Uint8Array(WORLD_SAVE_SECRET_SIZE);
  for (let i = 0; i < secret.length; i++) {
    secret[i] = rng.int(256);
  }

  let payload: unknown = data;
  if (options.injectRandom) {
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      payload = { random: rng.next(), ...(data as Record<string, unknown>) };
    } else {
      payload = { random: rng.next() };
    }
  }

  const body = utf8Encode(JSON.stringify(payload));
  xorObfuscateInPlace(body);

  // ⚠️ 分片大小固定 16：格式里**不记录** chunkSize，写入端可配、读取端却无从得知，
  // 因此不提供该选项（原版也是硬编码 16）。
  const parts: Uint8Array[] = [secret];
  for (let offset = 0; offset < body.length; offset += WORLD_SAVE_CHUNK_SIZE) {
    const chunk = body.subarray(offset, offset + WORLD_SAVE_CHUNK_SIZE);
    parts.push(md5(concatBytes(chunk, secret)));
    parts.push(chunk);
  }
  return WORLD_SAVE_PREFIX + bytesToBase64(concatBytes(...parts));
}

/**
 * 解码原版 `'save' + base64(...)` 存档。
 *
 * 任意一个字节被篡改（正文、分片摘要、secret）都会抛 `Error('Invalid data ...')`。
 */
export function worldStart(encrypted: string): unknown {
  if (typeof encrypted !== 'string' || !encrypted.startsWith(WORLD_SAVE_PREFIX)) {
    throw new Error('worldStart: not a "save" blob (missing prefix)');
  }
  const data = base64ToBytes(encrypted.slice(WORLD_SAVE_PREFIX.length));
  if (data.length < WORLD_SAVE_SECRET_SIZE) {
    throw new Error('worldStart: corrupt blob (shorter than secret)');
  }
  const secret = data.subarray(0, WORLD_SAVE_SECRET_SIZE);
  const body = data.subarray(WORLD_SAVE_SECRET_SIZE);

  const stride = WORLD_SAVE_CHUNK_SIZE + 16;
  const pieces: Uint8Array[] = [];
  // 与原版同样的扫描方式：`i * stride < body.length`，
  // 最后一片允许短于 16 字节（因此正文总长**不是** stride 的整数倍）。
  for (let i = 0; i * stride < body.length; i++) {
    const digest = body.subarray(i * stride, i * stride + 16);
    const chunk = body.subarray(i * stride + 16, (i + 1) * stride);
    if (!bytesEqual(digest, md5(concatBytes(chunk, secret)))) {
      throw new Error('Invalid data');
    }
    pieces.push(chunk);
  }
  if (pieces.length === 0) {
    throw new Error('worldStart: corrupt blob (empty body)');
  }

  const json = concatBytes(...pieces);
  xorObfuscateInPlace(json);
  return JSON.parse(utf8Decode(json)) as unknown;
}

// ────────────────────────────── 类型判定 ──────────────────────────────

/** 存档类型判定结果。 */
export type SaveKind = 'json' | 'jwt' | 'save' | 'unknown';

/** 判定一段存档文本的类型（对齐原版 `game.load` / `Player.load` 的首字符分派）。 */
export function detectSaveKind(raw: unknown): SaveKind {
  if (typeof raw !== 'string' || raw.length === 0) {
    return 'unknown';
  }
  const text = raw.trim();
  if (text.length === 0) {
    return 'unknown';
  }
  if (text.startsWith('{')) {
    return 'json';
  }
  if (text.startsWith(WORLD_SAVE_PREFIX)) {
    return 'save';
  }
  // 原版：`loaded[0] === 'e'` 即当作 JWT（HS256 的 header base64url 必然以 "ey" 开头）
  if (text.charCodeAt(0) === 0x65 && text.split('.').length === 3) {
    return 'jwt';
  }
  return 'unknown';
}
