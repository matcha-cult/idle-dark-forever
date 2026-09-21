/**
 * 边界与鲁棒性单测（任务书门禁 2）：
 * 0 攻速 / 0 血量 / 负伤害 / 空技能表 / 无目标 / 死亡后仍被攻击 /
 * Buff 叠加超上限 / 召唤链循环 / `stepPaused` 预算耗尽。
 */

import { describe, expect, it } from 'vitest';

import { EnemyUnit } from './enemy-unit.js';
import { PlayerUnit } from './player-unit.js';
import { makePlayer, makeTestWorld } from './test-support.js';
import { VirtualClock } from '../sim/clocks.js';

describe('边界：资源与属性', () => {
  it('0 攻速：普攻永不就绪，且调度不会因 Infinity 延迟崩溃', () => {
    const t = makeTestWorld({ seed: 1 });
    const u = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(u);
    u.addAttrHook('atkSpeed', (() => 0) as never);
    u.camp = 'enemy';
    u.setAttackCoolDown();
    expect(u.attackCooledDown).toBe(false);
    expect(() => t.clock.advanceBy(10000)).not.toThrow();
    expect(u.attackCooledDown).toBe(false);
  });

  it('0 血量：setter 夹取到 0，再受击仍是 0 且进入 ghost', () => {
    const t = makeTestWorld({ seed: 1 });
    const u = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(u);
    u.camp = 'enemy';
    u.hp = 0;
    expect(u.hp).toBe(0);
    const from = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(from);
    from.camp = 'enemy';
    t.world.sendDamage('melee', from, u, from.skills[0]!, 50, false);
    expect(u.hp).toBe(0);
    expect(u.camp).toBe('ghost');
  });

  it('血量夹取上限：超额治疗不会突破 maxHp', () => {
    const t = makeTestWorld({ seed: 1 });
    const u = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(u);
    u.camp = 'enemy';
    u.hp = 100;
    t.world.sendHeal(null, u, null, 1e9);
    expect(u.hp).toBe(u.maxHp);
  });

  it('maxHp 为 0 时 hp 保持 0（不产生 NaN/负数）', () => {
    const t = makeTestWorld({ seed: 1 });
    const u = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(u);
    u.camp = 'enemy';
    u.addAttrHook('maxHp', (() => 0) as never);
    u.hp = 10;
    expect(u.hp).toBe(0);
  });
});

describe('边界：伤害', () => {
  it('负伤害 = 治疗（原版未做符号校验），并在 maxHp 处夹取', () => {
    const t = makeTestWorld({ seed: 1 });
    const from = new EnemyUnit(t.world, 'dummy', 0);
    const to = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(from);
    t.world.addUnit(to);
    from.camp = 'enemy';
    to.camp = 'enemy';
    to.hp = 50;
    const ret = t.world.sendDamage('melee', from, to, from.skills[0]!, -30, false);
    expect(ret).toBe(-30);
    expect(to.hp).toBe(80);

    // 再打一发大的负数，夹取到 maxHp
    t.world.sendDamage('melee', from, to, from.skills[0]!, -1e6, false);
    expect(to.hp).toBe(to.maxHp);
  });

  it('死亡单位不再承伤（camp=ghost 短路）', () => {
    const t = makeTestWorld({ seed: 1 });
    const from = new EnemyUnit(t.world, 'dummy', 0);
    const to = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(from);
    t.world.addUnit(to);
    from.camp = 'enemy';
    to.camp = 'enemy';
    to.hp = 30;
    to.kill();
    expect(to.camp).toBe('ghost');
    const ret = t.world.sendDamage('melee', from, to, from.skills[0]!, 50, false);
    expect(ret).toBe(50); // sendDamage 仍返回值（原版行为）
    // 原版 `kill()` 不清 hp，只把 camp 变 ghost；因此这里 hp 停在死亡前那一刻。
    expect(to.hp).toBe(30);
  });

  it('NaN 伤害传播为 NaN（原版同样不校验；记录为已知边界）', () => {
    // ⚠️ 引擎**不做取整与校验**（与原版一致）：调用方不应传 NaN。
    // 「不出现小数伤害」是展示层的事（`Math.round`），不要拿运行期数值去兜。
    const t = makeTestWorld({ seed: 1 });
    const from = new EnemyUnit(t.world, 'dummy', 0);
    const to = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(from);
    t.world.addUnit(to);
    from.camp = 'enemy';
    to.camp = 'enemy';
    const ret = t.world.sendDamage('melee', from, to, from.skills[0]!, NaN, false);
    expect(Number.isNaN(ret)).toBe(true);
    // hp setter 的 Math.min/max 会把 NaN 规整为 NaN → 说明调用方不应传 NaN。
    expect(Number.isNaN(to.hp)).toBe(true);
  });
});

describe('边界：技能表与目标', () => {
  it('空技能表：canUseSkill 返回 null，调度与推进不抛错', () => {
    const t = makeTestWorld({ seed: 1 });
    const u = new EnemyUnit(t.world, 'noSkill', 0);
    t.world.addUnit(u);
    u.camp = 'enemy';
    expect(u.skills).toHaveLength(0);
    expect(u.canUseSkill()).toBeNull();
    expect(() => t.clock.advanceBy(5000)).not.toThrow();
  });

  it('无目标：findTarget 得到 null，技能 effect 的 null 目标路径安全', () => {
    const t = makeTestWorld({ seed: 1 });
    const u = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(u);
    u.camp = 'enemy';
    u.findTarget();
    expect(u.target).toBeNull();
    expect(() => t.clock.advanceBy(5000)).not.toThrow();
  });

  it('setTarget 到 ghost 目标会立即重新选目标（替代原版 autorun）', () => {
    const t = makeTestWorld({ seed: 1 });
    const u = new EnemyUnit(t.world, 'dummy', 0);
    const ghost = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(u);
    t.world.addUnit(ghost);
    u.camp = 'enemy';
    ghost.kill();
    u.setTarget(ghost);
    expect(u.target).toBeNull();
  });

  it('removeSkill 对不存在的技能是 no-op（不误删最后一个）', () => {
    const t = makeTestWorld({ seed: 1 });
    const u = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(u);
    const before = u.skills.length;
    u.removeSkill('not-exist');
    expect(u.skills).toHaveLength(before);
  });
});

describe('边界：Buff 叠加', () => {
  function makeUnit() {
    const t = makeTestWorld({ seed: 1 });
    const u = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(u);
    u.camp = 'enemy';
    return { t, u };
  }

  it('同组 maxStack=2：第三次叠加仍保持 2 层', () => {
    const { u } = makeUnit();
    u.addBuff('stacktest', 1000, null, 'g', 2);
    u.addBuff('stacktest', 2000, null, 'g', 2);
    u.addBuff('stacktest', 3000, null, 'g', 2);
    expect(u.buffs.filter((b) => b.group === 'g')).toHaveLength(2);
  });

  it('同组同类型重复叠加：复用旧 Buff 并重置计时', () => {
    const { u } = makeUnit();
    const a = u.addBuff('stacktest', 1000, null, 'g', 1);
    const b = u.addBuff('stacktest', 5000, null, 'g', 1);
    expect(b).toBe(a);
    expect(u.buffs).toHaveLength(1);
  });

  it('无 group：允许无限叠加', () => {
    const { u } = makeUnit();
    u.addBuff('stacktest', 1000);
    u.addBuff('stacktest', 1000);
    u.addBuff('stacktest', 1000);
    expect(u.buffs).toHaveLength(3);
  });

  it('maxStack=0/负数时不崩溃', () => {
    const { u } = makeUnit();
    expect(() => u.addBuff('stacktest', 1000, null, 'g', 0)).not.toThrow();
    expect(() => u.addBuff('stacktest', 1000, null, 'g', -1)).not.toThrow();
  });

  it('stunned hook 让 canUseSkill 短路', () => {
    const { u } = makeUnit();
    u.addBuff('stun', 1000);
    expect(u.canUseSkill()).toBeNull();
  });
});

describe('边界：召唤链与离线推进', () => {
  it('召唤链成环时 onMapChanged 不会死循环（原版会）', () => {
    const t = makeTestWorld({ seed: 1 });
    const team = makePlayer();
    const p = t.world.addPlayer(team);
    const a = new EnemyUnit(t.world, 'dummy', 0);
    const b = new EnemyUnit(t.world, 'dummy', 0);
    t.world.addUnit(a);
    t.world.addUnit(b);
    a.camp = 'enemy';
    b.camp = 'enemy';
    a.summoner = b;
    b.summoner = a; // 环
    expect(p).toBeTruthy();
    expect(() => t.world.onMapChanged()).not.toThrow();
    // 两个敌人都应被移除，玩家保留。
    expect(t.world.units).toContain(t.world.playerUnit);
    expect(t.world.units).not.toContain(a);
    expect(t.world.units).not.toContain(b);
  });

  it('stepPaused：预算耗尽时中断并返回剩余毫秒，继续推进可归零', () => {
    const t = makeTestWorld({ seed: 3, map: 'field' });
    const p = t.world.addPlayer(makePlayer());
    t.world.onMapChanged();
    expect(p).toBeTruthy();

    t.clock.pause();
    const first = t.clock.stepPaused(30000, 2);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(30000);

    // 分片推完
    let rest = first;
    let guard = 0;
    while (rest > 0 && guard < 100000) {
      rest = t.clock.stepPaused(rest, 5000);
      guard += 1;
    }
    expect(rest).toBe(0);
    t.clock.resume();
    expect(() => t.clock.advanceBy(1000)).not.toThrow();
  });

  it('callbacksUsed：记录上一次推进实际执行的回调数（全局预算记账；budget=0 / 空到期边界）', () => {
    const clock = new VirtualClock();
    let fired = 0;
    clock.setTimeout(() => {
      fired += 1;
    }, 100);
    clock.setTimeout(() => {
      fired += 1;
    }, 200);
    clock.setTimeout(() => {
      fired += 1;
    }, 900);

    // 尚未推进 → 0
    expect(clock.callbacksUsed()).toBe(0);

    // 只到期 1 个
    expect(clock.advanceBy(150, 10)).toBe(0);
    expect(fired).toBe(1);
    expect(clock.callbacksUsed()).toBe(1);

    // budget = 0 → 一个都不执行，返回剩余毫秒
    expect(clock.advanceBy(50, 0)).toBeGreaterThan(0);
    expect(clock.callbacksUsed()).toBe(0);

    // 无到期回调 → 0（不产生 NaN / 负数）
    expect(clock.advanceBy(0, 10)).toBe(0);
    expect(clock.callbacksUsed()).toBe(0);

    // 推完剩余：本次执行 2 个
    expect(clock.advanceBy(100_000, 10)).toBe(0);
    expect(fired).toBe(3);
    expect(clock.callbacksUsed()).toBe(2);

    // 非法 budget（NaN / 负数）回落默认，不抛错
    clock.setTimeout(() => {
      fired += 1;
    }, 1);
    expect(() => clock.advanceBy(10, Number.NaN)).not.toThrow();
    expect(fired).toBe(4);
  });

  it('dumpState → load 到新世界可继续推进（定时器按剩余时间重建）', () => {
    const t = makeTestWorld({ seed: 5, map: 'field' });
    t.world.addPlayer(makePlayer());
    t.world.onMapChanged();
    t.clock.advanceBy(3000); // 玩家仍存活、正在与第一只 dummy 交火
    const state = t.world.dumpState();

    const t2 = makeTestWorld({ seed: 5, map: 'field' });
    t2.world.load(makePlayer(), state as never);
    expect(t2.world.units.length).toBe(t.world.units.length);
    expect(t2.world.playerUnit).toBeTruthy();
    expect(() => t2.clock.advanceBy(3000)).not.toThrow();
    // 恢复后仍能正常结算伤害事件。
    expect(t2.sink.events.some((e) => e.kind === 'damage')).toBe(true);
  });

  it('dumpState 只含 JSON 可序列化数据（不含定时器句柄）', () => {
    const t = makeTestWorld({ seed: 3, map: 'field' });
    t.world.addPlayer(makePlayer());
    t.world.onMapChanged();
    t.clock.advanceBy(5000);
    const state = t.world.dumpState();
    const json = JSON.stringify(state);
    expect(typeof json).toBe('string');
    expect(json).not.toContain('[object Object]');
    const parsed = JSON.parse(json) as { units: unknown[] };
    expect(Array.isArray(parsed.units)).toBe(true);
    expect(parsed.units.length).toBeGreaterThan(0);
  });
});

describe('边界：攻速 → 时钟倍率显式刷新', () => {
  it('装备/被动改变后 refreshSpeedRate 反映到 clock.getRate()', () => {
    const t = makeTestWorld({ seed: 1 });
    const player = makePlayer();
    const unit = new PlayerUnit(t.world, player);
    const before = unit.clock.getRate();
    unit.addAttrHook('speedRateMul', ((v: number) => v * 2) as never);
    unit.refreshSpeedRate();
    expect(unit.clock.getRate()).toBe(before * 2);
  });
});
