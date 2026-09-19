import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  base64UrlToText,
  bytesEqual,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  concatBytes,
  hexToBytes,
  md5,
  utf8Decode,
  utf8Encode,
  worldStart,
  worldStop,
  xorObfuscateInPlace,
} from './save-codec.js';

/**
 * ⚠️ 单测里引入 `node:crypto` **只作为 MD5 的对照 oracle**（实现本身是纯 TS）。
 * 这不影响 game-core 的平台无关性：测试文件不进入 `dist`（见 package.json `files`）。
 */
function nodeMd5Hex(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}

describe('md5（纯 TS 实现）', () => {
  it('RFC 1321 标准测试向量', () => {
    const vectors: Array<[string, string]> = [
      ['', 'd41d8cd98f00b204e9800998ecf8427e'],
      ['a', '0cc175b9c0f1b6a831c399e269772661'],
      ['abc', '900150983cd24fb0d6963f7d28e17f72'],
      ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
      ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
      [
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        'd174ab98d277d9f5a5611c2c9f419d9f',
      ],
      [
        '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
        '57edf4a22be3c955ac49da2e2107b67a',
      ],
    ];
    for (const [input, expected] of vectors) {
      expect(bytesToHex(md5(utf8Encode(input)))).toBe(expected);
    }
  });

  it('与 node:crypto 对照：空 / 边界长度 / 多块 / UTF-8', () => {
    const inputs: Uint8Array[] = [
      new Uint8Array(0),
      Uint8Array.from([0]),
      Uint8Array.from([0xff, 0x00, 0x7f, 0x80]),
      utf8Encode('中文 · 永夜2016 · ⚔️'),
      utf8Encode('a'.repeat(55)),
      utf8Encode('a'.repeat(56)),
      utf8Encode('a'.repeat(57)),
      utf8Encode('a'.repeat(63)),
      utf8Encode('a'.repeat(64)),
      utf8Encode('a'.repeat(65)),
      utf8Encode('a'.repeat(1000)),
      Uint8Array.from({ length: 256 }, (_, i) => i),
    ];
    for (const input of inputs) {
      expect(bytesToHex(md5(input))).toBe(nodeMd5Hex(input));
    }
  });

  it('返回 16 字节，且不同输入不会碰撞到同一摘要', () => {
    expect(md5(new Uint8Array(0)).length).toBe(16);
    expect(bytesEqual(md5(utf8Encode('x')), md5(utf8Encode('y')))).toBe(false);
  });
});

describe('UTF-8', () => {
  it('往返一致（ASCII / 中日韩 / emoji / 代理对）', () => {
    const samples = ['', 'ascii', '中文测试', '永夜2016典藏重置版', '⚔️🗡️', '𝄞𝕬', 'a\u0000b'];
    for (const sample of samples) {
      expect(utf8Decode(utf8Encode(sample))).toBe(sample);
    }
    expect(bytesToHex(utf8Encode('中'))).toBe('e4b8ad');
    expect(utf8Decode(hexToBytes('f09f9880'))).toBe('😀');
  });

  it('孤立代理抛错（不产出错误字节）', () => {
    expect(() => utf8Encode('\ud800')).toThrow(/surrogate/);
    expect(() => utf8Encode('\udc00')).toThrow(/surrogate/);
  });

  it('非法字节序列解码为 U+FFFD 而不是抛错', () => {
    expect(utf8Decode(Uint8Array.from([0xff, 0xfe]))).toBe('\uFFFD\uFFFD');
    expect(utf8Decode(Uint8Array.from([0xc3]))).toBe('\uFFFD');
  });
});

describe('base64', () => {
  it('标准向量（带填充）', () => {
    expect(bytesToBase64(utf8Encode(''))).toBe('');
    expect(bytesToBase64(utf8Encode('f'))).toBe('Zg==');
    expect(bytesToBase64(utf8Encode('fo'))).toBe('Zm8=');
    expect(bytesToBase64(utf8Encode('foo'))).toBe('Zm9v');
    expect(bytesToBase64(utf8Encode('foob'))).toBe('Zm9vYg==');
    expect(bytesToBase64(utf8Encode('fooba'))).toBe('Zm9vYmE=');
    expect(bytesToBase64(utf8Encode('foobar'))).toBe('Zm9vYmFy');
  });

  it('往返一致（0..255 全字节）', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesEqual(base64ToBytes(bytesToBase64(bytes)), bytes)).toBe(true);
  });

  it('宽松解码：忽略非字母表字符，容忍 url-safe 字符', () => {
    expect(bytesToHex(base64ToBytes('Zm9v\n'))).toBe('666f6f');
    expect(bytesToHex(base64ToBytes('Zm9vYg'))).toBe('666f6f62');
    expect(bytesToHex(base64ToBytes('-_'))).toBe('fbff');
  });

  it('base64url 无填充且往返一致', () => {
    const value = bytesToBase64Url(Uint8Array.from([0xfb, 0xff, 0xfe]));
    expect(value).toBe('-_--');
    expect(base64UrlToText(bytesToBase64Url(utf8Encode('中文')))).toBe('中文');
  });
});

describe('字节工具', () => {
  it('concatBytes / bytesEqual / hexToBytes', () => {
    const a = Uint8Array.from([1, 2]);
    const b = Uint8Array.from([3]);
    expect(bytesToHex(concatBytes(a, b))).toBe('010203');
    expect(bytesToHex(concatBytes())).toBe('');
    expect(bytesEqual(a, Uint8Array.from([1, 2]))).toBe(true);
    expect(bytesEqual(a, Uint8Array.from([1, 2, 3]))).toBe(false);
    expect(bytesEqual(a, Uint8Array.from([1, 3]))).toBe(false);
    expect(() => hexToBytes('abc')).toThrow(/odd-length/);
    expect(() => hexToBytes('zz')).toThrow(/invalid hex/);
  });

  it('xorObfuscateInPlace 自逆且逐字节符合公式', () => {
    const bytes = utf8Encode('永夜2016');
    const original = Uint8Array.from(bytes);
    xorObfuscateInPlace(bytes);
    expect(bytesEqual(bytes, original)).toBe(false);
    expect(bytes[0]).toBe(original[0]! ^ 0x27);
    expect(bytes[1]).toBe(original[1]! ^ 1 ^ 0x27);
    xorObfuscateInPlace(bytes);
    expect(bytesEqual(bytes, original)).toBe(true);
  });
});

describe('worldStop / worldStart', () => {
  const sample = {
    gold: 12345,
    inventory: [{ key: 'stickSword', level: 3, quality: 1 }],
    careers: { warrior: { level: 42, exp: 999 } },
    name: '永夜 · 主角 ⚔️',
    nested: { a: [1, 2, { b: null }], c: true },
    timestamp: 1730000000000,
  };

  it('round-trip 深度相等', () => {
    const blob = worldStop(sample, { randomSeed: 1 });
    expect(blob.startsWith('save')).toBe(true);
    expect(worldStart(blob)).toEqual(sample);
  });

  it('默认不注入 random 字段（保证 deep equal）', () => {
    const decoded = worldStart(worldStop(sample, { randomSeed: 7 })) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(decoded, 'random')).toBe(false);
  });

  it('injectRandom=true 时复刻原版：多出 random 字段且数据仍在', () => {
    const decoded = worldStart(
      worldStop(sample, { randomSeed: 7, injectRandom: true }),
    ) as Record<string, unknown>;
    expect(typeof decoded.random).toBe('number');
    expect(decoded.gold).toBe(12345);
  });

  it('大 payload（跨多个分片）往返一致', () => {
    const big = { list: Array.from({ length: 500 }, (_, i) => ({ i, s: `条目-${i}` })) };
    expect(worldStart(worldStop(big, { randomSeed: 42 }))).toEqual(big);
  });

  it('同一 randomSeed 产出逐字节相同的存档', () => {
    const a = worldStop(sample, { randomSeed: 99 });
    const b = worldStop(sample, { randomSeed: 99 });
    expect(a).toBe(b);
  });

  it('不同 randomSeed 产出不同存档（secret 不同）', () => {
    const a = worldStop(sample, { randomSeed: 1 });
    const b = worldStop(sample, { randomSeed: 2 });
    expect(a).not.toBe(b);
  });

  it('自定义 chunkSize 仍可往返', () => {
    const blob = worldStop(sample, { randomSeed: 3, chunkSize: 7 });
    expect(worldStart(blob)).toEqual(sample);
  });

  it('非法 chunkSize 抛错', () => {
    expect(() => worldStop(sample, { chunkSize: 0 })).toThrow(/chunkSize/);
    expect(() => worldStop(sample, { chunkSize: 1.5 })).toThrow(/chunkSize/);
  });

  it('缺失 / 非法前缀抛错', () => {
    expect(() => worldStart('nope')).toThrow(/missing prefix/);
    expect(() => worldStart('')).toThrow(/missing prefix/);
    expect(() => worldStart(undefined as unknown as string)).toThrow(/missing prefix/);
  });

  it('secret 不完整或正文长度不对抛错', () => {
    expect(() => worldStart('save' + bytesToBase64(new Uint8Array(4)))).toThrow(/shorter than secret/);
    // 合法 secret + 长度不是 32 的倍数的正文
    const bad = concatBytes(new Uint8Array(16), new Uint8Array(5));
    expect(() => worldStart('save' + bytesToBase64(bad))).toThrow(/unexpected body length/);
  });

  it('篡改正文/摘要/secret 的任意一个字节都必须抛错', () => {
    const blob = worldStop(sample, { randomSeed: 5 });
    const raw = base64ToBytes(blob.slice(4));
    expect(raw.length).toBeGreaterThan(16);
    for (let i = 0; i < raw.length; i++) {
      const tampered = Uint8Array.from(raw);
      tampered[i] = tampered[i]! ^ 0x01;
      expect(
        () => worldStart('save' + bytesToBase64(tampered)),
        `flip byte ${i} should be rejected`,
      ).toThrow();
    }
  });

  it('篡改 JSON 明文（未走校验）抛错', () => {
    expect(() => worldStart('save' + bytesToBase64(utf8Encode('{"gold":1}')))).toThrow();
  });
});
