/**
 * E5.5：双持交替攻击 + 攻速受限（P12）。
 *
 * 口径（§2.3 定稿）：每次出手的**基准攻速取自该手武器的底材**，两只手轮流出手，
 * 因此双持的总节奏**不等于**两把武器攻速之和。
 */
import { describe, expect, it } from 'vitest';

import type { EquipmentSlotLike, PlayerUnit } from './player-unit.js';
import { makePlayer, makeTestWorld, type TestWorld } from './test-support.js';

function hand(
  atk: number,
  atkSpeed: number,
  equipCategory: string,
): EquipmentSlotLike {
  return {
    empty: false,
    level: 10,
    atk,
    atkSpeed,
    def: 0,
    maxHp: 0,
    affixes: [],
    goodData: { type: 'equip', class: 'sword', equipCategory },
  };
}

function playerWith(t: TestWorld, main: EquipmentSlotLike | null, off: EquipmentSlotLike | null): PlayerUnit {
  const player = makePlayer();
  player.equipments.weapon = main ?? { empty: true, level: 0, atk: 0, atkSpeed: 0, def: 0, maxHp: 0, affixes: [] };
  player.equipments.offHand = off ?? { empty: true, level: 0, atk: 0, atkSpeed: 0, def: 0, maxHp: 0, affixes: [] };
  return t.world.addPlayer(player);
}

describe('E5.5 双持交替攻击', () => {
  it('两手轮流出手，每次用该手武器的 atk', () => {
    const t = makeTestWorld({ seed: 31 });
    const unit = playerWith(t, hand(5, 2, 'oneHand'), hand(7, 4, 'oneHand'));
    expect(unit.isDualWielding()).toBe(true);
    expect(unit.activeHand).toBe('main');
    expect(unit.atk).toBe(5);

    // 第一次出手后进入冷却（仍记主手）→ 冷却结束换副手。
    unit.setAttackCoolDown();
    expect(unit.activeHand).toBe('main');
    t.clock.advanceBy(501);
    expect(unit.activeHand).toBe('off');
    expect(unit.atk).toBe(7);

    unit.setAttackCoolDown();
    t.clock.advanceBy(251);
    expect(unit.activeHand).toBe('main');
    expect(unit.atk).toBe(5);
  });

  it('每次冷却取该手武器攻速（不是两手之和）', () => {
    const t = makeTestWorld({ seed: 32 });
    const unit = playerWith(t, hand(5, 2, 'oneHand'), hand(7, 4, 'oneHand'));

    // 主手出手 → 1000/2 = 500ms
    unit.setAttackCoolDown();
    expect(unit.attackCooledDown).toBe(false);
    t.clock.advanceBy(500);
    expect(unit.attackCooledDown).toBe(false);
    t.clock.advanceBy(1);
    expect(unit.attackCooledDown).toBe(true);

    // 副手出手 → 1000/4 = 250ms（若按「两手之和 6」会是 167ms，防退化）
    unit.setAttackCoolDown();
    t.clock.advanceBy(250);
    expect(unit.attackCooledDown).toBe(false);
    t.clock.advanceBy(1);
    expect(unit.attackCooledDown).toBe(true);

    // 总节奏 = 500 + 250 = 750ms / 2 次出手，而非 1000/(2+4) = 167ms。
    expect(1000 / 2 + 1000 / 4).toBe(750);
  });

  it('atkSpeed / atkSpeedOf 随当前手变化', () => {
    const t = makeTestWorld({ seed: 33 });
    const unit = playerWith(t, hand(5, 2, 'oneHand'), hand(7, 4, 'oneHand'));
    expect(unit.atkSpeed).toBe(2);
    expect(unit.atkSpeedOf('off')).toBe(4);
    unit.setAttackCoolDown();
    t.clock.advanceBy(501);
    expect(unit.atkSpeed).toBe(4);
  });

  it('非双持不进入交替：单手 / 双手 / 副手非武器都恒用主手', () => {
    const cases: Array<[EquipmentSlotLike | null, EquipmentSlotLike | null]> = [
      [hand(5, 2, 'oneHand'), null],
      [hand(5, 2, 'twoHandMelee'), null],
      [hand(5, 2, 'bow'), null],
      [hand(5, 2, 'oneHand'), hand(0, 1, 'shield')],
      [hand(5, 2, 'oneHand'), hand(0, 1, 'quiver')],
    ];
    for (const [main, off] of cases) {
      const t = makeTestWorld({ seed: 34 });
      const unit = playerWith(t, main, off);
      expect(unit.isDualWielding()).toBe(false);
      unit.setAttackCoolDown();
      t.clock.advanceBy(1000);
      expect(unit.activeHand).toBe('main');
    }
  });
});
