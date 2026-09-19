/**
 * 旧存档解析单测（三种编码 + 错误路径）
 */
import { describe, expect, it } from 'vitest';
import {
  LEGACY_JWT_SECRET,
  signJwtHs256,
  worldStop,
} from '@idle-dark/game-core';
import {
  looksLikePlayerState,
  parseLegacyPlayerSave,
} from '../src/modules/logic/player/internal/save-import.js';

const PLAYER_STATE = {
  role: 'Eyer',
  currentCareer: 'warrior',
  gold: 12345,
  level: 7,
  careers: { warrior: { type: 'warrior', level: 7, exp: 3 } },
  inventory: [{ key: 'gold', count: 1 }],
};

describe('parseLegacyPlayerSave', () => {
  it('明文 JSON → kind=json，且 role 被读出', () => {
    const result = parseLegacyPlayerSave(JSON.stringify(PLAYER_STATE));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('json');
    expect(result.role).toBe('Eyer');
    expect(result.state).toMatchObject({ gold: 12345 });
  });

  it("'save'+base64 混淆 → kind=save，round-trip 与原对象深度相等", () => {
    const encoded = worldStop(PLAYER_STATE, { randomSeed: 7 });
    const result = parseLegacyPlayerSave(encoded);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('save');
    expect(result.state).toEqual(PLAYER_STATE);
  });

  it('HS256 JWT（正确密钥）→ kind=jwt', () => {
    const token = signJwtHs256(PLAYER_STATE, { secret: LEGACY_JWT_SECRET });
    const result = parseLegacyPlayerSave(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe('jwt');
    expect(result.state).toMatchObject({ gold: 12345 });
  });

  it('JWT 错误密钥 → SAVE_IMPORT_UNSUPPORTED', () => {
    const token = signJwtHs256(PLAYER_STATE, { secret: 'wrong-secret' });
    const result = parseLegacyPlayerSave(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SAVE_IMPORT_UNSUPPORTED');
  });

  it('账号级 JWT（无角色字段）→ SAVE_IMPORT_UNSUPPORTED', () => {
    const token = signJwtHs256({ diamonds: 5, storiesMap: {} }, { secret: LEGACY_JWT_SECRET });
    const result = parseLegacyPlayerSave(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SAVE_IMPORT_UNSUPPORTED');
  });

  it('包装对象 {player: …} 会被解包', () => {
    const result = parseLegacyPlayerSave(JSON.stringify({ player: PLAYER_STATE }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toMatchObject({ role: 'Eyer' });
  });

  it('明文 JSON 但结构不完整 → SAVE_IMPORT_INVALID', () => {
    const result = parseLegacyPlayerSave(JSON.stringify({ foo: 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SAVE_IMPORT_INVALID');
  });

  it('损坏的 save blob → SAVE_IMPORT_INVALID', () => {
    const good = worldStop(PLAYER_STATE, { randomSeed: 1 });
    const broken = good.slice(0, good.length - 3) + 'AAA';
    const result = parseLegacyPlayerSave(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SAVE_IMPORT_INVALID');
  });

  it('无法识别的格式 → SAVE_IMPORT_INVALID', () => {
    expect(parseLegacyPlayerSave('!!!not-a-save!!!').ok).toBe(false);
    expect(parseLegacyPlayerSave('save').ok).toBe(false);
  });

  it('空 / 非字符串 / null / undefined / 超大输入边界', () => {
    for (const bad of ['', '   ', null, undefined, 123, {}, [], true]) {
      const result = parseLegacyPlayerSave(bad);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe('SAVE_IMPORT_INVALID');
    }
  });

  it('大字符串（>1MB）不会抛异常', () => {
    const big = 'x'.repeat(1_100_000);
    const result = parseLegacyPlayerSave(big);
    expect(result.ok).toBe(false);
  });

  it('looksLikePlayerState 判定边界', () => {
    expect(looksLikePlayerState(PLAYER_STATE)).toBe(true);
    expect(looksLikePlayerState({ role: 'Eyer' })).toBe(true);
    expect(looksLikePlayerState({ careers: {} })).toBe(true);
    expect(looksLikePlayerState({})).toBe(false);
    expect(looksLikePlayerState(null)).toBe(false);
    expect(looksLikePlayerState([])).toBe(false);
    expect(looksLikePlayerState('Eyer')).toBe(false);
  });
});
