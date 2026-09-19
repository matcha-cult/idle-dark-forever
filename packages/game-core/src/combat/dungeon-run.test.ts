/**
 * 秘境 run 结算单测（RC2 / M5：进图扣一次，通关只结算不再扣票）
 *
 * 覆盖：
 * - `ticketPaid = false` → 通关不结算、不扣票、不产生收益（`dungeon.noTicket:`）；
 * - `ticketPaid = true` → 正常结算（`dungeon.clear:` + 经验），且**不再调用 `costTicket`**；
 * - `dumpState` / `load` 往返保留 `ticketPaid` 与 `currentPhase`（M7 恢复语义）。
 */
import { describe, expect, it } from 'vitest';
import { DungeonState } from './spawner.js';
import { makePlayer, makeTables, makeTestWorld, mapData } from './test-support.js';

function dungeonTables() {
  return makeTables({
    maps: {
      dun: mapData({
        key: 'dun',
        name: 'Dun',
        isDungeon: true,
        outside: 'home',
        exp: 50,
        level: 1,
        // 一个阶段、无怪物：`checkPhaseAdvance()` 会立刻推进到"通关"。
        phases: [{ description: 'p1', monsters: [] }],
      }),
      home: mapData({ key: 'home', name: 'Home' }),
    },
  });
}

function setup() {
  const tables = dungeonTables();
  const t = makeTestWorld({ map: 'dun', tables, seed: 11 });
  const counter = { costCalls: 0 };
  const player = makePlayer({
    costTicket: () => {
      counter.costCalls += 1;
    },
    countTicket: () => 1,
  });
  t.world.addPlayer(player);
  t.world.onMapChanged();
  const spawner = t.world.enemyBorn as DungeonState;
  return { t, spawner, player, counter };
}

function generals(t: { sink: { events: Array<Record<string, unknown>> } }): string[] {
  return t.sink.events.filter((e) => e.kind === 'general').map((e) => String(e.text));
}

describe('DungeonState · 通关结算（M5）', () => {
  it('未付费 run：通关不结算、不扣票、无经验', () => {
    const { t, spawner, player, counter } = setup();
    spawner.ticketPaid = false;
    const expBefore = player.exp;

    spawner.checkPhaseAdvance();

    expect(generals(t).some((text) => text.startsWith('dungeon.noTicket:'))).toBe(true);
    expect(generals(t).some((text) => text.startsWith('dungeon.clear:'))).toBe(false);
    expect(counter.costCalls).toBe(0);
    expect(player.exp).toBe(expBefore);
    expect(t.world.map).toBe('home'); // outside 回落
  });

  it('已付费 run：结算发经验，且**不再二次扣票**（countTicket 不变）', () => {
    const { t, spawner, player, counter } = setup();
    spawner.ticketPaid = true;
    const expBefore = player.exp;
    const ticketsBefore = player.countTicket?.('dun') ?? 0;

    spawner.checkPhaseAdvance();

    expect(generals(t).some((text) => text.startsWith('dungeon.clear:'))).toBe(true);
    expect(generals(t).some((text) => text.startsWith('dungeon.noTicket:'))).toBe(false);
    expect(player.exp).toBeGreaterThan(expBefore);
    expect(counter.costCalls).toBe(0); // 唯一扣费点在进图，不在通关
    expect(player.countTicket?.('dun') ?? 0).toBe(ticketsBefore);
  });

  it('dumpState / load 往返保留 ticketPaid 与 currentPhase（M7 恢复语义）', () => {
    const { t, spawner } = setup();
    spawner.ticketPaid = true;
    const dumped = spawner.dumpState();
    expect(dumped.ticketPaid).toBe(true);
    expect(dumped.currentPhase).toBe(0);

    const t2 = makeTestWorld({ map: 'dun', tables: dungeonTables(), seed: 11 });
    t2.world.addPlayer(makePlayer());
    t2.world.onMapChanged({ enemyBorn: dumped });
    const restored = t2.world.enemyBorn as DungeonState;
    expect(restored.ticketPaid).toBe(true);
    expect(restored.currentPhase).toBe(0);
  });

  it('未付费的 dumpState 恢复后仍为未付费（不因往返而"变成已付费"）', () => {
    const { spawner } = setup();
    spawner.ticketPaid = false;
    const dumped = spawner.dumpState();
    const t2 = makeTestWorld({ map: 'dun', tables: dungeonTables(), seed: 11 });
    t2.world.addPlayer(makePlayer());
    t2.world.onMapChanged({ enemyBorn: dumped });
    expect((t2.world.enemyBorn as DungeonState).ticketPaid).toBe(false);
  });
});
