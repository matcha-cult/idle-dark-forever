/**
 * E5：混沌非元素 + 词缀作用域二元划分（区域词缀 vs 全局词缀）。
 */
import { describe, expect, it } from 'vitest';

import { EnemyUnit } from './enemy-unit.js';
import type { EquipmentSlotLike } from './player-unit.js';
import { makePlayer, makeTestWorld } from './test-support.js';

function weaponSlot(
  affixes: EquipmentSlotLike['affixes'],
  atk = 5,
): EquipmentSlotLike {
  return { empty: false, level: 10, atk, atkSpeed: 1, def: 0, maxHp: 0, affixes };
}

const atkAffix = (value: number): EquipmentSlotLike['affixes'][number] => ({
  affixData: { hooks: { atk: (effect: number, current: number) => current + effect } },
  value,
});

describe('E5 混沌非元素', () => {
  it('chaosResist 不含 allResist（智力），fireResist 含', () => {
    const t = makeTestWorld({ seed: 21 });
    const player = makePlayer({
      level: 0,
      roleData: { key: 'hero', attrBase: { str: 0, dex: 0, int: 50 }, atk: 10, atkSpeed: 1 },
      careerData: {
        key: 'warrior',
        passives: {},
        attrGrow: { str: 0, dex: 0, int: 0 },
        availableClasses: {},
      },
    });
    const unit = t.world.addPlayer(player);
    expect(unit.allResist).toBe(50);
    expect(unit.fireResist).toBe(50);
    expect(unit.chaosResist).toBe(0);
    expect(unit.chaosAbsorb).toBe(0);
  });

  it('sendDamage：混沌不吃 allResist，火抗正常减免', () => {
    const t = makeTestWorld({ seed: 22 });
    const from = new EnemyUnit(t.world, 'dummy', 0);
    const player = makePlayer({
      level: 0,
      roleData: { key: 'hero', attrBase: { str: 0, dex: 0, int: 50 }, atk: 10, atkSpeed: 1 },
      careerData: {
        key: 'warrior',
        passives: {},
        attrGrow: { str: 0, dex: 0, int: 0 },
        availableClasses: {},
      },
    });
    const unit = t.world.addPlayer(player);
    const skill = from.skills[0]!;
    // 混沌：无减免 → 全额
    expect(t.world.sendDamage('chaos', from, unit, skill, 100, false)).toBeCloseTo(100, 6);
    // 火：allResist = 50 → 100/(1+50/200) = 80
    expect(t.world.sendDamage('fire', from, unit, skill, 100, false)).toBeCloseTo(80, 6);
  });
});

describe('E5 词缀作用域（P12）', () => {
  it('武器词缀是区域词缀：副手武器词缀不影响主手 atk', () => {
    const t = makeTestWorld({ seed: 23 });
    const player = makePlayer();
    player.equipments.weapon = weaponSlot([atkAffix(7)], 5);
    player.equipments.offHand = weaponSlot([atkAffix(100)], 5);
    const unit = t.world.addPlayer(player);
    expect(unit.atk).toBe(12); // 5 + 7（主手）
    expect(unit.atkOf('off')).toBe(105); // 5 + 100（副手）
  });

  it('同一词缀放防具 → 全局生效（挂 Unit）', () => {
    const t = makeTestWorld({ seed: 24 });
    const player = makePlayer();
    player.equipments.weapon = weaponSlot([], 5);
    player.equipments.plastron = {
      empty: false,
      level: 10,
      atk: 0,
      atkSpeed: 0,
      def: 0,
      maxHp: 0,
      affixes: [atkAffix(7)],
    };
    const unit = t.world.addPlayer(player);
    expect(unit.atk).toBe(12); // 主手 5 + 防具全局 +7
  });

  it('atkSpeedOf：基准取自该手武器底材（双持总节奏 ≠ 两把之和）', () => {
    const t = makeTestWorld({ seed: 25 });
    const player = makePlayer();
    player.equipments.weapon = { ...weaponSlot([], 5), atkSpeed: 2 };
    player.equipments.offHand = { ...weaponSlot([], 5), atkSpeed: 4 };
    const unit = t.world.addPlayer(player);
    expect(unit.atkSpeedOf('main')).toBe(2);
    expect(unit.atkSpeedOf('off')).toBe(4);
    expect(unit.atkSpeed).toBe(2); // 默认主手
    expect(unit.atkSpeedOf('main')).not.toBe(unit.atkSpeedOf('main') + unit.atkSpeedOf('off'));
  });
});
