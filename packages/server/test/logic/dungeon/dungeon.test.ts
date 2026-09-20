/**
 * 秘境控制器门面单测（09 R3-b1）
 *
 * 覆盖：挑战队列 CRUD + 票键状态、神力重置（RC3）的成功/不可重置/神力不足/非秘境，
 * 以及 enter/leave 的过渡转发。
 */
import { describe, expect, it } from 'vitest';
import { createDefaultTables, maxStacksOf } from '@idle-dark/game-core';
import { DungeonLogicService } from '../../../src/modules/logic/dungeon/dungeon.logic.service.js';
import type { MapLogicService } from '../../../src/modules/logic/map/map.logic.service.js';
import type { WorldService } from '../../../src/modules/logic/world/world.service.js';
import { InProcessEventBus } from '../../../src/modules/logic/shared/event-bus.js';
import { FIXED_NOW, makeFakeContexts, makeFixture } from '../_helpers.js';
import { addTestDungeons } from '../../helpers/test-dungeons.js';

const tables = createDefaultTables();
// W3：旧 town.* 秘境图已随地图种子替换删除；单测自备等价秘境图（W6 一并移除）。
addTestDungeons(tables);

interface WorldCalls {
  enterMap: Array<{ mapKey: string; opId?: string }>;
  leave: number;
  openWorld: Array<string | undefined>;
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

function makeMaps(calls: WorldCalls): MapLogicService {
  return {
    continueOpenWorld: async (_u: number, _c: string, candidate?: string) => {
      calls.openWorld.push(candidate);
      return { success: true as const, data: { map: candidate ?? 'home' } as never };
    },
  } as unknown as MapLogicService;
}

function makeService(diamonds = 0) {
  const fixture = makeFixture();
  addTestDungeons(fixture.tables);
  fixture.account.diamonds = diamonds;
  const calls: WorldCalls = { enterMap: [], leave: 0, openWorld: [] };
  const events = new InProcessEventBus();
  const service = new DungeonLogicService(
    makeFakeContexts(fixture),
    makeWorld(calls),
    makeMaps(calls),
    () => FIXED_NOW,
    events,
  );
  return { service, fixture, calls, events };
}

/** 驱动一次 `RunEnded` 并等待异步处理器跑完。 */
async function emitRunEnded(
  service: DungeonLogicService,
  events: InProcessEventBus,
  mapKey: string,
  outside = 'home',
): Promise<void> {
  service.onModuleInit();
  events.emit({
    type: 'RunEnded',
    userId: 1,
    characterId: 'char-1',
    runId: 'run-1',
    mapKey,
    endlessLevel: 0,
    outside,
    reason: 'clear',
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('DungeonLogicService · 挑战队列（RC4）', () => {
  it('初始为空队列；票键状态按秘境去重且带 stacks/available', async () => {
    const { service } = makeService();
    const result = await service.queueGet(1, 'char-1');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.entries).toEqual([]);
    const cave2 = result.data.tickets.find((t) => t.ticketKey === 'test.cave');
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
      { key: 'world.1', endlessLevel: 2 },
    ]);
    expect(set.success).toBe(true);
    if (set.success) expect(set.data.entries).toEqual([
      { key: 'home', endlessLevel: 0 },
      { key: 'world.1', endlessLevel: 2 },
    ]);

    const added = await service.queueAdd(1, 'char-1', { key: 'test.mine' });
    expect(added.success).toBe(true);
    if (added.success) expect(added.data.entries).toHaveLength(3);

    const badAdd = await service.queueAdd(1, 'char-1', { key: 'no.such.map' });
    expect(badAdd.success).toBe(false);
    if (!badAdd.success) expect(badAdd.data.code).toBe('INVALID_PARAM');

    const removed = await service.queueRemove(1, 'char-1', 0);
    expect(removed.success).toBe(true);
    if (removed.success) expect(removed.data.entries.map((e) => e.key)).toEqual(['world.1', 'test.mine']);

    const cleared = await service.queueClear(1, 'char-1');
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.entries).toEqual([]);
  });

  it('enter/leave 过渡转发到 battle 会话宿主（opId 原样）', async () => {
    const { service, calls } = makeService();
    await service.enter(1, 'char-1', 'test.cave', 'op-1');
    await service.leave(1, 'char-1');
    expect(calls.enterMap).toEqual([{ mapKey: 'test.cave', opId: 'op-1' }]);
    expect(calls.leave).toBe(1);
  });
});

describe('DungeonLogicService · 神力重置（RC3）', () => {
  it('可重置秘境：扣对应神力并把层数回满', async () => {
    const { service, fixture } = makeService(100);
    const result = await service.reset(1, 'char-1', 'test.cave');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cost).toBe(30);
    expect(result.data.stacks).toBe(maxStacksOf(tables.maps['test.cave']));
    expect(fixture.account.diamonds).toBe(70);
  });

  it('resetPrice=-1 → 不可重置（INVALID_PARAM），不扣神力', async () => {
    const { service, fixture } = makeService(9999);
    const result = await service.reset(1, 'char-1', 'test.noreset');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('INVALID_PARAM');
    expect(fixture.account.diamonds).toBe(9999);
  });

  it('神力不足 → NOT_ENOUGH_DIAMONDS；非秘境 → MAP_LOCKED', async () => {
    const poor = makeService(0);
    const notEnough = await poor.service.reset(1, 'char-1', 'test.cave');
    expect(notEnough.success).toBe(false);
    if (!notEnough.success) expect(notEnough.data.code).toBe('NOT_ENOUGH_DIAMONDS');

    const open = makeService(100);
    const notDungeon = await open.service.reset(1, 'char-1', 'home');
    expect(notDungeon.success).toBe(false);
    if (!notDungeon.success) expect(notDungeon.data.code).toBe('MAP_LOCKED');
  });
});

describe('DungeonLogicService · 队列推进（RunEnded，RD3/RD4/RD5）', () => {
  it('队列驱动：下一条秘境可打（有票 + 冷却就绪）→ 进入它并弹出', async () => {
    const { service, fixture, calls, events } = makeService();
    fixture.extras.challengeQueue['char-1'] = [
      { key: 'test.cave', endlessLevel: 0 },
      { key: 'test.mine', endlessLevel: 0 },
    ];
    fixture.player.dungeonTickets.set('test.mine', 1);

    await emitRunEnded(service, events, 'test.cave');

    expect(calls.enterMap.map((c) => c.mapKey)).toEqual(['test.mine']);
    expect(fixture.extras.challengeQueue['char-1']).toEqual([]);
  });

  it('无票 → 跳过并继续；全部不可用且无非秘境条目 → openWorld(run.outside)（RD4）', async () => {
    const { service, fixture, calls, events } = makeService();
    fixture.extras.challengeQueue['char-1'] = [
      { key: 'test.cave', endlessLevel: 0 },
      { key: 'test.mine', endlessLevel: 0 },
    ];

    await emitRunEnded(service, events, 'test.cave', 'world.1');

    expect(calls.enterMap).toEqual([]);
    expect(calls.openWorld).toEqual(['world.1']);
    expect(fixture.extras.challengeQueue['char-1']).toEqual([]);
  });

  it('非秘境条目 → 转入该图（RD3）', async () => {
    const { service, fixture, calls, events } = makeService();
    fixture.extras.challengeQueue['char-1'] = [
      { key: 'test.cave', endlessLevel: 0 },
      { key: 'home', endlessLevel: 0 },
    ];

    await emitRunEnded(service, events, 'test.cave');

    expect(calls.enterMap).toEqual([]);
    expect(calls.openWorld).toEqual(['home']);
  });

  it('手动进图（队首不匹配）/ 空队列 → 不接管队列', async () => {
    const manual = makeService();
    manual.fixture.extras.challengeQueue['char-1'] = [{ key: 'home', endlessLevel: 0 }];
    await emitRunEnded(manual.service, manual.events, 'test.cave');
    expect(manual.calls.enterMap).toEqual([]);
    expect(manual.calls.openWorld).toEqual([]);
    expect(manual.fixture.extras.challengeQueue['char-1']).toEqual([{ key: 'home', endlessLevel: 0 }]);

    const empty = makeService();
    await emitRunEnded(empty.service, empty.events, 'test.cave');
    expect(empty.calls.enterMap).toEqual([]);
    expect(empty.calls.openWorld).toEqual([]);
  });
});
