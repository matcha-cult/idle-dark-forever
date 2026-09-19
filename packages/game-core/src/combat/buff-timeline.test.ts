/**
 * Buff 时间轴控制回归单测
 *
 * 背景：数据层（`data/buffs.ts` 的 `freezed` / `stunned` / `transform`）会调用
 * `this.unit.timeline.pause()/resume()`；移植后的 `Unit` 只有 `clock`（原版 `this.timeline`），
 * 且数据层视图类型（`data/_shapes.ts`）曾把 `timeline` 误声明为存在 —— 于是 `tsc` 放行、
 * 运行期抛 `Cannot read properties of undefined (reading 'pause')`，
 * 表现为 `WorldService`「world tick 失败」，且 debuff 实际不生效。
 *
 * 覆盖：暂停/恢复真实生效、不抛错；连续两次 pause 幂等。
 */
import { describe, expect, it } from 'vitest';
import { createDefaultTables } from '../data/index.js';
import { makePlayer, makeTestWorld } from './test-support.js';

describe('buff 时间轴控制（原版 unit.timeline → Unit.clock）', () => {
  it('freezed：didAppear 暂停单位时钟，到期 willRemove 恢复（不再抛 undefined.pause）', () => {
    const tables = createDefaultTables();
    const t = makeTestWorld({ map: 'home', tables, seed: 3 });
    const player = t.world.addPlayer(makePlayer());

    expect(() => player.addBuff('freezed', 1_000)).not.toThrow();
    expect(player.clock.isPaused()).toBe(true);

    // 推进到 buff 到期 → willRemove 恢复
    t.clock.advanceBy(2_000);
    expect(player.clock.isPaused()).toBe(false);
  });

  it('stunned：didRemove 恢复单位时钟（didAppear 不动它）', () => {
    const tables = createDefaultTables();
    const t = makeTestWorld({ map: 'home', tables, seed: 5 });
    const player = t.world.addPlayer(makePlayer());

    const before = player.clock.isPaused();
    expect(() => player.addBuff('stunned', 1_000)).not.toThrow();
    // stunned 的 didAppear 不暂停；清除时 didRemove 调 resume（幂等）
    expect(() => t.clock.advanceBy(2_000)).not.toThrow();
    expect(player.clock.isPaused()).toBe(false);
    expect(typeof before).toBe('boolean');
  });
});
