/**
 * 秘境 run 生命周期单测（M5 唯一扣票 + M7 相位落库）
 *
 * 覆盖：
 * - 进图：扣票**恰好一次**并建档（runId/mapKey/enemyBorn）；
 * - 重登（stop → start）：命中持久化 run → 恢复相位 + 标记已付费，**不重复扣票**；
 * - 通关/离图：`world.map` 离开 run 地图 → 清档；
 * - 停在秘境但**没有 run 档**（旧存档 / 漂移）：按未付费 run 起，通关不结算（反白刷）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DungeonState, createDefaultTables, type DataTables } from '@idle-dark/game-core';
import type { NotificationBatcher, PushFrame } from '../../../src/modules/game/notification-batcher.js';
import { OpIdempotencyService } from '../../../src/modules/game/op-idempotency.service.js';
import type { OnlineSessionService } from '../../../src/modules/online/online-session.service.js';
import { PanelCharacterService } from '../../../src/modules/logic/shared/panel-character.service.js';
import { PlayerContextService } from '../../../src/modules/logic/shared/player-context.service.js';
import { InProcessEventBus } from '../../../src/modules/logic/shared/event-bus.js';
import { WorldService } from '../../../src/modules/logic/world/world.service.js';
import { FakeDatabase } from '../../helpers/fake-database.js';

const tables: DataTables = createDefaultTables();
const DUNGEON = 'town.cave2'; // 要求 eyer-stories-4；票键 = 'town.cave2'

describe('秘境 run 生命周期（M5/M7）', () => {
  let db: FakeDatabase;
  let context: PlayerContextService;
  let service: WorldService;
  let now: number;

  beforeEach(() => {
    db = new FakeDatabase();
    db.seedAccount(1);
    db.seedCharacter({ id: 'c1', user_id: 1, role: 'Eyer', career: 'warrior' });
    now = 1_700_000_000_000;
    context = new PlayerContextService(db.asService(), () => now, tables);
    const batcher = {
      enqueue: (_userId: number, _frame: PushFrame) => true,
      registerMerger: () => undefined,
      drop: () => 0,
      flushAll: () => ({ users: 0, frames: 0 }),
    } as unknown as NotificationBatcher;
    const onlineSessions = { isOnline: () => true } as unknown as OnlineSessionService;
    service = new WorldService(
      context,
      onlineSessions,
      new OpIdempotencyService(),
      new PanelCharacterService(db.asService() as never),
      batcher,
      () => now,
      tables,
      new InProcessEventBus(),
    );
  });

  async function giveAccess(): Promise<void> {
    const player = await context.load(1, 'c1');
    if (!player) throw new Error('player missing');
    const extras = await context.extrasOf(1);
    extras.storiesMap['eyer-stories-4'] = 'done';
    player.dungeonTickets.set('town.cave2', 2);
    context.markDirty(1, 'c1');
    context.markAccountDirty(1);
    await context.flush(1, 'c1');
  }

  it('进图：扣票恰好一次并建档（runId / mapKey / enemyBorn）', async () => {
    await giveAccess();
    await service.start(1, 'c1');
    const before = context.peek(1, 'c1')?.countTicket('town.cave2') ?? 0;

    const result = await service.enterMap(1, 'c1', DUNGEON, 'op-d1');
    expect(result.success).toBe(true);

    const player = context.peek(1, 'c1');
    expect(player?.countTicket('town.cave2')).toBe(before - 1); // 唯一扣费点：进图
    const extras = await context.extrasOf(1);
    const run = extras.dungeonRuns['c1'];
    expect(run?.mapKey).toBe(DUNGEON);
    expect(typeof run?.runId).toBe('string');
    expect(run?.enemyBorn).toBeDefined();
  });

  it('重登（stop → start）：恢复 run、标记已付费，且不重复扣票', async () => {
    await giveAccess();
    await service.start(1, 'c1');
    await service.enterMap(1, 'c1', DUNGEON, 'op-d2');
    const afterEnter = context.peek(1, 'c1')?.countTicket('town.cave2') ?? 0;
    const runId = (await context.extrasOf(1)).dungeonRuns['c1']?.runId;

    await service.stop(1, 'c1');
    const resumed = await service.start(1, 'c1');
    expect(resumed).not.toBeNull();
    if (!resumed) return;

    expect(resumed.world.map).toBe(DUNGEON);
    expect((resumed.world.enemyBorn as DungeonState).ticketPaid).toBe(true);
    expect(context.peek(1, 'c1')?.countTicket('town.cave2')).toBe(afterEnter); // 恢复不扣票
    expect((await context.extrasOf(1)).dungeonRuns['c1']?.runId).toBe(runId);
  });

  it('run 结束（world.map 离开秘境）→ 清档', async () => {
    await giveAccess();
    const session = await service.start(1, 'c1');
    await service.enterMap(1, 'c1', DUNGEON, 'op-d3');
    expect((await context.extrasOf(1)).dungeonRuns['c1']).toBeDefined();

    // 模拟内核通关：spawner 把 world.map 设为 outside
    if (session) session.world.map = 'home';
    service.tick();
    await new Promise((resolve) => setImmediate(resolve));
    expect((await context.extrasOf(1)).dungeonRuns['c1']).toBeUndefined();
  });

  it('停在秘境但没有 run 档（旧存档漂移）→ 未付费 run（通关不结算）', async () => {
    await giveAccess();
    const extras = await context.extrasOf(1);
    extras.worldMaps['c1'] = { map: DUNGEON, endlessLevel: 0 };
    delete extras.dungeonRuns['c1'];
    context.markAccountDirty(1);
    await context.flushAccount(1);

    const session = await service.start(1, 'c1');
    expect(session).not.toBeNull();
    if (!session) return;
    expect(session.world.map).toBe(DUNGEON);
    expect((session.world.enemyBorn as DungeonState).ticketPaid).toBe(false);
    expect((await context.extrasOf(1)).dungeonRuns['c1']).toBeUndefined();
  });
});
