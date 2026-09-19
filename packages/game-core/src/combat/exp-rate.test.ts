/**
 * 角色经验倍率（`BattleWorldOptions.expRate`）单测。
 *
 * 开发环境用 `dev.config.json` → `EXP_RATE` 注入 10 倍经验，因此这里必须钉死三件事：
 * 1. 默认值 = 1（**原版行为不能被调参开关悄悄改掉**）；
 * 2. 配错（0 / 负数 / NaN / Infinity / 非数字）回落 1，而不是让全服经验归零或爆炸；
 * 3. 只放大**经验**，**不能**顺带放大掉落数量（那是 `updateRate` 的职责）。
 */

import { describe, expect, it } from 'vitest';

import { makePlayer, makeTestWorld } from './test-support.js';
import { normalizePositive } from './util.js';
import type { BattleWorld } from './battle-world.js';

function worldWith(options: { expRate?: number; updateRate?: number } = {}): BattleWorld {
  const player = makePlayer();
  const t = makeTestWorld({ seed: 1, player, ...options });
  t.world.addPlayer(player);
  return t.world;
}

/** 最后一次 `sink.exp` 的数值（`PlayerUnit.gotExp` 在衰减与 hook 之后回报）。 */
function lastExp(world: BattleWorld): number | undefined {
  const events = world.sink?.events ?? [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as { kind?: string; amount?: number };
    if (event.kind === 'exp') return event.amount;
  }
  return undefined;
}

function lootCount(world: BattleWorld): number {
  const events = world.sink?.events ?? [];
  return events.filter((e) => (e as { kind?: string }).kind === 'loot').length;
}

describe('normalizePositive（倍率规整）', () => {
  it('有限正数原样通过', () => {
    expect(normalizePositive(10)).toBe(10);
    expect(normalizePositive(0.5)).toBe(0.5);
    expect(normalizePositive(1000)).toBe(1000);
  });

  it('undefined / NaN / Infinity / 0 / 负数 / 非数字 → 回落', () => {
    for (const bad of [undefined, null, Number.NaN, Infinity, -Infinity, 0, -1, '10', {}, []]) {
      expect(normalizePositive(bad, 1)).toBe(1);
    }
    expect(normalizePositive(0, 7)).toBe(7);
  });
});

describe('BattleWorld.expRate', () => {
  it('默认 = 1（不传即原版行为）', () => {
    const world = worldWith();
    expect(world.expRate).toBe(1);
    world.gotExp(100, 1);
    expect(lastExp(world)).toBe(100);
  });

  it('10 倍 → 经验正好 ×10', () => {
    const world = worldWith({ expRate: 10 });
    expect(world.expRate).toBe(10);
    world.gotExp(100, 1);
    expect(lastExp(world)).toBe(1000);
  });

  it('非法值回落 1（配错不该让全服经验归零/爆炸）', () => {
    for (const bad of [0, -5, Number.NaN, Infinity, '10' as unknown as number]) {
      const world = worldWith({ expRate: bad });
      expect(world.expRate).toBe(1);
      world.gotExp(100, 1);
      expect(lastExp(world)).toBe(100);
    }
  });

  it('与 updateRate 相乘（离线快进 × 经验倍率）', () => {
    const world = worldWith({ expRate: 10, updateRate: 2 });
    world.gotExp(100, 1);
    expect(lastExp(world)).toBe(2000);
  });

  it('只放大经验，**不**影响掉落数量（掉落归 updateRate）', () => {
    const world = worldWith({ expRate: 10 });
    world.loots([{ key: 'gold', rate: 1, count: [1, 1] }], 20, 0);
    expect(lootCount(world)).toBe(1);
  });

  it('等级差衰减先于倍率之外照常生效（dis ≥ 10 → 0 经验）', () => {
    const world = worldWith({ expRate: 10 });
    // 玩家 1 级、怪物 20 级 → dis = -19（不倒扣），仍有经验；用怪物 1 级且玩家 11 级验证衰减
    world.player!.level = 11;
    world.gotExp(100, 1); // dis = 10 → 直接 return，不发 exp 事件
    expect(lastExp(world)).toBeUndefined();
  });
});
