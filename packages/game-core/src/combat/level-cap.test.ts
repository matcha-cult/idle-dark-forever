/**
 * W3 等级上限 100 边界单测（Q8）。
 *
 * 钉死三件事：
 *  1. `PlayerUnit.levelUp` 绝不把等级推过 `maxLevel`；
 *  2. 满级后获得的经验被丢弃（不改变 level / exp），也**不再产生任何巅峰轨迹**；
 *  3. 经验事件 / 单位上都不存在 `peak` 字段。
 */

import { describe, expect, it } from 'vitest';

import { makePlayer, makeTestWorld } from './test-support.js';

describe('等级上限 100（Q8）', () => {
  it('升级到满级后不再累积经验（溢出丢弃）', () => {
    const player = makePlayer({ level: 99, maxLevel: 100, exp: 0, maxExp: 100 });
    const t = makeTestWorld({ seed: 11, player });
    t.world.addPlayer(player);

    // W10 起经验不再有等级差衰减；第二个参数只是冻结端口契约的一部分。
    t.world.gotExp(100, 99);
    expect(player.level).toBe(100);
    expect(player.exp).toBe(0);

    // 满级后继续获得经验：等级与经验都不变。
    t.world.gotExp(1_000_000, 100);
    expect(player.level).toBe(100);
    expect(player.exp).toBe(0);
  });

  it('直接调用 levelUp 也不会超过 maxLevel', () => {
    const player = makePlayer({ level: 100, maxLevel: 100, exp: 0, maxExp: 100 });
    const t = makeTestWorld({ seed: 12, player });
    const unit = t.world.addPlayer(player);
    unit.levelUp();
    unit.levelUp();
    expect(player.level).toBe(100);
    expect(player.exp).toBe(0);
  });

  it('升到满级时把溢出清空（不会留下半截经验条）', () => {
    const player = makePlayer({ level: 99, maxLevel: 100, exp: 90, maxExp: 100 });
    const t = makeTestWorld({ seed: 13, player });
    t.world.addPlayer(player);
    t.world.gotExp(50, 99);
    expect(player.level).toBe(100);
    expect(player.exp).toBe(0);
  });

  it('经验事件 / 单位上不存在 peak 字段', () => {
    const player = makePlayer({ level: 100, maxLevel: 100, exp: 0, maxExp: 100 });
    const t = makeTestWorld({ seed: 14, player });
    const unit = t.world.addPlayer(player);
    t.world.gotExp(100, 100);

    const events = t.world.sink?.events ?? [];
    expect(JSON.stringify(events).toLowerCase().includes('peak')).toBe(false);
    expect('peakLevel' in unit).toBe(false);
    expect('peakExp' in unit).toBe(false);
    expect('maxPeakExp' in unit).toBe(false);
    expect('levelUpPeak' in unit).toBe(false);
  });
});
