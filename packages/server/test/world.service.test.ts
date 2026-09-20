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
import { type WorldTickDto } from '@idle-dark/protocol';
import type { NotificationBatcher, PushFrame } from '../src/modules/game/notification-batcher.js';
import { OpIdempotencyService } from '../src/modules/game/op-idempotency.service.js';
import type { OnlineSessionService } from '../src/modules/online/online-session.service.js';
import { PanelCharacterService } from '../src/modules/logic/shared/panel-character.service.js';
import { PlayerContextService } from '../src/modules/logic/shared/player-context.service.js';
import { InProcessEventBus } from '../src/modules/logic/shared/event-bus.js';
import { WorldService } from '../src/modules/logic/world/world.service.js';
import { WORLD_CONFIG } from '../src/modules/logic/world/world.config.js';
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
      new InProcessEventBus(),
    );
  });

  async function startInStreet(): Promise<void> {
    const extras = await context.extrasOf(1);
    extras.worldMaps['c1'] = { map: 'world.1', endlessLevel: 0 };
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
    expect(service.positionOf(1, 'c1')).toEqual({ map: 'world.1', endlessLevel: 0 });
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
    const result = await service.enterMap(1, 'c1', 'world.1');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map).toBe('world.1');
  });

  it('enterMap 条件未满足 → MAP_LOCKED', async () => {
    await startInStreet();
    // world.9 要求 level 75，1 级角色不可进。
    const result = await service.enterMap(1, 'c1', 'world.9');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('MAP_LOCKED');
  });

  it('enterMap 带 opId 幂等：同 opId 重复提交只切换一次', async () => {
    const session = await service.start(1, 'c1');
    expect(session).not.toBeNull();

    const first = await service.enterMap(1, 'c1', 'world.1', 'op-map-1');
    expect(first.success).toBe(true);
    expect(service.positionOf(1, 'c1')?.map).toBe('world.1');

    const second = await service.enterMap(1, 'c1', 'world.1', 'op-map-1');
    expect(second.success).toBe(true);
    expect(service.positionOf(1, 'c1')?.map).toBe('world.1');
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
    expect(result.data.map).toBe('world.1');
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

  it('world_time_ratio：在线稳定推进 20 轮后 ≈ 1（世界时间 = 真实时间），无截断', async () => {
    await startInStreet();
    for (let i = 0; i < 20; i += 1) {
      now += 200;
      service.tick();
    }
    const stats = service.stats;
    expect(stats.worldTimeRatio).toBeGreaterThan(0.99);
    expect(stats.worldTimeRatioMin).toBeGreaterThan(0.99);
    expect(stats.truncatedMsTotal).toBe(0);
    expect(stats.roundsTotal).toBe(20);
    expect(stats.roundsCutOff).toBe(0);
    expect(stats.callbackBudgetPerRound).toBe(WORLD_CONFIG.globalCallbackBudgetPerRound);
  });

  it('预算驱动：150 个在线会话**一轮全部** tick（已无 maxCharactersPerTick=100 的人数上限）', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 150; i += 1) {
      const id = `bulk-${i}`;
      db.seedCharacter({ id, user_id: 1, role: 'Eyer', career: 'warrior' });
      ids.push(id);
    }
    for (const id of ids) {
      await service.start(1, id);
    }
    frames.length = 0;
    service.tick();
    // 旧实现（每轮最多 100 个）这里只会推 100 帧。
    expect(tickFrames().length).toBe(150);
    expect(service.stats.sessionsTotal).toBe(150);
    expect(service.stats.roundCharsProcessed).toBe(150);
    expect(service.stats.roundsCutOff).toBe(0);
  });

  it('stats 边界：无会话时 ratio 定义为 1、各计数为 0（不产生 NaN）', () => {
    const stats = service.stats;
    expect(stats.sessionsTotal).toBe(0);
    expect(stats.onlineCharacters).toBe(0);
    expect(stats.worldTimeRatio).toBe(1);
    expect(stats.worldTimeRatioMin).toBe(1);
    expect(stats.worldTimeRatioP50).toBe(1);
    expect(Number.isNaN(stats.roundCpuMs)).toBe(false);
  });

  it('空闲会话回收：离线超阈值 → 会话释放，且**先落库**（脏数据不丢）', async () => {
    service.sessionIdleReapMs = 1_000;
    await startInStreet();
    expect(service.sessionCount).toBe(1);

    online = false;
    now += 1_100; // 超过阈值
    service.tick();
    // stop() 同步删除会话，异步 flush 落库
    expect(service.sessionCount).toBe(0);
    expect(service.stats.sessionReapedTotal).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(context.stats.dirty).toBe(0); // 已 flush，脏数据未丢
    expect(context.peek(1, 'c1')).not.toBeNull();
  });

  it('空闲回收阈值 <= 0 → 关闭回收（会话保留）', async () => {
    service.sessionIdleReapMs = 0;
    await startInStreet();
    online = false;
    now += 10 * 60_000;
    service.tick();
    expect(service.sessionCount).toBe(1);
    expect(service.stats.sessionReapedTotal).toBe(0);
  });

  it('在线会话即使超阈值也绝不回收（在线优先）', async () => {
    service.sessionIdleReapMs = 1;
    await startInStreet();
    now += 10 * 60_000;
    service.tick();
    expect(service.sessionCount).toBe(1);
    expect(service.stats.sessionReapedTotal).toBe(0);
  });
});
