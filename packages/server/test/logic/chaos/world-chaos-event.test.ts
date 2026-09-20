/**
 * `WorldService` 混沌 run 结算上报（W6）—— 事件延迟与即时两条路径。
 *
 * - `clear`：等守关 BOSS 尸体清理后再发 `ChaosRunEnded`（否则本 tick 换图会吞掉 BOSS 掉落）；
 * - `death`：立即上报；
 * - 非混沌图 / 无结果：不发事件。
 *
 * 用内存 DB + 真实 `WorldService` tick，不占真实时间。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createDefaultTables, type DataTables } from '@idle-dark/game-core';
import type { NotificationBatcher } from '../../../src/modules/game/notification-batcher.js';
import { OpIdempotencyService } from '../../../src/modules/game/op-idempotency.service.js';
import type { OnlineSessionService } from '../../../src/modules/online/online-session.service.js';
import { PanelCharacterService } from '../../../src/modules/logic/shared/panel-character.service.js';
import { PlayerContextService } from '../../../src/modules/logic/shared/player-context.service.js';
import { InProcessEventBus } from '../../../src/modules/logic/shared/event-bus.js';
import type { ChaosRunEndedEvent } from '../../../src/modules/logic/shared/events.js';
import { WorldService } from '../../../src/modules/logic/world/world.service.js';
import type { GameDatabaseService } from '../../../src/modules/game/game-database.service.js';
import { FakeDatabase } from '../../helpers/fake-database.js';

const tables: DataTables = createDefaultTables();

describe('WorldService · ChaosRunEnded 上报', () => {
  let db: FakeDatabase;
  let context: PlayerContextService;
  let service: WorldService;
  let bus: InProcessEventBus;
  let emitted: ChaosRunEndedEvent[];
  let now: number;

  beforeEach(async () => {
    db = new FakeDatabase();
    db.seedAccount(1);
    db.seedCharacter({ id: 'c1', user_id: 1, role: 'Eyer', career: 'warrior' });
    now = 1_700_000_000_000;
    context = new PlayerContextService(db.asService(), () => now, tables);
    const batcher = {
      enqueue: () => true,
      registerMerger: () => undefined,
      drop: () => 0,
      flushAll: () => ({ users: 0, frames: 0 }),
    } as unknown as NotificationBatcher;
    const onlineSessions = { isOnline: () => true } as unknown as OnlineSessionService;
    bus = new InProcessEventBus();
    emitted = [];
    bus.on('ChaosRunEnded', (event) => {
      if (event.type === 'ChaosRunEnded') emitted.push(event);
    });
    service = new WorldService(
      context,
      onlineSessions,
      new OpIdempotencyService(),
      new PanelCharacterService(db.asService() as unknown as GameDatabaseService),
      batcher,
      () => now,
      tables,
      bus,
    );

    await context.create(1, 'c1', 'Eyer', 'warrior');
    const extras = await context.extrasOf(1);
    extras.worldMaps['c1'] = { map: 'chaos.t01' };
    context.markAccountDirty(1);
    await context.flushAccount(1);
  });

  it('clear：BOSS 仍在场时不发，尸体清理后发一次且清位', async () => {
    const session = await service.start(1, 'c1');
    expect(session).not.toBeNull();
    const world = session!.world;
    world.chaosOutcome = 'clear';
    const boss = world.addEnemy('chapter3.murloc.warlord', null, 0);
    boss.worldBoss = true;

    now += 1;
    service.tick();
    expect(emitted).toHaveLength(0);
    expect(world.chaosOutcome).toBe('clear');

    world.removeUnit(boss);
    now += 1;
    service.tick();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'ChaosRunEnded',
      userId: 1,
      characterId: 'c1',
      tier: 1,
      outcome: 'clear',
    });
    expect(world.chaosOutcome).toBeNull();
  });

  it('death：立即上报', async () => {
    const session = await service.start(1, 'c1');
    session!.world.chaosOutcome = 'death';
    now += 1;
    service.tick();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.outcome).toBe('death');
  });

  it('非混沌图：即使置位也不上报（tier 解析为 null）', async () => {
    const extras = await context.extrasOf(1);
    extras.worldMaps['c1'] = { map: 'world.1' };
    context.markAccountDirty(1);
    await context.flushAccount(1);
    const session = await service.start(1, 'c1');
    // 内核只在混沌图置位；这里强行污染以验证防御分支。
    session!.world.chaosOutcome = 'clear';
    now += 1;
    service.tick();
    expect(emitted).toHaveLength(0);
    expect(session!.world.chaosOutcome).toBeNull();
  });
});
