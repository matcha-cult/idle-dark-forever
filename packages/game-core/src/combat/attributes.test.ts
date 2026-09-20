/**
 * E1 回归：属性三化（力量 / 敏捷 / 智慧，删除耐力 `sta`）+ `maxHp` 去耐力乘子（P3）。
 *
 * 验收点：
 * - 属性是**载入时现算**的（不进存档），换表即换值 —— 无字段迁移；
 * - `maxHp = (50 + 等级×10 + 装备加成) → hooks`，**不再**乘 `(1 + sta/100)`；
 * - 边界：额外 `sta` 残留字段被忽略、NaN / 负数 / 0 / 缺失槽位都不抛错。
 */

import { describe, expect, it } from 'vitest';

import type { EquipmentSlotLike, PlayerLike } from './player-unit.js';
import { makePlayer, makeTestWorld } from './test-support.js';

/** 带 `maxHp` 的饰品（项链）槽。 */
function ornamentSlot(maxHp: number): EquipmentSlotLike {
  return { empty: false, level: 1, atk: 0, atkSpeed: 0, def: 0, maxHp, affixes: [] };
}

function withExtraSta(player: PlayerLike, value: number): PlayerLike {
  // 模拟「老存档 / 外部数据里仍带 sta」——运行期必须被安全忽略。
  (player.roleData.attrBase as Record<string, number>).sta = value;
  (player.careerData.attrGrow as Record<string, number>).sta = value;
  return player;
}

describe('E1 属性三化', () => {
  it('三维按 `attrBase + attrGrow × level` 现算（Q8 删巅峰后无额外等级项）', () => {
    const t = makeTestWorld({ seed: 1 });
    const player = makePlayer({
      level: 10,
      roleData: { key: 'hero', attrBase: { str: 5, dex: 6, int: 7 }, atk: 10, atkSpeed: 1 },
      careerData: {
        key: 'warrior',
        passives: {},
        attrGrow: { str: 2, dex: 3, int: 5 },
        availableClasses: {},
      },
    });
    const unit = t.world.addPlayer(player);
    // 5 + 2*10 = 25 / 6 + 3*10 = 36 / 7 + 5*10 = 57
    expect(unit.str).toBe(25);
    expect(unit.dex).toBe(36);
    expect(unit.int).toBe(57);
  });

  it('内核不再提供 `sta` getter（残留字段不产生属性）', () => {
    const t = makeTestWorld({ seed: 2 });
    const player = withExtraSta(makePlayer(), 12345);
    const unit = t.world.addPlayer(player);
    expect((unit as unknown as Record<string, unknown>).sta).toBeUndefined();
  });

  it('`maxHp` = 50 + 等级×10，且**不受**残留 `sta` 影响', () => {
    const t1 = makeTestWorld({ seed: 3 });
    const normal = t1.world.addPlayer(makePlayer({ level: 1 }));
    expect(normal.maxHp).toBe(60);

    const t2 = makeTestWorld({ seed: 4 });
    const huge = t2.world.addPlayer(withExtraSta(makePlayer({ level: 1 }), 999999));
    expect(huge.maxHp).toBe(60);
  });

  it('`maxHp` 叠加饰品加成，再走 maxHp / maxHpMul / maxHpAdd hooks', () => {
    const t = makeTestWorld({ seed: 5 });
    const player = makePlayer({ level: 5 });
    player.equipments.amulet = ornamentSlot(40);
    const unit = t.world.addPlayer(player);
    unit.addAttrHook('maxHp', ((v: number) => v + 100) as never);
    unit.addAttrHook('maxHpMul', ((v: number) => v * 2) as never);
    unit.addAttrHook('maxHpAdd', ((v: number) => v + 1) as never);
    // ((50 + 50 + 40) + 100) * 2 * (1 + 1) = 960
    expect(unit.maxHp).toBe(960);
  });

  it('边界：level 0 / 负数装备 maxHp / NaN 残留 sta 均不抛错', () => {
    const t = makeTestWorld({ seed: 6 });
    const player = makePlayer({ level: 0 });
    player.equipments.amulet = ornamentSlot(-100);
    withExtraSta(player, Number.NaN);
    const unit = t.world.addPlayer(player);
    expect(unit.maxHp).toBe(50 - 100); // 装备加成原样参与（负数由数据保证，不在内核夹取）

    const t2 = makeTestWorld({ seed: 7 });
    const p2 = makePlayer({ level: 0 });
    p2.equipments.amulet = undefined as unknown as EquipmentSlotLike;
    expect(t2.world.addPlayer(p2).maxHp).toBe(50);
  });

  it('边界：attrBase / attrGrow 含 NaN 时属性为 NaN 但不抛错（不静默夹取）', () => {
    const t = makeTestWorld({ seed: 8 });
    const player = makePlayer({
      roleData: { key: 'hero', attrBase: { str: Number.NaN, dex: -1, int: 0 }, atk: 10, atkSpeed: 1 },
    });
    const unit = t.world.addPlayer(player);
    // 属性是 `attrBase + attrGrow × level`：角色默认 attrGrow 各 1、level 1。
    expect(Number.isNaN(unit.str)).toBe(true); // NaN + 1
    expect(unit.dex).toBe(0); // -1 + 1
    expect(unit.int).toBe(1); // 0 + 1
  });
});

describe('E4 护甲槽位泛化：def 不再只读胸甲/护腿', () => {
  const armor = (def: number): EquipmentSlotLike => ({
    empty: false,
    level: 1,
    atk: 0,
    atkSpeed: 0,
    def,
    maxHp: 0,
    affixes: [],
  });

  it('胸甲 + 手套 + 腰带 + 鞋子的 def 全部计入（+ 力量）', () => {
    const t = makeTestWorld({ seed: 12 });
    const player = makePlayer();
    player.equipments.plastron = armor(10);
    player.equipments.gloves = armor(4);
    player.equipments.belt = armor(3);
    player.equipments.boots = armor(2);
    const unit = t.world.addPlayer(player);
    // makePlayer: str = 5 + 1×(level 1) = 6；def = 装备和 + str。
    expect(unit.def).toBe(10 + 4 + 3 + 2 + 6);
  });

  it('饰品的 maxHp 计入（项链 + 两枚戒指）', () => {
    const t = makeTestWorld({ seed: 13 });
    const player = makePlayer();
    player.equipments.amulet = { ...armor(0), maxHp: 30 };
    player.equipments.ring1 = { ...armor(0), maxHp: 20 };
    player.equipments.ring2 = { ...armor(0), maxHp: 10 };
    const unit = t.world.addPlayer(player);
    expect(unit.maxHp).toBe(50 + 10 + 30 + 20 + 10);
  });
});
