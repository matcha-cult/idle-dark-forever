/**
 * ChaosStore 单测（W6）—— 序列草稿编辑 / 服务端状态对齐 / 增量入参。
 *
 * 纯 store 层，不渲染；`api` 用内存闭包替身。
 */
import { describe, expect, it } from 'vitest';
import type { ActionResult, ChaosStateDto } from '@idle-dark/protocol';
import { CHAOS_CMD } from '@idle-dark/protocol';
import type { GameApi } from '../src/services/game-client.js';
import { ChaosStore } from '../src/stores/chaos-store.js';
import type { StoreContext } from '../src/stores/store-context.js';
import type { ToastStore } from '../src/stores/toast-store.js';

function state(partial: Partial<ChaosStateDto> = {}): ChaosStateDto {
  const tiers = Array.from({ length: 16 }, (_, i) => ({
    tier: i + 1,
    mapKey: `chaos.t${String(i + 1).padStart(2, '0')}`,
    name: `混沌 T${i + 1}`,
    level: 84 + i + 1,
    keystoneKey: `keystone.t${String(i + 1).padStart(2, '0')}`,
    keystoneCount: 0,
    unlocked: true,
  }));
  return {
    unlocked: true,
    tiers,
    sequence: [],
    failMode: 'normal',
    active: false,
    currentTier: null,
    retry: 0,
    ...partial,
  };
}

interface Harness {
  store: ChaosStore;
  calls: Array<{ method: string; args: unknown }>;
  emitted: Array<{ cmd: number; data: unknown }>;
}

function makeHarness(initial: ChaosStateDto = state()): Harness {
  const calls: Array<{ method: string; args: unknown }> = [];
  const emitted: Array<{ cmd: number; data: unknown }> = [];
  const okState = (next: ChaosStateDto): ActionResult<ChaosStateDto> => ({
    success: true,
    data: next,
  });
  const api = {
    chaos: {
      state: async () => {
        calls.push({ method: 'state', args: undefined });
        return okState(initial);
      },
      setSequence: async (params: { sequence: string[] }) => {
        calls.push({ method: 'setSequence', args: params });
        emitted.push({ cmd: CHAOS_CMD.cmd, data: params });
        return okState({ ...initial, sequence: params.sequence });
      },
      setFailMode: async (params: { failMode: 'normal' | 'continue' }) => {
        calls.push({ method: 'setFailMode', args: params });
        return okState({ ...initial, failMode: params.failMode });
      },
      start: async () => {
        calls.push({ method: 'start', args: undefined });
        return okState({ ...initial, active: true, currentTier: 1 });
      },
      stop: async () => {
        calls.push({ method: 'stop', args: undefined });
        return okState({ ...initial, active: false });
      },
    },
  } as unknown as GameApi;
  const toast = {
    success: () => {},
    fromError: () => {},
    fromFailure: () => {},
  } as unknown as ToastStore;
  const ctx = {
    api,
    toast,
    root: () => ({}) as never,
  } as unknown as StoreContext;
  return { store: new ChaosStore(ctx), calls, emitted };
}

describe('ChaosStore', () => {
  it('load：对齐服务端状态与序列草稿，dirty 归零', async () => {
    const { store } = makeHarness(state({ sequence: ['keystone.t02'] }));
    await store.load();
    expect(store.state).not.toBeNull();
    expect(store.sequenceDraft).toEqual(['keystone.t02']);
    expect(store.dirty).toBe(false);
    expect(store.unlocked).toBe(true);
  });

  it('add / remove / move：草稿编辑与上限（= 服务端下发的阶位数）', async () => {
    const { store } = makeHarness();
    await store.load();
    for (let i = 0; i < 16; i += 1) store.addToSequence('keystone.t01');
    expect(store.sequenceDraft).toHaveLength(16);
    store.addToSequence('keystone.t02'); // 超上限被忽略
    expect(store.sequenceDraft).toHaveLength(16);

    store.moveInSequence(0, 1);
    expect(store.sequenceDraft[0]).toBe('keystone.t01');
    store.removeFromSequence(0);
    expect(store.sequenceDraft).toHaveLength(15);
    expect(store.dirty).toBe(true);

    // 越界 / 非法下标不抛错
    store.removeFromSequence(-1);
    store.removeFromSequence(999);
    store.moveInSequence(-1, 1);
    store.moveInSequence(0, -1);
  });

  it('非法入参：空 key / 非字符串被忽略', async () => {
    const { store } = makeHarness();
    await store.load();
    store.addToSequence('');
    store.addToSequence(undefined as unknown as string);
    expect(store.sequenceDraft).toEqual([]);
  });

  it('saveSequence：把草稿原样交给服务端并清除 dirty', async () => {
    const { store, calls } = makeHarness();
    await store.load();
    store.addToSequence('keystone.t03');
    store.removeFromSequence(0);
    store.addToSequence('keystone.t05');
    await store.saveSequence();
    const saved = calls.find((entry) => entry.method === 'setSequence');
    expect(saved?.args).toEqual({ sequence: ['keystone.t05'] });
    expect(store.dirty).toBe(false);
  });

  it('setFailMode / start / stop 走对应 API', async () => {
    const { store, calls } = makeHarness();
    await store.load();
    await store.setFailMode('continue');
    expect(store.failMode).toBe('continue');
    await store.start();
    expect(store.active).toBe(true);
    await store.stop();
    expect(store.active).toBe(false);
    expect(calls.map((entry) => entry.method)).toEqual([
      'state',
      'setFailMode',
      'start',
      'stop',
    ]);
  });

  it('handleNotification：仅 CHAOS 段触发重载', async () => {
    const { store, calls } = makeHarness();
    store.handleNotification({ cmd: CHAOS_CMD.cmd });
    store.handleNotification({ cmd: CHAOS_CMD.cmd + 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.filter((entry) => entry.method === 'state')).toHaveLength(1);
  });
});
