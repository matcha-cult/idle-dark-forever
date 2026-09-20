/**
 * WorldStore 波次单测（W4 前端可见）。
 *
 * 覆盖：tick / snapshot 更新 `wave` / `bossEvery`；`wavesToBoss` 与 `bossWave` 的边界
 * （0 波、正好 BOSS 波、越过 BOSS 波、`bossEvery` 缺省 / 非法）。
 *
 * 纯 store 层，不渲染；`api` 用内存闭包替身。
 */
import { describe, expect, it } from 'vitest';
import { BATTLE_CMD, WORLD_CMD, type WorldSnapshotDto, type WorldTickDto } from '@idle-dark/protocol';
import { DEFAULT_BOSS_EVERY, WorldStore } from '../src/stores/world-store.js';
import type { StoreContext } from '../src/stores/store-context.js';

function snapshot(partial: Partial<WorldSnapshotDto> = {}): WorldSnapshotDto {
  return {
    map: 'world.1',
    units: [],
    maps: [],
    updateRate: 1,
    paused: true,
    ...partial,
  };
}

function tick(partial: Partial<WorldTickDto> = {}): WorldTickDto {
  return {
    serverTime: 1,
    units: [],
    events: [],
    gainedExp: 0,
    gainedGold: 0,
    ...partial,
  };
}

interface Harness {
  store: WorldStore;
  gains: Array<{ exp: number; gold: number; serverTime: number }>;
}

function makeHarness(loadSnapshot: WorldSnapshotDto = snapshot()): Harness {
  const gains: Array<{ exp: number; gold: number; serverTime: number }> = [];
  const api = {
    world: {
      snapshot: async () => ({ success: true, data: loadSnapshot }),
    },
  };
  const toast = {
    info: () => {},
    error: () => {},
    fromError: () => {},
    fromFailure: () => {},
  };
  const root = () => ({
    player: {
      map: 'home',
      noteTickGain: (exp: number, gold: number, serverTime: number) => {
        gains.push({ exp, gold, serverTime });
      },
    },
  });
  const ctx = { api, toast, root } as unknown as StoreContext;
  return { store: new WorldStore(ctx), gains };
}

function pushTick(store: WorldStore, data: WorldTickDto): void {
  store.handleNotification({ cmd: WORLD_CMD.cmd, subCmd: WORLD_CMD.tick, data });
}

describe('WorldStore 波次（W4）', () => {
  it('snapshot：wave=0 → wavesToBoss=20、非 BOSS 波、bossEvery 缺省 20', async () => {
    const { store } = makeHarness(snapshot({ wave: 0 }));
    await store.load();
    expect(store.wave).toBe(0);
    expect(store.bossEvery).toBe(DEFAULT_BOSS_EVERY);
    expect(store.wavesToBoss).toBe(DEFAULT_BOSS_EVERY);
    expect(store.bossWave).toBe(false);
  });

  it('snapshot 缺省 wave / bossEvery → 0 波 + 缺省 20', async () => {
    const { store } = makeHarness(snapshot());
    await store.load();
    expect(store.wave).toBe(0);
    expect(store.bossEvery).toBe(20);
    expect(store.wavesToBoss).toBe(20);
    expect(store.bossWave).toBe(false);
  });

  it('wave=20（正好 BOSS 波）→ wavesToBoss 按整轮算 20，bossWave=true', async () => {
    const { store } = makeHarness(snapshot({ wave: 20, bossEvery: 20 }));
    await store.load();
    expect(store.wave).toBe(20);
    expect(store.wavesToBoss).toBe(20);
    expect(store.bossWave).toBe(true);
  });

  it('wave=21（越过 BOSS 波）→ wavesToBoss=19，bossWave=false', async () => {
    const { store } = makeHarness(snapshot({ wave: 21, bossEvery: 20 }));
    await store.load();
    expect(store.wavesToBoss).toBe(19);
    expect(store.bossWave).toBe(false);
  });

  it('tick 更新 wave / bossEvery（含自定义间隔）', async () => {
    const { store } = makeHarness(snapshot({ wave: 0 }));
    await store.load();
    pushTick(store, tick({ wave: 3, bossEvery: 10 }));
    expect(store.wave).toBe(3);
    expect(store.bossEvery).toBe(10);
    expect(store.wavesToBoss).toBe(7);
    expect(store.bossWave).toBe(false);

    pushTick(store, tick({ wave: 10, bossEvery: 10 }));
    expect(store.bossWave).toBe(true);
    expect(store.wavesToBoss).toBe(10);
  });

  it('tick 的非法值不污染上一份权威状态', async () => {
    const { store } = makeHarness(snapshot({ wave: 5, bossEvery: 20 }));
    await store.load();
    pushTick(
      store,
      tick({ wave: Number.NaN, bossEvery: 0 } as Partial<WorldTickDto>),
    );
    expect(store.wave).toBe(5);
    expect(store.bossEvery).toBe(20);
    pushTick(store, tick({ wave: -3, bossEvery: -1 } as Partial<WorldTickDto>));
    expect(store.wave).toBe(5);
    expect(store.bossEvery).toBe(20);
  });

  it('tick 仍照常把经验/金币增量转给 PlayerStore', async () => {
    const { store, gains } = makeHarness();
    pushTick(store, tick({ gainedExp: 7, gainedGold: 3, serverTime: 42 }));
    expect(gains).toEqual([{ exp: 7, gold: 3, serverTime: 42 }]);
  });

  it('handleNotification：非 tick 帧不改动波次', async () => {
    const { store } = makeHarness(snapshot({ wave: 4 }));
    await store.load();
    store.handleNotification({ cmd: BATTLE_CMD.cmd, subCmd: BATTLE_CMD.log, data: { events: [] } });
    expect(store.wave).toBe(4);
  });
});
