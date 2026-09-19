/**
 * `game` 存档（账号级）编解码 + HS256 JWT 支持。
 *
 * ## 原版事实（`src/logics/game.js:14,246-273,342-366`）
 *
 * - 开发态：`localStorage['game'] = JSON.stringify(preSave(game.toJS()))` → **明文 JSON**；
 * - 生产态：`jws.JWS.sign(null, {alg:'HS256',typ:'JWT'}, payload, 'chapter5.woodElf')`
 *   → **HS256 JWT**，密钥硬编码在前端（`chapter5.woodElf`），payload 即存档本体；
 * - 读取时按首字符分派：`'{'` → JSON；`'e'` → 验签后取 payload；`'s'` → `world.start`。
 *
 * ## 本实现
 *
 * SHA-256 / HMAC-SHA256 均为**纯 TypeScript**（不 import `node:crypto`、不用 `jsrsasign`），
 * 因此 game-core 保持平台无关。签发出的 JWT 是**标准** HS256 JWT，
 * 与原版 jsrsasign 的产字节可能不同（header 里的空白/字段顺序），但双方**互相验签通过**。
 */

import {
  base64ToBytes,
  base64UrlToText,
  bytesEqual,
  bytesToBase64Url,
  detectSaveKind,
  utf8Encode,
  worldStart,
  type SaveKind,
} from './save-codec.js';

/** 《永夜》原版硬编码的 `game` 存档密钥（仅用于兼容导入旧存档）。 */
export const LEGACY_JWT_SECRET = 'chapter5.woodElf';

// ────────────────────────────── SHA-256 ──────────────────────────────

const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr32(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** SHA-256（FIPS 180-4），返回 32 字节摘要。纯 TS。 */
export function sha256(message: Uint8Array): Uint8Array {
  const length = message.length;
  const bitLength = length * 8;
  const withPad = length + 1;
  const padLength = ((56 - (withPad % 64)) + 64) % 64;
  const total = withPad + padLength + 8;

  const buffer = new Uint8Array(total);
  buffer.set(message, 0);
  buffer[length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000) >>> 0, false);
  view.setUint32(total - 4, bitLength >>> 0, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = (rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3)) >>> 0;
      const s1 = (rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;

    for (let i = 0; i < 64; i++) {
      const s1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + s1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const s0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  const digest = new Uint8Array(32);
  const outView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, h[i]!, false);
  }
  return digest;
}

/** HMAC-SHA256（RFC 2104），返回 32 字节。纯 TS。 */
export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const blockSize = 64;
  const normalized = key.length > blockSize ? sha256(key) : key;
  const padded = new Uint8Array(blockSize);
  padded.set(normalized, 0);

  const inner = new Uint8Array(blockSize + data.length);
  const outer = new Uint8Array(blockSize + 32);
  for (let i = 0; i < blockSize; i++) {
    inner[i] = padded[i]! ^ 0x36;
    outer[i] = padded[i]! ^ 0x5c;
  }
  inner.set(data, blockSize);
  outer.set(sha256(inner), blockSize);
  return sha256(outer);
}

// ────────────────────────────── JWT(HS256) ──────────────────────────────

export interface JwtSignOptions {
  /** 密钥，默认 {@link LEGACY_JWT_SECRET}。 */
  secret?: string;
  /** 自定义 header（默认 `{alg:'HS256',typ:'JWT'}`）。 */
  header?: Record<string, unknown>;
}

/** 签发标准 HS256 JWT。 */
export function signJwtHs256(payload: unknown, options: JwtSignOptions = {}): string {
  const secret = options.secret ?? LEGACY_JWT_SECRET;
  const header = options.header ?? { alg: 'HS256', typ: 'JWT' };
  const headerPart = bytesToBase64Url(utf8Encode(JSON.stringify(header)));
  const payloadPart = bytesToBase64Url(utf8Encode(JSON.stringify(payload ?? null)));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = hmacSha256(utf8Encode(secret), utf8Encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(signature)}`;
}

/**
 * 校验并读出 HS256 JWT 的 payload。
 *
 * 任何一步不合法（格式 / header / alg 不是 HS256 / 签名不匹配 / JSON 解析失败）都返回 `null`，
 * 不抛异常——调用方（存档导入）按「跳过该存档」处理。
 *
 * ⚠️ 显式拒绝 `alg: 'none'`：原版 `verifyJWT(..., {alg:['HS256']})` 也是白名单语义，
 * 但这里是安全关键路径，必须逐字对齐。
 */
export function verifyJwtHs256(token: unknown, secret: string): unknown | null {
  if (typeof token !== 'string') {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const headerPart = parts[0]!;
  const payloadPart = parts[1]!;
  const signaturePart = parts[2]!;
  if (headerPart.length === 0 || payloadPart.length === 0 || signaturePart.length === 0) {
    return null;
  }

  let header: unknown;
  try {
    header = JSON.parse(base64UrlToText(headerPart)) as unknown;
  } catch {
    return null;
  }
  if (header === null || typeof header !== 'object') {
    return null;
  }
  if ((header as { alg?: unknown }).alg !== 'HS256') {
    return null;
  }

  const expected = hmacSha256(
    utf8Encode(secret),
    utf8Encode(`${headerPart}.${payloadPart}`),
  );
  const actual = base64ToBytes(signaturePart);
  if (!bytesEqual(expected, actual)) {
    return null;
  }

  try {
    return JSON.parse(base64UrlToText(payloadPart)) as unknown;
  } catch {
    return null;
  }
}

// ────────────────────────────── game 存档 ──────────────────────────────

export interface EncodeGameSaveOptions {
  /** true → 产出生产态的 HS256 JWT；false/省略 → 产出开发态明文 JSON（原版行为）。 */
  legacyJwt?: boolean;
  /** JWT 密钥，默认 {@link LEGACY_JWT_SECRET}。 */
  secret?: string;
}

/** 编码 `game` 存档（原版 `game.save()` 的开发态 JSON / 生产态 JWT 两种形态）。 */
export function encodeGameSave(data: unknown, options: EncodeGameSaveOptions = {}): string {
  if (options.legacyJwt) {
    return signJwtHs256(data, { secret: options.secret });
  }
  return JSON.stringify(data) ?? 'null';
}

/**
 * 解码 `game` / `player` 存档文本：自动识别 JSON / JWT / `save` 混淆三种形态。
 *
 * @throws 无法识别的格式、签名非法、JSON 解析失败时抛错（调用方决定是否跳过）。
 */
export function decodeGameSave(raw: string, secret: string = LEGACY_JWT_SECRET): unknown {
  const kind: SaveKind = detectSaveKind(raw);
  switch (kind) {
    case 'json':
      return JSON.parse(raw) as unknown;
    case 'save':
      return worldStart(raw);
    case 'jwt': {
      const payload = verifyJwtHs256(raw, secret);
      if (payload === null) {
        throw new Error('decodeGameSave: invalid JWT save (bad signature or unsupported alg)');
      }
      return payload;
    }
    default:
      throw new Error('decodeGameSave: unknown save format');
  }
}
