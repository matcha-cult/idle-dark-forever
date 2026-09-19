/**
 * 秘境控制器门面单测（09 R3-b1）
 *
 * 覆盖：挑战队列 CRUD + 票键状态、神力重置（RC3）的成功/不可重置/神力不足/非秘境，
 * 以及 enter/leave 的过渡转发。
 */
import { describe, expect, it } from 'vitest';
import { createDefaultTables, maxStacksOf } from '@idle-dark/game-core';
import { DungeonLogicService } from '../../../src/modules/logic/dungeon/dungeon.logic.service.js';
import type { WorldService } from '../../../src/modules/logic/world/world.service.js';
import { FIXED_NOW, makeFakeContexts, makeFixture } from '../_helpers.js';

const tables = createDefaultTables();

interface WorldCalls {
  enterMap: Array<{ mapKey: string; opId?: string }>;
  leave: number;
}

function makeWorld(calls: WorldCalls): WorldService {
  return {
    enterMap: async (_u: number, _c: string, mapKey: string, opId?: string) => {
      calls.enterMap.push({ mapKey, ...(opId !== undefined ? { opId } : {}) });
      return { success: true as const, data: { map: mapKey } as never };
    },
    leave: async () => {
      calls.leave += 1;
      return { success: true as const, data: null };
    },
  } as unknown as WorldService;
}

function makeService(diamonds = 0) {
  const fixture = makeFixture();
  fixture.account.diamonds = diamonds;
  const calls: WorldCalls = { enterMap: [], leave: 0 };
  const service = new DungeonLogicService(makeFakeContexts(fixture), makeWorld(calls), () => FIXED_NOW);
  return { service, fixture, calls };
}

describe('DungeonLogicService · 挑战队列（RC4）', () => {
  it('初始为空队列；票键状态按秘境去重且带 stacks/available', async () => {
    const { service } = makeService();
    const result = await service.queueGet(1, 'char-1');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.entries).toEqual([]);
    const cave2 = result.data.tickets.find((t) => t.ticketKey === 'town.cave2');
    expect(cave2).toBeDefined();
    expect(cave2?.stacks).toBeGreaterThan(0); // 首次评估即回满
    expect(cave2?.available).toBe(false); // 无实际钥匙 → 不可挑战
    expect(result.data.tickets.length).toBeGreaterThan(10);
  });

  it('queueSet 过滤非法条目；queueAdd/queueRemove/queueClear 往返一致', async () => {
    const { service } = makeService();
    const set = await service.queueSet(1, 'char-1', [
      { key: 'home' },
      { key: 'no.such.map' },
      { key: 'town.valley', endlessLevel: 2 },
    ]);
    expect(set.success).toBe(true);
    if (set.success) expect(set.data.entries).toEqual([
      { key: 'home', endlessLevel: 0 },
      { key: 'town.valley', endlessLevel: 2 },
    ]);

    const added = await service.queueAdd(1, 'char-1', { key: 'town.mine.2' });
    expect(added.success).toBe(true);
    if (added.success) expect(added.data.entries).toHaveLength(3);

    const badAdd = await service.queueAdd(1, 'char-1', { key: 'no.such.map' });
    expect(badAdd.success).toBe(false);
    if (!badAdd.success) expect(badAdd.data.code).toBe('INVALID_PARAM');

    const removed = await service.queueRemove(1, 'char-1', 0);
    expect(removed.success).toBe(true);
    if (removed.success) expect(removed.data.entries.map((e) => e.key)).toEqual(['town.valley', 'town.mine.2']);

    const cleared = await service.queueClear(1, 'char-1');
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.entries).toEqual([]);
  });

  it('enter/leave 过渡转发到 battle 会话宿主（opId 原样）', async () => {
    const { service, calls } = makeService();
    await service.enter(1, 'char-1', 'town.cave2', 'op-1');
    await service.leave(1, 'char-1');
    expect(calls.enterMap).toEqual([{ mapKey: 'town.cave2', opId: 'op-1' }]);
    expect(calls.leave).toBe(1);
  });
});

describe('DungeonLogicService · 神力重置（RC3）', () => {
  it('可重置秘境：扣对应神力并把层数回满', async () => {
    const { service, fixture } = makeService(100);
    const result = await service.reset(1, 'char-1', 'town.cave2');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cost).toBe(30);
    expect(result.data.stacks).toBe(maxStacksOf(tables.maps['town.cave2']));
    expect(fixture.account.diamonds).toBe(70);
  });

  it('resetPrice=-1 → 不可重置（INVALID_PARAM），不扣神力', async () => {
    const { service, fixture } = makeService(9999);
    const result = await service.reset(1, 'char-1', 'silver.warrior');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('INVALID_PARAM');
    expect(fixture.account.diamonds).toBe(9999);
  });

  it('神力不足 → NOT_ENOUGH_DIAMONDS；非秘境 → MAP_LOCKED', async () => {
    const poor = makeService(0);
    const notEnough = await poor.service.reset(1, 'char-1', 'town.cave2');
    expect(notEnough.success).toBe(false);
    if (!notEnough.success) expect(notEnough.data.code).toBe('NOT_ENOUGH_DIAMONDS');

    const open = makeService(100);
    const notDungeon = await open.service.reset(1, 'char-1', 'home');
    expect(notDungeon.success).toBe(false);
    if (!notDungeon.success) expect(notDungeon.data.code).toBe('MAP_LOCKED');
  });
});
