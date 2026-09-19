/**
 * `WorldService` 受管 tick + 推送聚合单测（无 DB、无真实 WS）
 *
 * 覆盖：
 * - tick 只在**在线**时推进与推送（离线不推）；
 * - `stepPaused` 驱动虚拟时间前进并产生战斗事件；
 * - 推送经 batcher（绝不逐伤害直推），帧里 units 至少含玩家；
 * - `enterMap` 的 ALREADY_IN_MAP / MAP_LOCKED 错误路径；
 * - `leave` 结束会话。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createDefaultTables, type DataTables } from '@idle-dark/game-core';
import { STORY_CMD, type StoryUnlockDto, type WorldTickDto } from '@idle-dark/protocol';
import type { NotificationBatcher, PushFrame } from '../src/modules/game/notification-batcher.js';
import { OpIdempotencyService } from '../src/modules/game/op-idempotency.service.js';
import type { OnlineSessionService } from '../src/modules/online/online-session.service.js';
import { PanelCharacterService } from '../src/modules/logic/inventory/internal/panel-character.service.js';
import { PlayerContextService } from '../src/modules/logic/shared/player-context.service.js';
import type { AccountExtras } from '../src/modules/logic/shared/index.js';
import { WorldService } from '../src/modules/logic/world/world.service.js';
import { FakeDatabase } from './helpers/fake-database.js';

const tables: DataTables = createDefaultTables();

interface CapturedFrame extends PushFrame {
  userId: number;
}

describe('WorldService', () => {
  let db: FakeDatabase;
  let context: PlayerContextService;
  let service: WorldService;
  let frames: CapturedFrame[];
  let online: boolean;
  let now: number;

  beforeEach(() => {
    db = new FakeDatabase();
    db.seedAccount(1);
    db.seedCharacter({ id: 'c1', user_id: 1, role: 'Eyer', career: 'warrior' });
    now = 1_700_000_000_000;
    context = new PlayerContextService(db.asService(), () => now, tables);
    frames = [];
    online = true;
    const batcher = {
      enqueue: (userId: number, frame: PushFrame) => {
        frames.push({ userId, ...frame });
        return true;
      },
      registerMerger: () => undefined,
      drop: () => 0,
      flushAll: () => ({ users: 0, frames: 0 }),
    } as unknown as NotificationBatcher;
    const onlineSessions = {
      isOnline: () => online,
    } as unknown as OnlineSessionService;
    service = new WorldService(
      context,
      onlineSessions,
      new OpIdempotencyService(),
      new PanelCharacterService(db.asService() as unknown as GameDatabaseService),
      batcher,
      () => now,
      tables,
    );
  });

  async function startInStreet(): Promise<void> {
    const extras = await context.extrasOf(1);
    extras.worldMaps['c1'] = { map: 'town.street', endlessLevel: 0 };
    context.markAccountDirty(1);
    await context.flushAccount(1);
    const session = await service.start(1, 'c1');
    expect(session).not.toBeNull();
  }

  function tickFrames(): WorldTickDto[] {
    return frames
      .filter((frame) => frame.cmd === 30 && frame.subCmd === 5)
      .map((frame) => frame.data as WorldTickDto);
  }

  it('start 后 positionOf / activeCharacterOf 正确', async () => {
    await startInStreet();
    expect(service.positionOf(1, 'c1')).toEqual({ map: 'town.street', endlessLevel: 0 });
    expect(service.activeCharacterOf(1)).toBe('c1');
    expect(service.isInBattle(1, 'c1')).toBe(true);
  });

  it('在线 tick 推进虚拟时间并推送 world.tick（帧含玩家单位）', async () => {
    await startInStreet();
    for (let i = 0; i < 30; i += 1) {
      now += 1000;
      service.tick();
    }
    const ticks = tickFrames();
    expect(ticks.length).toBeGreaterThan(0);
    const first = ticks[0];
    expect(typeof first?.serverTime).toBe('number');
    expect(first?.units.some((unit) => unit.kind === 'player')).toBe(true);
    // 30s 虚拟时间足够刷出怪物并产生事件。
    expect(ticks.some((tick) => tick.events.length > 0)).toBe(true);
  });

  it('离线 tick 不推进、不推送', async () => {
    await startInStreet();
    online = false;
    for (let i = 0; i < 10; i += 1) {
      now += 1000;
      service.tick();
    }
    expect(tickFrames().length).toBe(0);
  });

  it('离线时**世界不推进**：不刷怪、不结算（在线对照会变）', async () => {
    const session = await service.start(1, 'c1');
    expect(session).not.toBeNull();
    if (!session) return;

    // 在线对照：跑 5 个 tick，刷怪器与战斗会改变世界
    for (let i = 0; i < 5; i += 1) {
      now += 1000;
      service.tick();
    }
    const unitsOnline = session.world.units.length;
    const expOnline = context.peek(1, 'c1')?.exp ?? 0;
    expect(unitsOnline).toBeGreaterThan(0);

    // 离线：同一账号没有活连接 → tickSession 早退，clock 不 stepPaused
    online = false;
    for (let i = 0; i < 20; i += 1) {
      now += 1000;
      service.tick();
    }
    expect(session.world.units.length).toBe(unitsOnline);
    expect(context.peek(1, 'c1')?.exp ?? 0).toBe(expOnline);
    expect(tickFrames().length).toBeGreaterThan(0); // 只统计在线那 5 tick 的推送
    const framesAfterOffline = tickFrames().length;
    for (let i = 0; i < 5; i += 1) {
      now += 1000;
      service.tick();
    }
    expect(tickFrames().length).toBe(framesAfterOffline);
  });

  it('enterMap 重复进入当前地图 → 成功（按「重置本图」处理，不报 ALREADY_IN_MAP）', async () => {
    await startInStreet();
    const result = await service.enterMap(1, 'c1', 'town.street');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map).toBe('town.street');
  });

  it('enterMap 条件未满足 → MAP_LOCKED', async () => {
    await startInStreet();
    const result = await service.enterMap(1, 'c1', 'town.valley');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('MAP_LOCKED');
  });

  it('enterMap 带 opId 幂等：同 opId 重复提交只切换一次', async () => {
    const session = await service.start(1, 'c1');
    expect(session).not.toBeNull();
    const extras = await context.extrasOf(1);
    extras.storiesMap['eyer-stories-1'] = 'done';

    const first = await service.enterMap(1, 'c1', 'town.street', 'op-map-1');
    expect(first.success).toBe(true);
    expect(service.positionOf(1, 'c1')?.map).toBe('town.street');

    const second = await service.enterMap(1, 'c1', 'town.street', 'op-map-1');
    expect(second.success).toBe(true);
    expect(service.positionOf(1, 'c1')?.map).toBe('town.street');
  });

  it('enterMap 未知地图 → MAP_LOCKED（不抛错）', async () => {
    await startInStreet();
    const result = await service.enterMap(1, 'c1', 'nope.nope');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('MAP_LOCKED');
  });

  it('snapshot 返回地图列表与单位快照', async () => {
    await startInStreet();
    const result = await service.snapshot(1, 'c1');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map).toBe('town.street');
    expect(result.data.units.length).toBeGreaterThan(0);
    expect(result.data.maps.length).toBeGreaterThan(0);
    expect(result.data.paused).toBe(true);
  });

  it('snapshot 角色不存在 → PLAYER_NOT_FOUND', async () => {
    const result = await service.snapshot(1, 'missing');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('PLAYER_NOT_FOUND');
  });

  it('leave 结束会话；重复 leave → NOT_IN_MAP', async () => {
    await startInStreet();
    const first = await service.leave(1, 'c1');
    expect(first.success).toBe(true);
    expect(service.isInBattle(1, 'c1')).toBe(false);
    const second = await service.leave(1, 'c1');
    expect(second.success).toBe(false);
    if (!second.success) expect(second.data.code).toBe('NOT_IN_MAP');
  });

  it('skipOffline 重置锚点并返回零收益报告', async () => {
    await context.load(1, 'c1');
    now += 3600_000;
    const result = await service.skipOffline(1, 'c1');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.offlineMs).toBeGreaterThan(0);
    expect(result.data.gainedExp).toBe(0);
    expect(result.data.kills).toBe(0);
    expect(service.pendingOfflineMs(1, 'c1')).toBe(0);
  });
});

describe('WorldService · 进图自动触发剧情（原版 MapPanel.checkStories）', () => {
  let db: FakeDatabase;
  let context: PlayerContextService;
  let service: WorldService;
  let frames: CapturedFrame[];
  let now: number;

  beforeEach(() => {
    db = new FakeDatabase();
    db.seedAccount(1);
    db.seedCharacter({ id: 'c1', user_id: 1, role: 'Eyer', career: 'warrior' });
    now = 1_700_000_000_000;
    context = new PlayerContextService(db.asService(), () => now, tables);
    frames = [];
    const batcher = {
      enqueue: (userId: number, frame: PushFrame) => {
        frames.push({ userId, ...frame });
        return true;
      },
      registerMerger: () => undefined,
      drop: () => 0,
      flushAll: () => ({ users: 0, frames: 0 }),
    } as unknown as NotificationBatcher;
    const onlineSessions = { isOnline: () => true } as unknown as OnlineSessionService;
    service = new WorldService(
      context,
      onlineSessions,
      new OpIdempotencyService(),
      new PanelCharacterService(db.asService() as unknown as GameDatabaseService),
      batcher,
      () => now,
      tables,
    );
  });

  function storyUnlocks(): StoryUnlockDto[] {
    return frames
      .filter((frame) => frame.cmd === STORY_CMD.cmd && frame.subCmd === STORY_CMD.unlock)
      .map((frame) => frame.data as StoryUnlockDto);
  }

  it('会话落地在 home → 推 eyer-stories-1 且 autoPlay=true（进游戏即自动播放）', async () => {
    await service.start(1, 'c1');
    expect(storyUnlocks()).toEqual([
      {
        key: 'eyer-stories-1',
        name: tables.stories['eyer-stories-1']?.name,
        taskType: 'script',
        autoPlay: true,
      },
    ]);
  });

  it('完成剧情 1 后进 town.street → 推剧情 2（纯剧情脚本，autoPlay=true）', async () => {
    const extras = await context.extrasOf(1);
    extras.storiesMap['eyer-stories-1'] = 'done';
    await service.start(1, 'c1');
    frames.length = 0;

    const result = await service.enterMap(1, 'c1', 'town.street');
    expect(result.success).toBe(true);
    expect(storyUnlocks()).toEqual([
      {
        key: 'eyer-stories-2',
        name: tables.stories['eyer-stories-2']?.name,
        taskType: 'script',
        autoPlay: true,
      },
    ]);
    // 服务端不替玩家 finish：剧本仍是未开启状态
    expect(extras.storiesMap['eyer-stories-2']).toBeUndefined();
  });

  it('剧情 2 完成后进 town.street → 静默登记剧情 3 并推 autoPlay=false', async () => {
    const extras = await context.extrasOf(1);
    extras.storiesMap['eyer-stories-1'] = 'done';
    extras.storiesMap['eyer-stories-2'] = 'done';
    await service.start(1, 'c1');
    frames.length = 0;

    const result = await service.enterMap(1, 'c1', 'town.street');
    expect(result.success).toBe(true);
    expect(storyUnlocks()).toEqual([
      {
        key: 'eyer-stories-3',
        name: tables.stories['eyer-stories-3']?.name,
        taskType: 'kill',
        autoPlay: false,
      },
    ]);
    expect(extras.storiesMap['eyer-stories-3']).toBe('task');
    expect(extras.enemyTasks['slime.minimal']?.['eyer-stories-3']).toBe(10);
  });

  it('击杀任务达成 → 推 autoPlay=true（原版 checkKill 当场弹剧本）', async () => {
    const extras = await context.extrasOf(1);
    extras.storiesMap['eyer-stories-3'] = 'task';
    extras.enemyTasks['slime.minimal'] = { 'eyer-stories-3': 1 };
    await service.start(1, 'c1');
    frames.length = 0;

    // 直接调用击杀回调（`WorldService` 把它注入给战斗内核，单测里跳过真实战斗）。
    const hook = service as unknown as {
      onEnemyKilled: (userId: number, extras: AccountExtras, type: string, count: number) => void;
    };
    hook.onEnemyKilled(1, extras, 'slime.minimal', 1);
    expect(extras.enemyTasks['slime.minimal']?.['eyer-stories-3']).toBe(0);
    expect(storyUnlocks()).toEqual([
      {
        key: 'eyer-stories-3',
        name: tables.stories['eyer-stories-3']?.name,
        taskType: 'script',
        autoPlay: true,
      },
    ]);

    // 已经为 0 的任务不会重复推送
    frames.length = 0;
    hook.onEnemyKilled(1, extras, 'slime.minimal', 1);
    expect(storyUnlocks()).toEqual([]);
  });
});
