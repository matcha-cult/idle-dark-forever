/**
 * `WorldService` 受管 tick + 推送聚合单测（无 DB、无真实 WS）
 *
 * 覆盖：
 * - tick 只在**在线**时推进与推送（离线不推）；
 * - `stepPaused` 驱动虚拟时间前进并产生战斗事件；
 * - 推送经 batcher（绝不逐伤害直推），P2 起状态走 `patch`（首帧为 `reset`，含玩家单位）；
 * - `enterMap` 的 ALREADY_IN_MAP / MAP_LOCKED 错误路径；
 * - `leave` 结束会话。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  createDefaultTables,
  EnemyUnit,
  WORLD_BOSS_WAVE_INTERVAL,
  type DataTables,
} from '@idle-dark/game-core';
import { type WorldTickDto } from '@idle-dark/protocol';
import type { NotificationBatcher, PushFrame } from '../src/modules/game/notification-batcher.js';
import { OpIdempotencyService } from '../src/modules/game/op-idempotency.service.js';
import type { OnlineSessionService } from '../src/modules/online/online-session.service.js';
import { PanelCharacterService } from '../src/modules/logic/shared/panel-character.service.js';
import { PlayerContextService } from '../src/modules/logic/shared/player-context.service.js';
import { worldWaveOf } from '../src/modules/logic/shared/world-map-state.js';
import { InProcessEventBus } from '../src/modules/logic/shared/event-bus.js';
import { WorldService } from '../src/modules/logic/world/world.service.js';
import { WORLD_CONFIG } from '../src/modules/logic/world/world.config.js';
import { FakeDatabase } from './helpers/fake-database.js';
import { foldPatches } from './helpers/unit-patch.js';

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
  let enqueueOk: boolean;

  beforeEach(() => {
    db = new FakeDatabase();
    db.seedAccount(1);
    db.seedCharacter({ id: 'c1', user_id: 1, role: 'Eyer', career: 'warrior' });
    now = 1_700_000_000_000;
    context = new PlayerContextService(db.asService(), () => now, tables);
    frames = [];
    online = true;
    enqueueOk = true;
    const batcher = {
      enqueue: (userId: number, frame: PushFrame) => {
        if (!enqueueOk) return false;
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

  async function startInStreet() {
    const extras = await context.extrasOf(1);
    extras.worldMaps['c1'] = { map: 'world.1' };
    context.markAccountDirty(1);
    await context.flushAccount(1);
    const session = await service.start(1, 'c1');
    expect(session).not.toBeNull();
    return session!;
  }

  function tickFrames(): WorldTickDto[] {
    return frames
      .filter((frame) => frame.cmd === 30 && frame.subCmd === 5)
      .map((frame) => frame.data as WorldTickDto);
  }

  it('start 后 positionOf / activeCharacterOf 正确', async () => {
    await startInStreet();
    expect(service.positionOf(1, 'c1')).toEqual({ map: 'world.1' });
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
    // P2：`units`/`events` 停填，状态走 `patch`；首帧必须是 `reset`（客户端基线）。
    expect(first?.units).toEqual([]);
    expect(first?.events).toEqual([]);
    expect(first?.patch?.[0]?.op).toBe('reset');
    expect(first?.seq).toBe(1);
    // 独立折叠补丁流 → 单位表里必须有玩家单位。
    expect([...foldPatches(ticks).values()].some((unit) => unit.kind === 'player')).toBe(true);
    // 30s 虚拟时间足够刷出怪物并产生事件（P2：日志走 `log` 分区）。
    expect(ticks.some((tick) => (tick.log ?? []).length > 0)).toBe(true);
  });

  it('P2：世界无变化的窗口**不推送任何消息**（静默抑制）', async () => {
    await startInStreet();
    now += 1000;
    service.tick();
    // 首帧必为 reset（客户端基线）。
    expect(tickFrames().length).toBe(1);
    expect(tickFrames()[0]?.patch?.[0]?.op).toBe('reset');

    frames.length = 0;
    // 时间不推进 ⇒ 世界无任何变化 ⇒ 整帧不入队。
    service.tick();
    expect(tickFrames().length).toBe(0);
  });

  it('P2：入队被丢弃时不前进基线，下一窗口重发（客户端自动追平）', async () => {
    await startInStreet();
    enqueueOk = false;
    now += 1000;
    service.tick();
    expect(tickFrames().length).toBe(0);

    enqueueOk = true;
    now += 1;
    service.tick();
    // 基线未前进 ⇒ 仍然从 `reset` 开始，客户端不会漏掉第一帧。
    expect(tickFrames()[0]?.patch?.[0]?.op).toBe('reset');
    expect(tickFrames()[0]?.seq).toBe(1);
  });

  it('P2：帧形状 —— units/events 恒空、seq 递增、每帧至少一个非空分区', async () => {
    await startInStreet();
    for (let i = 0; i < 30; i += 1) {
      now += 1000;
      service.tick();
    }
    const ticks = tickFrames();
    expect(ticks.length).toBeGreaterThan(0);

    // ⚠️ 不要断言「每帧都有非空 patch」：`patch` **合法为空** ——
    // 只发生日志 / 经验金币 / 波次推进的窗口同样要发帧（判据见 `worldFrameOf`）。
    // 真正的不变式是「发出去的帧至少有一个非空分区」（其逆否即「无变化不发」）。
    let prevWave = 0;
    let prevBossPending = false;
    for (const frame of ticks) {
      expect(frame.units).toEqual([]);
      expect(frame.events).toEqual([]);
      expect(Array.isArray(frame.patch)).toBe(true);
      expect(Array.isArray(frame.log)).toBe(true);
      expect(Array.isArray(frame.loot)).toBe(true);
      const wave = frame.wave ?? 0;
      const bossPending = frame.bossPending === true;
      const hasContent =
        (frame.patch ?? []).length > 0 ||
        (frame.log ?? []).length > 0 ||
        (frame.loot ?? []).length > 0 ||
        frame.gainedExp !== 0 ||
        frame.gainedGold !== 0 ||
        wave !== prevWave ||
        bossPending !== prevBossPending;
      expect(hasContent).toBe(true);
      prevWave = wave;
      prevBossPending = bossPending;
    }

    // 首帧必为 `reset`（客户端差分基线），因此至少有帧带补丁。
    expect(ticks.some((frame) => (frame.patch ?? []).length > 0)).toBe(true);
    expect(ticks[0]?.patch?.[0]?.op).toBe('reset');

    const seqs = ticks.map((frame) => frame.seq ?? 0);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    // P2：掉落并帧，不再产生 (battle, loot) 独立推送路由。
    expect(frames.some((frame) => frame.cmd === 40 && frame.subCmd === 2)).toBe(false);
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

  // ─────────────────────────── W4：波次下发与持久化 ───────────────────────────

  it('tick 下发 wave / bossEvery（服务端权威波次）', async () => {
    await startInStreet();
    now += 1000;
    service.tick();
    const ticks = tickFrames();
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0]?.wave).toBe(0);
    expect(ticks[0]?.bossEvery).toBe(WORLD_BOSS_WAVE_INTERVAL);
  });

  it('snapshot 下发 wave / bossEvery', async () => {
    await startInStreet();
    const result = await service.snapshot(1, 'c1');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.wave).toBe(0);
    expect(result.data.bossEvery).toBe(WORLD_BOSS_WAVE_INTERVAL);
  });

  it('snapshot / tick 下发 bossPending：未通关 true，已通关 false（UI 据此收起倒计时）', async () => {
    const session = await startInStreet();
    const live = await service.snapshot(1, 'c1');
    expect(live.success).toBe(true);
    if (!live.success) return;
    expect(live.data.bossPending).toBe(true);

    now += 1000;
    service.tick();
    expect(tickFrames()[0]?.bossPending).toBe(true);

    // 直接改内核的击杀登记（等价于「刚通关」）→ 下一个窗口必须把翻转下发出去。
    session.world.player!.markWorldBossKilled?.('world.1');
    frames.length = 0;
    now += 1000;
    service.tick();
    expect(tickFrames().some((frame) => frame.bossPending === false)).toBe(true);
  });

  it('wave 持久化往返：stop 保存 → start 恢复（会话重启不丢波数）', async () => {
    await startInStreet();
    const live = await service.start(1, 'c1');
    expect(live?.world.enemyBorn).not.toBeNull();
    if (!live || !live.world.enemyBorn) return;
    live.world.enemyBorn.wave = 7;

    await service.stop(1, 'c1');
    const extras = await context.extrasOf(1);
    expect(extras.worldMaps['c1']).toEqual({ map: 'world.1', wave: 7 });

    const restarted = await service.start(1, 'c1');
    expect(restarted?.world.enemyBorn?.wave).toBe(7);
    const snapshot = await service.snapshot(1, 'c1');
    expect(snapshot.success).toBe(true);
    if (snapshot.success) expect(snapshot.data.wave).toBe(7);
  });

  it('切图后波数归 0（换图重建 EnemyBorn）', async () => {
    await startInStreet();
    const live = await service.start(1, 'c1');
    if (!live?.world.enemyBorn) throw new Error('缺少刷怪器');
    live.world.enemyBorn.wave = 7;

    // world.1 → home（安全区，无进入条件）。
    const entered = await service.enterMap(1, 'c1', 'home');
    expect(entered.success).toBe(true);
    const extras = await context.extrasOf(1);
    expect(extras.worldMaps['c1']?.map).toBe('home');
    expect(worldWaveOf(extras.worldMaps['c1']?.wave)).toBe(0);

    // 回到 world.1：波数从 0 开始（不残留 7）。
    await service.enterMap(1, 'c1', 'world.1');
    const back = await service.start(1, 'c1');
    expect(back?.world.enemyBorn?.wave).toBe(0);
  });

  it('重复进入当前地图（重置本图）→ 波数归 0 并落库', async () => {
    await startInStreet();
    const live = await service.start(1, 'c1');
    if (!live?.world.enemyBorn) throw new Error('缺少刷怪器');
    live.world.enemyBorn.wave = 9;

    const result = await service.enterMap(1, 'c1', 'world.1');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.wave).toBe(0);
    const extras = await context.extrasOf(1);
    expect(worldWaveOf(extras.worldMaps['c1']?.wave)).toBe(0);
  });

  it('第 20 波刷出的守关 BOSS 在 tick 中带 boss 标记', async () => {
    await startInStreet();
    const live = await service.start(1, 'c1');
    if (!live?.world.enemyBorn) throw new Error('缺少刷怪器');
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) live.world.enemyBorn.completeWave();

    now += 1000;
    service.tick();
    const ticks = tickFrames();
    const last = ticks.at(-1);
    expect(last?.wave).toBe(WORLD_BOSS_WAVE_INTERVAL);
    const units = [...foldPatches(ticks).values()];
    expect(units.some((unit) => unit.boss === true)).toBe(true);
    // `boss` 是可选字段：非 BOSS 单位一律省略（不为 false）。
    expect(units.every((unit) => unit.boss === undefined || unit.boss === true)).toBe(true);
  });

  it('脏波数（NaN / Infinity / -1 / 非数字 / 0）一律解析为 0', async () => {
    for (const dirty of [Number.NaN, Number.POSITIVE_INFINITY, -1, 'x', null, 0, {}]) {
      db.accounts.get(1)!.data = { worldMaps: { c1: { map: 'world.1', wave: dirty } } };
      const fresh = new PlayerContextService(db.asService(), () => now, tables);
      const extras = await fresh.extrasOf(1);
      expect(worldWaveOf(extras.worldMaps['c1']?.wave)).toBe(0);
    }
  });

  it('合法波数（含小数）解析为截断正整数', async () => {
    db.accounts.get(1)!.data = { worldMaps: { c1: { map: 'world.1', wave: 7.9 } } };
    const fresh = new PlayerContextService(db.asService(), () => now, tables);
    const extras = await fresh.extrasOf(1);
    expect(worldWaveOf(extras.worldMaps['c1']?.wave)).toBe(7);
  });

  // ────────────────────────────── W11 / R3 / 决策 4 ──────────────────────────────

  it('W11：四阶稀有度在 tick 帧里下发（普通 0 / 稀有 1 / 精英 2 / 传奇 3）', async () => {
    await startInStreet();
    const live = await service.start(1, 'c1');
    const world = live!.world;
    world.addEnemy('slime.minimal', null, 0); // 普通
    world.addEnemy('slime.minimal', null, 1); // 稀有
    const elite = world.addEnemy('slime.minimal', null, 2); // 精英（quality 2）
    elite.elite = true;
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) world.enemyBorn!.completeWave();

    now += 1000;
    service.tick();
    const units = [...foldPatches(tickFrames()).values()];
    const rarities = new Set(units.map((u) => u.rarity));
    expect(rarities.has(0)).toBe(true); // 普通
    expect(rarities.has(1)).toBe(true); // 稀有
    expect(rarities.has(2)).toBe(true); // 精英
    expect(rarities.has(3)).toBe(true); // 传奇（守关 BOSS）

    // `elite` 与 `boss` 一样是可选出生字段：非精英一律省略（不为 false）。
    expect(units.filter((u) => u.elite === true)).toHaveLength(1);
    expect(units.every((u) => u.elite === undefined || u.elite === true)).toBe(true);
    // 精英的 `rarity` 必须是 2（服务端派生，不靠前端拼）。
    expect(units.find((u) => u.elite === true)?.rarity).toBe(2);
  });

  it('R3 回归：会话重启后守关 BOSS **当波补刷**（旧实现要等到第 40 波）', async () => {
    await startInStreet();
    const live = await service.start(1, 'c1');
    if (!live?.world.enemyBorn) throw new Error('缺少刷怪器');
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) live.world.enemyBorn.completeWave();
    expect(live.world.enemyBorn.wave).toBe(WORLD_BOSS_WAVE_INTERVAL);
    expect(bossCount(live.world)).toBe(1);
    expect(eliteCount(live.world)).toBe(1); // 第 10 波精英

    // 重启：会话销毁（BOSS / 精英单位不入档），侧车留下 wave=20 + 里程碑。
    await service.stop(1, 'c1');
    const back = await service.start(1, 'c1');
    expect(back?.world.enemyBorn?.wave).toBe(WORLD_BOSS_WAVE_INTERVAL);
    expect(bossCount(back!.world)).toBe(1);
    // 已交付过的精英**不会**重复补刷（里程碑幂等）。
    expect(eliteCount(back!.world)).toBe(0);
  });

  it('W11 决策 4：野外阵亡 → 本图 run 重开（波数归 0、清场），会话不销毁', async () => {
    await startInStreet();
    const live = await service.start(1, 'c1');
    const spawner = live!.world.enemyBorn!;
    for (let i = 0; i < 12; i += 1) spawner.completeWave();
    expect(spawner.wave).toBe(12);
    expect(eliteCount(live!.world)).toBe(1);

    live!.world.playerUnit!.kill();
    expect(live!.world.openWorldDeath).toBe(true);

    now += 1000;
    service.tick();

    expect(live!.world.openWorldDeath).toBe(false);
    expect(live!.world.enemyBorn).not.toBe(spawner);
    expect(live!.world.enemyBorn!.wave).toBe(0);
    expect(live!.world.enemyBorn!.lastEliteWave).toBe(0);
    // 清场：只剩玩家（及其召唤链）。
    expect(live!.world.units.every((u) => u.camp === 'player' || u.camp === 'ghost')).toBe(true);
    // 会话没被销毁：玩家单位仍在（原地复活照常）。
    expect(live!.world.playerUnit).toBeTruthy();

    // 波数 0 也落了库（`stop` 走 `persistPosition`，同步可断言）。
    await service.stop(1, 'c1');
    const extras = await context.extrasOf(1);
    expect(extras.worldMaps['c1']?.map).toBe('world.1');
    expect(worldWaveOf(extras.worldMaps['c1']?.wave)).toBe(0);
  });

  it('W11 决策 3：击杀守关 BOSS → **等清尸后**自动重进本图（波次归 0），且掉落没被吞', async () => {
    await startInStreet();
    const live = await service.start(1, 'c1');
    const world = live!.world;
    const spawner = world.enemyBorn!;

    // 给这只 BOSS 挂一条 `rate: 1` 的必掉，让「掉落有没有被吞」可确定性断言
    // （真实掉落表全是概率条目，可能合法地一件都不掉）。
    // ⚠️ 用**钱包物品**（通货）而不是 `gold`：`gold` 的落地量会乘 `gf`（金币加成），
    // 无装备时可能是 0，那样连 `handled:'lost'` 都算不出正数，断言会失真。
    const bossLoots = (tables.enemies['slime.giant.enemy']!.loots ??= []);
    bossLoots.push({ key: 'currency.transmute', count: [1, 1], rate: 1 });
    try {
      for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
      const boss = world.units.find(
        (u): u is EnemyUnit => u instanceof EnemyUnit && u.worldBoss,
      );
      expect(boss).toBeTruthy();

      boss!.kill(); // shouldWait=true → 3s 后清尸（掉落结算在 clean）
      expect(world.openWorldCleared).toBe(true);
      expect(world.bossPending).toBe(false); // 一次性：已登记 → 之后是挂机节拍

      // 清尸之前：**不**重开（提前重开会 dispose 清尸计时器 → 吞掉落）。
      now += 1000;
      service.tick();
      expect(world.enemyBorn).toBe(spawner);
      expect(spawner.wave).toBe(WORLD_BOSS_WAVE_INTERVAL);
      expect(world.openWorldCleared).toBe(true);

      // 越过清尸周期 → 重开本图：新刷怪器、波数 0、清场、标志清零。
      now += 3000;
      service.tick();
      expect(world.openWorldCleared).toBe(false);
      expect(world.enemyBorn).not.toBe(spawner);
      expect(world.enemyBorn!.wave).toBe(0);
      expect(world.playerUnit).toBeTruthy();
      expect(bossLoots.length).toBeGreaterThan(0);

      // 掉落确实落到了帧上（证明等清尸换来的掉落没被吞）。
      // 掉落确实落到了帧上（证明「等清尸」换来的掉落没被吞）。
      // ⚠️ `LootDto` 是 `{ slot: {...}, handled }` 的**嵌套**形状，key 在 `slot.key`。
      const loots = tickFrames().flatMap((frame) => frame.loot ?? []);
      const drop = loots.find((loot) => loot.slot?.key === 'currency.transmute');
      expect(drop).toBeTruthy();
      expect(drop!.handled).toBe('pickup'); // 真落地，不是 'lost'
    } finally {
      bossLoots.pop();
    }
  });

  it('W11 决策 3：混沌图击杀 BOSS **不**走「通关重进」（由 chaosOutcome 决定）', async () => {
    await startInStreet();
    const live = await service.start(1, 'c1');
    const world = live!.world;
    // 直接把会话挪到混沌图（跳过混沌仪入口，只为验证内核分支）。
    world.map = 'chaos.t01';
    world.onMapChanged();
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) world.enemyBorn!.completeWave();
    const boss = world.units.find((u): u is EnemyUnit => u instanceof EnemyUnit && u.worldBoss);
    boss!.kill();
    expect(world.openWorldCleared).toBe(false);
    expect(world.chaosOutcome).toBe('clear');
  });

  it('W11 决策 4：混沌图阵亡**不**走野外重开（保持 chaosOutcome 失败分支）', async () => {
    await startInStreet();
    const live = await service.start(1, 'c1');
    // 直接把会话挪到混沌图（跳过混沌仪入口，只为验证内核分支）。
    live!.world.map = 'chaos.t01';
    live!.world.onMapChanged();
    live!.world.playerUnit!.kill();
    expect(live!.world.openWorldDeath).toBe(false);
    expect(live!.world.chaosOutcome).toBe('death');

    now += 1000;
    service.tick();
    // 重开标志没置位 ⇒ tick 不应重置刷怪器波数（波数保持 0，但也不是被"重开"过）。
    expect(live!.world.enemyBorn!.wave).toBe(0);
  });
});

/** 场上守关 BOSS 数量。 */
function bossCount(world: { units: unknown[] }): number {
  return world.units.filter((u) => (u as { worldBoss?: boolean }).worldBoss === true).length;
}

/** 场上精英数量。 */
function eliteCount(world: { units: unknown[] }): number {
  return world.units.filter((u) => (u as { elite?: boolean }).elite === true).length;
}
