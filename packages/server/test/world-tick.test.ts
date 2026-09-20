/**
 * 世界 tick 聚合与人机接口纯函数单测
 *
 * 覆盖：`world.tick` 合并器（累积事件 / 取最新快照 / 累加 exp·gold）、
 * `battle.loot` 合并器、以及 tick 预算配置的合理性上界。
 */
import { describe, expect, it } from 'vitest';
import type { WorldTickDto } from '@idle-dark/protocol';
import { mergeLoot, mergeWorldTick, WORLD_TICK_MS } from '../src/modules/logic/world/world.service.js';
import { WORLD_CONFIG } from '../src/modules/logic/world/world.config.js';

function tick(partial: Partial<WorldTickDto>): WorldTickDto {
  const out: WorldTickDto = {
    serverTime: partial.serverTime ?? 0,
    units: partial.units ?? [],
    events: partial.events ?? [],
    gainedExp: partial.gainedExp ?? 0,
    gainedGold: partial.gainedGold ?? 0,
  };
  if (partial.wave !== undefined) out.wave = partial.wave;
  if (partial.bossEvery !== undefined) out.bossEvery = partial.bossEvery;
  return out;
}

describe('mergeWorldTick', () => {
  it('prev 为 null/undefined 时原样返回 next', () => {
    const next = tick({ serverTime: 5, gainedExp: 3 });
    expect(mergeWorldTick(null, next)).toEqual(next);
    expect(mergeWorldTick(undefined, next)).toEqual(next);
  });

  it('next 非法时返回 prev', () => {
    const prev = tick({ serverTime: 5 });
    expect(mergeWorldTick(prev, null)).toEqual(prev);
    expect(mergeWorldTick(prev, { hello: 1 })).toEqual(prev);
  });

  it('事件累积、单位取最新、exp/gold 累加、serverTime 取最大', () => {
    const a = tick({
      serverTime: 100,
      units: [{ id: 'u1' } as never],
      events: [{ kind: 'general', text: 'a' }],
      gainedExp: 1,
      gainedGold: 2,
    });
    const b = tick({
      serverTime: 200,
      units: [{ id: 'u2' } as never],
      events: [{ kind: 'general', text: 'b' }],
      gainedExp: 10,
      gainedGold: 20,
    });
    const merged = mergeWorldTick(a, b);
    expect(merged.serverTime).toBe(200);
    expect(merged.units).toEqual([{ id: 'u2' }]);
    expect(merged.events).toHaveLength(2);
    expect(merged.gainedExp).toBe(11);
    expect(merged.gainedGold).toBe(22);
  });

  it('两侧都非法时返回零帧（不抛错）', () => {
    const merged = mergeWorldTick('x', 42);
    expect(merged.units).toEqual([]);
    expect(merged.events).toEqual([]);
    expect(merged.gainedExp).toBe(0);
  });

  it('波次取最新帧（batcher 合并不得回退波数）；缺字段时回落上一帧', () => {
    const a = tick({ serverTime: 100, wave: 3, bossEvery: 20 });
    const b = tick({ serverTime: 200, wave: 4, bossEvery: 20 });
    const merged = mergeWorldTick(a, b);
    expect(merged.wave).toBe(4);
    expect(merged.bossEvery).toBe(20);

    // 最新帧缺 wave / bossEvery（旧客户端 / 旧帧）→ 回落上一帧。
    const c = tick({ serverTime: 300 });
    expect(mergeWorldTick(b, c).wave).toBe(4);
    expect(mergeWorldTick(b, c).bossEvery).toBe(20);
  });
});

describe('mergeLoot', () => {
  it('标量 + 标量 → 数组', () => {
    expect(mergeLoot({ a: 1 }, { b: 2 })).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('数组与标量混用', () => {
    expect(mergeLoot([{ a: 1 }], { b: 2 })).toEqual([{ a: 1 }, { b: 2 }]);
    expect(mergeLoot({ a: 1 }, [{ b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('undefined / null 被忽略', () => {
    expect(mergeLoot(undefined, undefined)).toEqual([]);
    expect(mergeLoot(null, null)).toEqual([]);
    expect(mergeLoot(null, { a: 1 })).toEqual([{ a: 1 }]);
  });
});

describe('WORLD_CONFIG 预算', () => {
  it('tick 间隔在方案建议的 100~200ms 区间内', () => {
    expect(WORLD_TICK_MS).toBeGreaterThanOrEqual(100);
    expect(WORLD_TICK_MS).toBeLessThanOrEqual(200);
  });

  it('预算驱动调度：全局回调/单轮 CPU 预算为正，且硬债务上限有上界（无人头上限）', () => {
    expect(WORLD_CONFIG.callbackBudgetPerCharacterPerTick).toBeGreaterThan(0);
    expect(WORLD_CONFIG.globalCallbackBudgetPerRound).toBeGreaterThanOrEqual(
      WORLD_CONFIG.callbackBudgetPerCharacterPerTick,
    );
    expect(WORLD_CONFIG.maxRoundCpuMs).toBeGreaterThan(0);
    expect(WORLD_CONFIG.worldTimeDebtWarnMs).toBeGreaterThan(0);
    expect(WORLD_CONFIG.worldTimeDebtShedMs).toBeGreaterThanOrEqual(WORLD_CONFIG.worldTimeDebtWarnMs);
    expect(WORLD_CONFIG.worldTimeDebtShedMs).toBeLessThanOrEqual(WORLD_CONFIG.tickIntervalMs * 60);
    // 旧名保留为同一硬上限（语义已从「静默丢弃」改为「显式截断」）
    expect(WORLD_CONFIG.maxCatchUpMs).toBe(WORLD_CONFIG.worldTimeDebtShedMs);
    // 人数语义的上限已被移除（07 T-A2）
    expect('maxCharactersPerTick' in WORLD_CONFIG).toBe(false);
    expect(WORLD_CONFIG.persistIntervalMs).toBeGreaterThanOrEqual(10_000);
  });
});
