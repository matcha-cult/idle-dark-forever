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
import type { WorldTickDto } from '@idle-dark/protocol';
import type { NotificationBatcher, PushFrame } from '../src/modules/game/notification-batcher.js';
import { OpIdempotencyService } from '../src/modules/game/op-idempotency.service.js';
import type { OnlineSessionService } from '../src/modules/online/online-session.service.js';
import { PlayerContextService } from '../src/modules/logic/shared/player-context.service.js';
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
    } as unknown as NotificationBatcher;
    const onlineSessions = {
      isOnline: () => online,
    } as unknown as OnlineSessionService;
    service = new WorldService(
      context,
      onlineSessions,
      new OpIdempotencyService(),
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
