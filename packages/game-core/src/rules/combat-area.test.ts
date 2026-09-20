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

  it('monsters 非数组真值 → false（不回落到其它字段）', () => {
    expect(isCombatArea({ monsters: 1 as never })).toBe(false);
    expect(isCombatArea({ monsters: 'true' as never })).toBe(false);
    expect(isCombatArea({ monsters: false as never })).toBe(false);
  });
});
