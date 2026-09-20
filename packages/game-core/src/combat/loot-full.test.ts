/**
 * 掉落上报必须**如实反映入包数量**（回归：「看到获得提示但背包里没有」）。
 *
 * `BattleWorld.lootGood` 旧实现先发 `sink.loot` 再调 `player.loot`，包裹满时
 * `Player.loot` 静默丢弃，提示却照发。现在改为先落地、按 `PlayerLike.loot` 的返回值上报：
 * `0` → `handled:'lost'`；部分入包 → 补发一条 `'lost'`。
 */
import { describe, expect, it } from 'vitest';

import { makePlayer, makeTestWorld } from './test-support.js';

function lootEvents(t: ReturnType<typeof makeTestWorld>): Array<Record<string, unknown>> {
  return t.sink.events.filter((e) => e.kind === 'loot');
}

describe('掉落上报：满包 / 部分入包', () => {
  it('整份入包 → handled=pickup、count=实际数量', () => {
    const t = makeTestWorld({ seed: 1 });
    t.world.addPlayer(makePlayer({ loot: () => 5 }));
    // count [5,5] → 掉落数量 5。
    t.world.loots([{ key: 'currency.chaos', rate: 1, count: [5, 5] }], 20, 0);
    const events = lootEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0]!.handled).toBe('pickup');
    expect(events[0]!.count).toBe(5);
  });

  it('完全放不下 → handled=lost、count=原数量，不发 pickup', () => {
    const t = makeTestWorld({ seed: 2 });
    t.world.addPlayer(makePlayer({ loot: () => 0 }));
    t.world.loots([{ key: 'currency.chaos', rate: 1, count: [1, 1] }], 20, 0);
    const events = lootEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0]!.handled).toBe('lost');
    expect(events[0]!.count).toBe(1);
  });

  it('部分入包 → pickup(已入包) + lost(剩余)', () => {
    const t = makeTestWorld({ seed: 3 });
    t.world.addPlayer(makePlayer({ loot: () => 2 }));
    // count [5,5] → 掉落数量 5。
    t.world.loots([{ key: 'currency.chaos', rate: 1, count: [5, 5] }], 20, 0);
    const events = lootEvents(t);
    expect(events.map((e) => `${e.handled}:${e.count}`)).toEqual(['pickup:2', 'lost:3']);
  });

  it('sink 未提供 loot（旧 PlayerLike）→ 回落为全额 pickup（不误报丢失）', () => {
    const t = makeTestWorld({ seed: 4 });
    // makePlayer 默认 `loot: () => {}` 返回 undefined。
    t.world.addPlayer(makePlayer());
    t.world.loots([{ key: 'currency.chaos', rate: 1, count: [1, 1] }], 20, 0);
    const events = lootEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0]!.handled).toBe('pickup');
  });

  it('sell 路径：gold = 实际入包数量', () => {
    const t2 = makeTestWorld({ seed: 6 });
    t2.world.addPlayer(makePlayer({ loot: () => 3 }));
    // lootGood 是公开方法：直接验证 sell 分支的 gold 字段。
    t2.world.lootGood({ key: 'gold', count: 3, quality: 0, handled: 'sell' });
    const events = lootEvents(t2);
    expect(events[0]!.handled).toBe('sell');
    expect(events[0]!.gold).toBe(3);
  });
});
