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

describe('WorldStore 单位补丁（P2）', () => {
  function unit(id: string, extra: Partial<{ hp: number; camp: string; alive: boolean }> = {}) {
    return {
      id,
      kind: 'enemy',
      typeKey: 'slime.minimal',
      name: '小史莱姆',
      camp: extra.camp ?? 'enemy',
      level: 1,
      quality: 0,
      hp: extra.hp ?? 25,
      maxHp: 25,
      mp: 0,
      maxMp: 0,
      rp: 0,
      maxRp: 0,
      ep: 0,
      maxEp: 0,
      comboPoint: 0,
      targetId: null,
      castingProgress: null,
      buffs: [],
      ...(extra.alive !== undefined ? { alive: extra.alive } : {}),
    };
  }

  it('reset 重建单位表；chg 只改指定字段；del 移除；add 追加', () => {
    const { store } = makeHarness();
    pushTick(store, tick({ patch: [{ op: 'reset', units: [unit('a'), unit('b')] }] }));
    expect(store.units.map((u) => u.id)).toEqual(['a', 'b']);

    pushTick(store, tick({ patch: [{ op: 'chg', id: 'a', fields: { hp: 3 } }] }));
    expect(store.units.find((u) => u.id === 'a')?.hp).toBe(3);
    // 未提及的字段必须保留（补丁是「部分字段」而不是整对象）
    expect(store.units.find((u) => u.id === 'a')?.name).toBe('小史莱姆');
    expect(store.units).toHaveLength(2);

    pushTick(store, tick({ patch: [{ op: 'add', unit: unit('c') }, { op: 'del', id: 'b' }] }));
    expect(store.units.map((u) => u.id)).toEqual(['a', 'c']);
  });

  it('同一帧内 add 后紧跟 del（生了又死）→ 按序应用后不存在', () => {
    const { store } = makeHarness();
    pushTick(store, tick({ patch: [{ op: 'reset', units: [] }] }));
    pushTick(store, tick({ patch: [{ op: 'add', unit: unit('tmp') }, { op: 'del', id: 'tmp' }] }));
    expect(store.units).toHaveLength(0);
  });

  it('死亡 = alive:false 的 chg（尸体仍在表里），清尸才是 del', () => {
    const { store } = makeHarness();
    pushTick(store, tick({ patch: [{ op: 'reset', units: [unit('e1', { hp: 30 })] }] }));
    pushTick(store, tick({ patch: [{ op: 'chg', id: 'e1', fields: { hp: 0, camp: 'ghost', alive: false } }] }));
    expect(store.units).toHaveLength(1);
    expect(store.units[0]?.alive).toBe(false);
    pushTick(store, tick({ patch: [{ op: 'del', id: 'e1' }] }));
    expect(store.units).toHaveLength(0);
  });

  it('旧格式（只带 units / events）不再被采信 —— 停填字段不得清空或污染状态', () => {
    const { store } = makeHarness();
    pushTick(store, tick({ patch: [{ op: 'reset', units: [unit('a')] }] }));
    pushTick(store, tick({ units: [unit('legacy')], events: [{ kind: 'general', text: 'x' }] }));
    expect(store.units.map((u) => u.id)).toEqual(['a']);
    expect(store.log).toHaveLength(0);
  });

  it('指向未知 id 的 chg（基线不一致）→ 主动重拉快照自愈，而不是静默丢弃', async () => {
    const { store } = makeHarness(snapshot({ units: [unit('fresh')] }));
    pushTick(store, tick({ patch: [{ op: 'chg', id: 'nobody', fields: { hp: 1 } }] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.units.map((u) => u.id)).toEqual(['fresh']);
  });

  it('isDead：优先服务端 alive，其次 camp，最后回落 hp', async () => {
    const { isDead } = await import('../src/stores/world-store.js');
    expect(isDead({ alive: false, camp: 'enemy', hp: 10 })).toBe(true);
    expect(isDead({ alive: true, camp: 'ghost', hp: 0 })).toBe(false);
    expect(isDead({ camp: 'ghost', hp: 10 })).toBe(true);
    expect(isDead({ camp: 'enemy', hp: 0 })).toBe(true);
    expect(isDead({ camp: 'enemy', hp: 5 })).toBe(false);
  });
});
