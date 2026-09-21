/**
 * 伤害管线逐步单测（任务书门禁 3）：
 * ① 反射 ② 增伤 ③ 减伤 ④ 吸收% ⑤ 护甲 ⑥ 抗性 ⑦ 护盾 ⑧ damaged ⑨ 闪避/暴击事件。
 *
 * 全部使用内联 fixture（`test-support.ts`），不依赖尚未就绪的 `rules/` / `data/`。
 */

import { describe, expect, it } from 'vitest';

import { EnemyUnit } from './enemy-unit.js';
import { makePlayer, makeTestWorld } from './test-support.js';

/**
 * 造一对单位：`from`/`to` 都是 tank（def=50、maxHp=300）。
 * 默认把 `to` 的护甲清零，只有护甲用例显式保留；这样每个用例只考验一步。
 */
function bare(seed = 42, keepDef = false) {
  const t = makeTestWorld({ seed });
  const from = new EnemyUnit(t.world, 'dummy', 0); // dummy 有 melee 技能
  const to = new EnemyUnit(t.world, 'tank', 0);
  t.world.addUnit(from);
  t.world.addUnit(to);
  from.camp = 'enemy';
  to.camp = 'enemy';
  if (!keepDef) {
    from.addAttrHook('def', (() => 0) as never);
    to.addAttrHook('def', (() => 0) as never);
  }
  return { ...t, from, to, skill: from.skills[0]! };
}

describe('sendDamage 管线', () => {
  it('① 反射：shieldReflect 有值 → 对 from 递归结算，to 不承伤', () => {
    const { world, from, to, skill, sink } = bare();
    // 反射链里会 testDodge(from, from)，这里固定不闪避。
    from.addAttrHook('noDodgeRate', (() => 1) as never);
    to.addAttrHook('shieldReflect', (() => 0.5) as never);

    const ret = world.sendDamage('melee', from, to, skill, 100, false);

    expect(ret).toBe(50);
    expect(from.hp).toBe(50); // 100 * 0.5 打到攻击者自己
    expect(to.hp).toBe(300); // 防守方不承伤
    const dmg = sink.events.filter((e) => e.kind === 'damage');
    expect(dmg).toHaveLength(1);
    expect(dmg[0]!.toId).toBe(from.id);
    expect(dmg[0]!.value).toBe(50);
  });

  it('② from.willDamage 增伤', () => {
    const { world, from, to, skill } = bare();
    from.addAttrHook('willDamage', ((v: number) => v * 2) as never);
    const ret = world.sendDamage('melee', from, to, skill, 100, false);
    expect(ret).toBe(200);
    expect(to.hp).toBe(100);
  });

  it('② to.willDamaged 减伤', () => {
    const { world, from, to, skill } = bare();
    to.addAttrHook('willDamaged', ((v: number) => v - 30) as never);
    const ret = world.sendDamage('melee', from, to, skill, 100, false);
    expect(ret).toBe(70);
    expect(to.hp).toBe(230);
  });

  it('③ 吸收百分比：`fireAbsorb` 先扣再进抗性', () => {
    const { world, from, to, skill } = bare();
    // 注意：原版只有 PlayerUnit 定义 `meleeAbsorb`；EnemyUnit 走 `fireAbsorb`。
    to.addAttrHook('fireAbsorb', (() => 0.5) as never);
    const ret = world.sendDamage('fire', from, to, skill, 100, false);
    expect(ret).toBe(50); // (100 - 50) / (1 + fireResist 0 /200)
    expect(to.hp).toBe(250);
  });

  it('③ melee 吸收%在 PlayerUnit 上生效（原版只给玩家定义 meleeAbsorb）', () => {
    const t = makeTestWorld({ seed: 42 });
    const player = makePlayer();
    const unit = t.world.addPlayer(player);
    unit.addAttrHook('def', (() => 0) as never);
    unit.addAttrHook('meleeAbsorb', (() => 0.5) as never);
    const from = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(from);
    from.camp = 'enemy';
    const ret = t.world.sendDamage('melee', from, unit, from.skills[0]!, 100, false);
    expect(ret).toBe(50);
    expect(t.sink.events.find((e) => e.kind === 'damage')!.absorbed).toBe(50);
  });

  it('④ 护甲：melee 走 (value-absorbed)/(1+def/200)', () => {
    const { world, from, to, skill } = bare(42, true);
    expect(to.def).toBe(50); // tank fixture 自带 def=50
    const ret = world.sendDamage('melee', from, to, skill, 100, false);
    expect(ret).toBeCloseTo(80, 10); // 100 / 1.25
  });

  it('④ 抗性：非 melee 走 (value-absorbed)/(1+resist/200)', () => {
    const { world, from, to, skill } = bare();
    to.addAttrHook('fireResist', (() => 200) as never);
    const ret = world.sendDamage('fire', from, to, skill, 100, false);
    expect(ret).toBeCloseTo(50, 10); // 100 / 2
  });

  it('④ 未知伤害系走 resist 分支（不会 NaN）', () => {
    const { world, from, to, skill } = bare();
    const ret = world.sendDamage('poison', from, to, skill, 100, false);
    expect(ret).toBe(100); // poisonResist 不存在 → 0
  });

  it('⑤ 护盾：absorbed hook 吸收的差值累计进 absorbed 并体现在事件里', () => {
    const { world, from, to, skill, sink } = bare();
    to.addAttrHook('absorbed', ((v: number) => v - 20) as never);
    const ret = world.sendDamage('melee', from, to, skill, 100, false);
    expect(ret).toBe(80);
    expect(to.hp).toBe(220);
    const dmg = sink.events.find((e) => e.kind === 'damage')!;
    expect(dmg.absorbed).toBe(20);
    expect(dmg.value).toBe(80);
  });

  it('⑤ damaged hook 在扣血前生效', () => {
    const { world, from, to, skill } = bare();
    to.addAttrHook('damaged', ((v: number) => v + 1) as never);
    const ret = world.sendDamage('melee', from, to, skill, 100, false);
    expect(ret).toBe(101);
    expect(to.hp).toBe(199);
  });

  it('管线顺序不可变：吸收% → 护甲 → 护盾', () => {
    const { world, from, to, skill } = bare();
    to.addAttrHook('fireAbsorb', (() => 0.5) as never); // → 50
    to.addAttrHook('absorbed', ((v: number) => v - 10) as never); // → 40
    const ret = world.sendDamage('fire', from, to, skill, 100, false);
    // (100 - 50) / (1 + 0/200) = 50 → 护盾再吸 10 → 40
    expect(ret).toBeCloseTo(40, 10);
  });

  it('skill 为 null 时不发 damage 事件（对齐原版 message.sendDamage 的 early return）', () => {
    const { world, from, to, sink } = bare();
    world.sendDamage('melee', from, to, null, 100, false);
    expect(sink.events.filter((e) => e.kind === 'damage')).toHaveLength(0);
    expect(to.hp).toBe(200);
  });
});

describe('testDodge / testCrit', () => {
  it('forced dodge 发 dodge 事件并返回 true', () => {
    const { world, from, to, skill, sink } = bare();
    to.addAttrHook('noDodgeRate', (() => -1) as never); // dodgeRate = 2 → 必闪
    expect(world.testDodge(from, to, skill)).toBe(true);
    expect(sink.events.some((e) => e.kind === 'dodge')).toBe(true);
  });

  it('forced no-dodge 返回 false 且不发事件', () => {
    const { world, from, to, skill, sink } = bare();
    to.addAttrHook('noDodgeRate', (() => 1) as never);
    expect(world.testDodge(from, to, skill)).toBe(false);
    expect(sink.events.filter((e) => e.kind === 'dodge')).toHaveLength(0);
  });

  it('testCrit 整数部分必暴、0 必不暴', () => {
    const { from } = bare();
    expect(from.testCrit(2)).toBe(2);
    expect(from.testCrit(0)).toBe(0);
  });

  it('testCrit 的小数部分经 Rng，同种子可重放', () => {
    const a = bare(7);
    const b = bare(7);
    const seqA = Array.from({ length: 10 }, () => a.from.testCrit(0.5));
    const seqB = Array.from({ length: 10 }, () => b.from.testCrit(0.5));
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v === 0 || v === 1)).toBe(true);
  });
});

describe('技能展示名（skillName）', () => {
  it('damage / dodge / heal 事件都带上 `SkillData.name`，而不是数据表键', () => {
    const { world, from, to, skill, sink } = bare();
    // fixture 里 melee 的展示名是 'Melee'
    world.sendDamage('melee', from, to, skill, 10, false);
    const dmg = sink.events.find((e) => e.kind === 'damage')!;
    expect(dmg.skill).toBe('melee');
    expect(dmg.skillName).toBe('Melee');

    // 闪避判定：把闪避率拉到必闪
    to.addAttrHook('noDodgeRate', (() => 0) as never);
    world.testDodge(from, to, skill);
    const dodge = sink.events.find((e) => e.kind === 'dodge')!;
    expect(dodge.skill).toBe('melee');
    expect(dodge.skillName).toBe('Melee');

    world.sendHeal(from, to, skill, 5);
    const heal = sink.events.find((e) => e.kind === 'heal')!;
    expect(heal.skillName).toBe('Melee');
  });

  it('技能表里查不到 / 无技能 → **不带** skillName（调用方回落键本身，缺失可见）', () => {
    const { world, from, to, skill, sink } = bare();
    // 造一个表里不存在的键
    (skill as unknown as { type: string }).type = 'not.in.table';
    world.sendDamage('melee', from, to, skill, 10, false);
    const dmg = sink.events.find((e) => e.kind === 'damage')!;
    expect(dmg.skill).toBe('not.in.table');
    expect('skillName' in dmg).toBe(false);

    // 无技能（null）→ 不发 damage 事件（原版 early return），但 heal 仍应安全
    sink.events.length = 0;
    world.sendHeal(from, to, null, 5);
    const heal = sink.events.find((e) => e.kind === 'heal')!;
    expect(heal.skill).toBe('');
    expect('skillName' in heal).toBe(false);
  });
});
