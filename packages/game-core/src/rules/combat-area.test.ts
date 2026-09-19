/**
 * `isCombatArea` 边界单测（09 §6.1）
 */
import { describe, expect, it } from 'vitest';
import { isCombatArea } from './combat-area.js';

describe('isCombatArea', () => {
  it('undefined / null → false', () => {
    expect(isCombatArea(undefined)).toBe(false);
    expect(isCombatArea(null)).toBe(false);
  });

  it('isDungeon === true → true（即使没有 monsters）', () => {
    expect(isCombatArea({ isDungeon: true })).toBe(true);
    expect(isCombatArea({ isDungeon: true, monsters: [] })).toBe(true);
  });

  it('有 monsters（非空数组）→ true', () => {
    expect(isCombatArea({ monsters: [{ key: 'dummy' } as never] })).toBe(true);
  });

  it('安全区：无 monsters / 空数组 / 非数组 → false', () => {
    expect(isCombatArea({})).toBe(false);
    expect(isCombatArea({ monsters: [] })).toBe(false);
    expect(isCombatArea({ monsters: undefined })).toBe(false);
    expect(isCombatArea({ monsters: null as never })).toBe(false);
    expect(isCombatArea({ monsters: {} as never })).toBe(false);
  });

  it('isDungeon 非布尔真值 / 假值 → 回落到 monsters 判定', () => {
    expect(isCombatArea({ isDungeon: 1 as never })).toBe(false);
    expect(isCombatArea({ isDungeon: 'true' as never })).toBe(false);
    expect(isCombatArea({ isDungeon: false, monsters: [{ key: 'x' } as never] })).toBe(true);
    expect(isCombatArea({ isDungeon: false })).toBe(false);
  });
});
