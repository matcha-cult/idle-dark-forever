/**
 * 地图控制器与地图纯函数单测（09 R2）
 *
 * 覆盖：`resolveWorldPosition` / `evaluateMapUnlock` / `pickOpenWorldMap`（RD4）边界，
 * 以及 `MapLogicService` 的 list / enter（解锁 + 幂等转发）/ leave / continueOpenWorld。
 */
import { describe, expect, it } from 'vitest';
import { createDefaultTables, type DataTables } from '@idle-dark/game-core';
import { MapLogicService } from '../../../src/modules/logic/map/map.logic.service.js';
import type { WorldService } from '../../../src/modules/logic/world/world.service.js';
import {
  evaluateMapUnlock,
  pickOpenWorldMap,
  resolveWorldPosition,
} from '../../../src/modules/logic/shared/map-dto.js';
import { FIXED_NOW, makeFakeContexts, makeFixture } from '../_helpers.js';
import type { PlayerContextService } from '../../../src/modules/logic/shared/player-context.service.js';

const tables: DataTables = createDefaultTables();

interface WorldCalls {
  enterMap: Array<{ userId: number; characterId: string; mapKey: string; opId?: string }>;
  leave: Array<{ userId: number; characterId: string }>;
  snapshot: Array<{ userId: number; characterId: string }>;
}

function makeWorld(calls: WorldCalls): WorldService {
  return {
    enterMap: async (userId: number, characterId: string, mapKey: string, opId?: string) => {
      calls.enterMap.push({ userId, characterId, mapKey, ...(opId !== undefined ? { opId } : {}) });
      return { success: true as const, data: { map: mapKey } as never };
    },
    leave: async (userId: number, characterId: string) => {
      calls.leave.push({ userId, characterId });
      return { success: true as const, data: null };
    },
    snapshot: async (userId: number, characterId: string) => {
      calls.snapshot.push({ userId, characterId });
      return { success: true as const, data: { map: 'home' } as never };
    },
  } as unknown as WorldService;
}

function makeService(calls: WorldCalls, contexts?: PlayerContextService): MapLogicService {
  const fixture = makeFixture();
  return new MapLogicService(
    contexts ?? makeFakeContexts(fixture),
    makeWorld(calls),
  );
}

describe('resolveWorldPosition', () => {
  it('缺失 → home/0；未知地图 → home；endlessLevel 非法 → 0', () => {
    expect(resolveWorldPosition(tables, undefined)).toEqual({ map: 'home', endlessLevel: 0 });
    expect(resolveWorldPosition(tables, { map: 'no.such.map', endlessLevel: 3 })).toEqual({
      map: 'home',
      endlessLevel: 3,
    });
    expect(resolveWorldPosition(tables, { map: 'home', endlessLevel: Number.NaN })).toEqual({
      map: 'home',
      endlessLevel: 0,
    });
    expect(resolveWorldPosition(tables, { map: 'home', endlessLevel: Number.POSITIVE_INFINITY }).endlessLevel).toBe(0);
    expect(resolveWorldPosition(tables, { map: 'home', endlessLevel: 2.9 }).endlessLevel).toBe(2);
  });
});

describe('evaluateMapUnlock', () => {
  it('空条件解锁；条件不满足不解锁；判定异常 fail-closed', () => {
    const f = makeFixture();
    expect(evaluateMapUnlock({}, f.player, 'home', f.extras)).toBe(true);
    expect(evaluateMapUnlock({ level: 999 }, f.player, 'home', f.extras)).toBe(false);
    // 自引用循环条件：深度护栏 → 不成立而不是爆栈
    const cyclic: { $or: unknown[] } = { $or: [] };
    cyclic.$or.push(cyclic);
    expect(() => evaluateMapUnlock(cyclic as never, f.player, 'home', f.extras)).not.toThrow();
    expect(evaluateMapUnlock(cyclic as never, f.player, 'home', f.extras)).toBe(false);
  });
});

describe('pickOpenWorldMap（RD4）', () => {
  const dungeon = Object.keys(tables.maps).find((key) => tables.maps[key]?.isDungeon === true);
  const open = Object.keys(tables.maps).find((key) => !tables.maps[key]?.isDungeon);

  it('优先级：candidate → persisted → home', () => {
    // town.street 是开放世界图（有前置剧情要求，但 pickOpenWorldMap 只看"非秘境"）
    expect(pickOpenWorldMap(tables, 'home', 'town.valley')).toBe('home');
    expect(pickOpenWorldMap(tables, undefined, 'town.valley')).toBe('town.valley');
    expect(pickOpenWorldMap(tables, undefined, undefined)).toBe('home');
  });

  it('候选非法 / 是秘境 / 不存在 → 落到下一档，最终 home', () => {
    expect(dungeon).toBeTruthy();
    // town.woods 在这份数据里就是秘境（isDungeon=true）
    expect(tables.maps['town.woods']?.isDungeon).toBe(true);
    expect(pickOpenWorldMap(tables, 'town.woods', 'town.valley')).toBe('town.valley');
    expect(pickOpenWorldMap(tables, dungeon, 'town.valley')).toBe('town.valley');
    expect(pickOpenWorldMap(tables, 'no.such.map', 'town.valley')).toBe('town.valley');
    expect(pickOpenWorldMap(tables, '', '')).toBe('home');
    expect(pickOpenWorldMap(tables, null, dungeon)).toBe('home');
    expect(open).toBeTruthy();
  });
});

describe('MapLogicService', () => {
  it('list：返回地图目录，已解锁排前、锁定带 lockedReason', async () => {
    const calls: WorldCalls = { enterMap: [], leave: [], snapshot: [] };
    const service = makeService(calls);
    const result = await service.list(1, 'char-1');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.length).toBeGreaterThan(0);
    const firstLocked = result.data.findIndex((m) => m.unlocked !== true);
    const lastUnlocked = result.data.map((m) => m.unlocked === true).lastIndexOf(true);
    expect(firstLocked === -1 || lastUnlocked < firstLocked).toBe(true);
    for (const m of result.data) {
      if (m.unlocked === true) expect(m.lockedReason).toBeNull();
      else expect(typeof m.lockedReason).toBe('string');
    }
  });

  it('enter：未知地图 → MAP_LOCKED（不转发给 battle）', async () => {
    const calls: WorldCalls = { enterMap: [], leave: [], snapshot: [] };
    const service = makeService(calls);
    const result = await service.enter(1, 'char-1', 'no.such.map');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('MAP_LOCKED');
    expect(calls.enterMap).toHaveLength(0);
  });

  it('enter：解锁通过（home 无前置）→ 转发 battle（opId 原样传递）', async () => {
    const calls: WorldCalls = { enterMap: [], leave: [], snapshot: [] };
    const service = makeService(calls);
    const result = await service.enter(1, 'char-1', 'home', 'op-map-1');
    expect(result.success).toBe(true);
    expect(calls.enterMap).toEqual([
      { userId: 1, characterId: 'char-1', mapKey: 'home', opId: 'op-map-1' },
    ]);
  });

  it('enter：条件未满足的地图 → MAP_LOCKED（不转发）', async () => {
    const calls: WorldCalls = { enterMap: [], leave: [], snapshot: [] };
    const service = makeService(calls);
    // town.street 需要前置剧情，裸角色不可进
    const result = await service.enter(1, 'char-1', 'town.street');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('MAP_LOCKED');
    expect(calls.enterMap).toHaveLength(0);
  });

  it('enter：角色不存在 → PLAYER_NOT_FOUND（不转发）', async () => {
    const calls: WorldCalls = { enterMap: [], leave: [], snapshot: [] };
    const contexts = {
      tables,
      load: async () => null,
      extrasOf: async () => ({ worldMaps: {}, storiesMap: {} }),
    } as unknown as PlayerContextService;
    const service = makeService(calls, contexts);
    const result = await service.enter(1, 'char-1', 'home');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('PLAYER_NOT_FOUND');
    expect(calls.enterMap).toHaveLength(0);
  });

  it('snapshot / leave 转发到 battle；continueOpenWorld 走 open-world 目标', async () => {
    const calls: WorldCalls = { enterMap: [], leave: [], snapshot: [] };
    const fixture = makeFixture();
    const contexts = makeFakeContexts(fixture);
    const service = makeService(calls, contexts);
    await service.snapshot(1, 'char-1');
    await service.leave(1, 'char-1');
    expect(calls.snapshot).toHaveLength(1);
    expect(calls.leave).toEqual([{ userId: 1, characterId: 'char-1' }]);

    // 持久化位置 home（开放图，无前置）→ 队列耗尽转它（RD4 第二档）
    fixture.extras.worldMaps['char-1'] = { map: 'home', endlessLevel: 0 };
    await service.continueOpenWorld(1, 'char-1');
    expect(calls.enterMap.at(-1)?.mapKey).toBe('home');

    // candidate = run.outside 优先
    await service.continueOpenWorld(1, 'char-1', 'home');
    expect(calls.enterMap.at(-1)?.mapKey).toBe('home');

    // candidate 是秘境 → 回落持久化开放位置（而非停在秘境）
    const dungeon = Object.keys(tables.maps).find((key) => tables.maps[key]?.isDungeon === true) as string;
    await service.continueOpenWorld(1, 'char-1', dungeon);
    expect(calls.enterMap.at(-1)?.mapKey).toBe('home');
  });
});
