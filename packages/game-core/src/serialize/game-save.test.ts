import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  base64UrlToText,
  bytesToBase64Url,
  bytesToHex,
  hexToBytes,
  utf8Encode,
  worldStop,
} from './save-codec.js';
import {
  LEGACY_JWT_SECRET,
  decodeGameSave,
  encodeGameSave,
  hmacSha256,
  sha256,
  signJwtHs256,
  verifyJwtHs256,
} from './game-save.js';
import { detectSaveKind } from './save-codec.js';

describe('sha256（纯 TS）', () => {
  it('FIPS 180-4 标准向量', () => {
    expect(bytesToHex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(bytesToHex(sha256(utf8Encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      bytesToHex(
        sha256(utf8Encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
      ),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('跨块边界（55/56/57/64/65 字节）产出 32 字节且互不相同', () => {
    const digests = [55, 56, 57, 64, 65].map((n) => bytesToHex(sha256(utf8Encode('a'.repeat(n)))));
    expect(new Set(digests).size).toBe(digests.length);
    expect(sha256(utf8Encode('a')).length).toBe(32);
  });
});

describe('hmacSha256（RFC 4231 测试向量）', () => {
  const cases: Array<[string, Uint8Array, Uint8Array, string]> = [
    [
      'TC1',
      hexToBytes('0b'.repeat(20)),
      utf8Encode('Hi There'),
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    ],
    [
      'TC2',
      utf8Encode('Jefe'),
      utf8Encode('what do ya want for nothing?'),
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    ],
    [
      'TC3',
      hexToBytes('aa'.repeat(20)),
      hexToBytes('dd'.repeat(50)),
      '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
    ],
    [
      'TC4',
      hexToBytes('0102030405060708090a0b0c0d0e0f10111213141516171819'),
      hexToBytes('cd'.repeat(50)),
      '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
    ],
    [
      'TC6（key 超块长，需先哈希）',
      hexToBytes('aa'.repeat(131)),
      utf8Encode('Test Using Larger Than Block-Size Key - Hash Key First'),
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    ],
    [
      'TC7（key 与 data 都超块长）',
      hexToBytes('aa'.repeat(131)),
      utf8Encode(
        'This is a test using a larger than block-size key and a larger than block-size data. ' +
          'The key needs to be hashed before being used by the HMAC algorithm.',
      ),
      '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
    ],
  ];

  it.each(cases)('%s', (_name, key, data, expected) => {
    expect(bytesToHex(hmacSha256(key, data))).toBe(expected);
  });

  it('空 key / 空 data 不抛错', () => {
    expect(hmacSha256(new Uint8Array(0), new Uint8Array(0)).length).toBe(32);
  });
});

describe('HS256 JWT', () => {
  const payload = { diamonds: 100, playerSlotCount: 3, name: '永夜 ⚔️' };

  it('签发/验签 round-trip（默认密钥）', () => {
    const token = signJwtHs256(payload);
    expect(detectSaveKind(token)).toBe('jwt');
    expect(verifyJwtHs256(token, LEGACY_JWT_SECRET)).toEqual(payload);
  });

  it('header 为标准 {"alg":"HS256","typ":"JWT"}', () => {
    const token = signJwtHs256(payload);
    const header = JSON.parse(base64UrlToText(token.split('.')[0]!)) as Record<string, unknown>;
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('验签通过只依赖 header/payload，不依赖 typ 字段（兼容 jsrsasign 变体）', () => {
    // 手工构造一个只有 alg 的 header，模拟其它实现
    const headerPart = bytesToBase64Url(utf8Encode('{"alg":"HS256"}'));
    const payloadPart = bytesToBase64Url(utf8Encode(JSON.stringify(payload)));
    const signature = hmacSha256(
      utf8Encode(LEGACY_JWT_SECRET),
      utf8Encode(`${headerPart}.${payloadPart}`),
    );
    const token = `${headerPart}.${payloadPart}.${bytesToBase64Url(signature)}`;
    expect(verifyJwtHs256(token, LEGACY_JWT_SECRET)).toEqual(payload);
  });

  it('自定义密钥', () => {
    const token = signJwtHs256(payload, { secret: 'other-secret' });
    expect(verifyJwtHs256(token, 'other-secret')).toEqual(payload);
    expect(verifyJwtHs256(token, LEGACY_JWT_SECRET)).toBeNull();
  });

  it('payload 被篡改 → null', () => {
    const token = signJwtHs256(payload);
    const parts = token.split('.');
    const forgedPayload = bytesToBase64Url(utf8Encode('{"diamonds":999999}'));
    expect(verifyJwtHs256(`${parts[0]}.${forgedPayload}.${parts[2]}`, LEGACY_JWT_SECRET)).toBeNull();
  });

  it('签名被篡改 → null', () => {
    const token = signJwtHs256(payload);
    const parts = token.split('.');
    const signature = base64ToBytes(parts[2]!);
    signature[0] = signature[0]! ^ 0x01;
    expect(
      verifyJwtHs256(`${parts[0]}.${parts[1]}.${bytesToBase64Url(signature)}`, LEGACY_JWT_SECRET),
    ).toBeNull();
  });

  it('alg=none 伪造 token → null（白名单语义）', () => {
    const headerPart = bytesToBase64Url(utf8Encode('{"alg":"none","typ":"JWT"}'));
    const payloadPart = bytesToBase64Url(utf8Encode('{"diamonds":1}'));
    const token = `${headerPart}.${payloadPart}.`;
    expect(verifyJwtHs256(token, LEGACY_JWT_SECRET)).toBeNull();
  });

  it('alg=RS256 等非 HS256 → null', () => {
    const headerPart = bytesToBase64Url(utf8Encode('{"alg":"RS256"}'));
    const payloadPart = bytesToBase64Url(utf8Encode('{}'));
    expect(verifyJwtHs256(`${headerPart}.${payloadPart}.AAAA`, LEGACY_JWT_SECRET)).toBeNull();
  });

  it('格式非法 → null（不抛错）', () => {
    const invalid: unknown[] = [
      undefined,
      null,
      123,
      '',
      'a.b',
      'a.b.c.d',
      '..',
      'e30.e30.',
      `${bytesToBase64Url(utf8Encode('not-json'))}.e30.AAAA`,
      `${bytesToBase64Url(utf8Encode('[1,2]'))}.e30.AAAA`,
    ];
    for (const token of invalid) {
      expect(verifyJwtHs256(token, LEGACY_JWT_SECRET), JSON.stringify(token)).toBeNull();
    }
  });

  it('payload 不是 JSON 对象（数组 / null）也能读出', () => {
    expect(verifyJwtHs256(signJwtHs256([1, 2, 3]), LEGACY_JWT_SECRET)).toEqual([1, 2, 3]);
    expect(verifyJwtHs256(signJwtHs256(null), LEGACY_JWT_SECRET)).toBeNull();
  });
});

describe('encodeGameSave / decodeGameSave', () => {
  const game = {
    diamonds: 42,
    playerSlotCount: 2,
    storiesMap: { prologue: 'done' },
    playerMetas: { 'p1': { role: 'Eyer' } },
  };

  it('开发态：明文 JSON 往返', () => {
    const raw = encodeGameSave(game);
    expect(raw.startsWith('{')).toBe(true);
    expect(detectSaveKind(raw)).toBe('json');
    expect(decodeGameSave(raw)).toEqual(game);
  });

  it('生产态：legacyJwt → HS256 JWT 往返', () => {
    const raw = encodeGameSave(game, { legacyJwt: true });
    expect(detectSaveKind(raw)).toBe('jwt');
    expect(decodeGameSave(raw)).toEqual(game);
  });

  it('legacyJwt + 自定义密钥', () => {
    const raw = encodeGameSave(game, { legacyJwt: true, secret: 's3cr3t' });
    expect(decodeGameSave(raw, 's3cr3t')).toEqual(game);
    expect(() => decodeGameSave(raw)).toThrow(/invalid JWT save/);
  });

  it('game 存档：world.stop 的 save blob 也能被 decodeGameSave 识别', () => {
    const blob = worldStop(game, { randomSeed: 11 });
    expect(detectSaveKind(blob)).toBe('save');
    expect(decodeGameSave(blob)).toEqual(game);
  });

  it('无法识别的格式抛错', () => {
    expect(() => decodeGameSave('hello world')).toThrow(/unknown save format/);
    expect(() => decodeGameSave('')).toThrow(/unknown save format/);
    expect(() => decodeGameSave('  ')).toThrow(/unknown save format/);
  });

  it('JSON 语法错误时抛错（由调用方决定是否跳过）', () => {
    expect(() => decodeGameSave('{bad json')).toThrow();
  });

  it('encodeGameSave(undefined) 产出 "null"，且不被识别为存档', () => {
    // JSON.stringify(undefined) === undefined；这里显式退化为 'null'，
    // 但 detectSaveKind 只认以 '{' 开头的对象存档（与原版 game.load 一致）。
    const raw = encodeGameSave(undefined);
    expect(raw).toBe('null');
    expect(detectSaveKind(raw)).toBe('unknown');
    expect(() => decodeGameSave(raw)).toThrow(/unknown save format/);
  });
});

describe('detectSaveKind', () => {
  it('四类判定', () => {
    expect(detectSaveKind('{"a":1}')).toBe('json');
    expect(detectSaveKind('  {"a":1}  ')).toBe('json');
    expect(detectSaveKind('saveAAAA')).toBe('save');
    expect(detectSaveKind(signJwtHs256({ a: 1 }))).toBe('jwt');
    expect(detectSaveKind('what')).toBe('unknown');
    expect(detectSaveKind('e30.e30')).toBe('unknown');
  });

  it('非字符串 / 空串 → unknown', () => {
    for (const value of [undefined, null, 1, {}, [], '']) {
      expect(detectSaveKind(value)).toBe('unknown');
    }
  });
});
