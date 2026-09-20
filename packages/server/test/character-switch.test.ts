/**
 * 角色会话归属：**一个账号同一时刻只能有一个活跃角色会话**，推送只来自当前角色。
 *
 * 背景（实测复现过的缺陷）：旧实现 `player.select` 只 `start(新角色)` 不停旧会话，
 * 而框架的定向推送是按 `userId` 扇出到该账号的**全部** OPEN 连接 →
 * 同账号两条连接会「互相收到/推进对方的角色」：
 * ```
 * A 选 charX、B 选 charY
 * A 不带 key 调 world.snapshot → 解析到 charY（串号）
 * 2 秒内 tick：A=9 B=10，其中 9 帧 serverTime 完全相同（同一批被投给两个连接）
 * ```
 * 本文件把修复后的语义钉死：切人停旧会话、`activeCharacterOf` 不残留、
 * 角色归属校验 fail-closed、tick 帧里只出现当前角色。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createDefaultTables, type DataTables } from '@idle-dark/game-core';
import { WORLD_CMD, type WorldTickDto } from '@idle-dark/protocol';
import type { DatabaseService } from '../src/modules/database/database.service.js';
import type { GameDatabaseService } from '../src/modules/database/game-database.service.js';
import { CharacterService } from '../src/modules/character/character.service.js';
import type { NotificationBatcher, PushFrame } from '../src/modules/game/notification-batcher.js';
import { OpIdempotencyService } from '../src/modules/game/op-idempotency.service.js';
import type { OnlineSessionService } from '../src/modules/online/online-session.service.js';
import { PanelCharacterService } from '../src/modules/logic/shared/panel-character.service.js';
import { PlayerLogicService } from '../src/modules/logic/player/player-logic.service.js';
import { PlayerContextService } from '../src/modules/logic/shared/player-context.service.js';
import { InProcessEventBus } from '../src/modules/logic/shared/event-bus.js';
import { WorldService } from '../src/modules/logic/world/world.service.js';
import { FakeDatabase } from './helpers/fake-database.js';

const tables: DataTables = createDefaultTables();
const NOW = 1_700_000_000_000;
const X = 'char-x';
const Y = 'char-y';

interface CapturedFrame extends PushFrame {
  userId: number;
}

describe('角色会话归属（切人 / 当前角色 / 推送范围）', () => {
  let db: FakeDatabase;
  let context: PlayerContextService;
  let world: WorldService;
  let players: PlayerLogicService;
  let panelCharacters: PanelCharacterService;
  let frames: CapturedFrame[];
  let now: number;

  beforeEach(() => {
    db = new FakeDatabase();
    db.seedAccount(1, { player_slot_count: 3 });
    db.seedCharacter({ id: X, user_id: 1, name: '甲' });
    db.seedCharacter({ id: Y, user_id: 1, name: '乙' });
    now = NOW;
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
    panelCharacters = new PanelCharacterService(db.asService() as unknown as GameDatabaseService);
    const events = new InProcessEventBus();
    world = new WorldService(
      context,
      onlineSessions,
      new OpIdempotencyService(),
      panelCharacters,
      batcher,
      () => now,
      tables,
      events,
    );
    const characters = new CharacterService(
      db.asService() as unknown as DatabaseService,
      context,
      world,
      tables,
    );
    players = new PlayerLogicService(
      characters,
      context,
      world,
      new OpIdempotencyService(),
      panelCharacters,
      () => now,
      tables,
    );
  });

  function tickFrames(): WorldTickDto[] {
    return frames
      .filter((frame) => frame.cmd === WORLD_CMD.cmd && frame.subCmd === WORLD_CMD.tick)
      .map((frame) => frame.data as WorldTickDto);
  }

  /** tick 帧里玩家单位的 `typeKey` = 角色 key（服务端权威标识）。 */
  function playerKeysInTicks(): string[] {
    const keys: string[] = [];
    for (const frame of tickFrames()) {
      for (const unit of frame.units) {
        if (unit.kind === 'player') keys.push(unit.typeKey);
      }
    }
    return keys;
  }

  function runTicks(times: number): void {
    for (let i = 0; i < times; i += 1) {
      now += 1_000;
      world.tick();
    }
  }

  it('切角色会停掉旧会话：不会同时存在两个活跃会话', async () => {
    const first = await players.select(1, X);
    expect(first.success).toBe(true);
    expect(world.isInBattle(1, X)).toBe(true);

    const second = await players.select(1, Y);
    expect(second.success).toBe(true);

    // ✅ 旧会话已停（修复前这里仍是 true → 两个角色同时 tick）
    expect(world.isInBattle(1, X)).toBe(false);
    expect(world.isInBattle(1, Y)).toBe(true);
    expect(world.activeCharacterOf(1)).toBe(Y);
  });

  it('tick 推送里只出现当前角色的玩家单位（不会再混入旧角色）', async () => {
    await players.select(1, X);
    runTicks(3);
    expect(playerKeysInTicks().every((key) => key === X)).toBe(true);

    await players.select(1, Y);
    frames.length = 0;
    runTicks(3);

    const keys = playerKeysInTicks();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key === Y)).toBe(true);
    expect(keys).not.toContain(X);
  });

  it('stop 会清理当前角色指针；切人时不会把新指针误清', async () => {
    await players.select(1, X);
    await players.select(1, Y); // 内部顺序：start(Y) → stop(X)，stop 不能清掉 Y
    expect(world.activeCharacterOf(1)).toBe(Y);

    await world.stop(1, Y);
    expect(world.activeCharacterOf(1)).toBeUndefined();
  });

  it('resolveActiveCharacter：缺 key 回退当前角色；显式 key 必须等于当前角色', async () => {
    // 尚未选角：两种情况都失败
    expect(world.resolveActiveCharacter(1, undefined).ok).toBe(false);
    expect(world.resolveActiveCharacter(1, X).ok).toBe(false);

    await players.select(1, X);
    const fallback = world.resolveActiveCharacter(1, undefined);
    expect(fallback.ok && fallback.key).toBe(X);
    const explicit = world.resolveActiveCharacter(1, X);
    expect(explicit.ok && explicit.key).toBe(X);
    // 给了别的角色 → fail-closed（不允许用一条连接操作账号里的另一个角色）
    const mismatch = world.resolveActiveCharacter(1, Y);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.fail.data.code).toBe('PLAYER_NOT_FOUND');
    // 空串按「没给」处理
    const blank = world.resolveActiveCharacter(1, '   ');
    expect(blank.ok && blank.key).toBe(X);
  });

  it('resetActiveCharacter（新 WS 握手即回未选角色）：停会话 + 清两个注册表 + 不再推送', async () => {
    await players.select(1, X);
    expect(panelCharacters.peekActive(1)).toBe(X);
    runTicks(2);
    const before = tickFrames().length;
    expect(before).toBeGreaterThan(0);

    await world.resetActiveCharacter(1);

    expect(world.isInBattle(1, X)).toBe(false);
    expect(world.activeCharacterOf(1)).toBeUndefined();
    expect(panelCharacters.peekActive(1)).toBeNull();
    // 未选角色 → 归属校验拒绝（前端此时停在选角页）
    const resolved = world.resolveActiveCharacter(1, undefined);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.fail.data.code).toBe('NOT_IN_MAP');

    // ✅ 关键：会话已停，tick 不再产生任何推送（刷新后选角页不该收到战斗消息）
    runTicks(5);
    expect(tickFrames().length).toBe(before);
  });

  it('resetActiveCharacter 幂等：未选角 / 重复调用不抛错', async () => {
    await expect(world.resetActiveCharacter(1)).resolves.toBeUndefined();
    await players.select(1, X);
    await world.resetActiveCharacter(1);
    await expect(world.resetActiveCharacter(1)).resolves.toBeUndefined();
    expect(world.activeCharacterOf(1)).toBeUndefined();
  });

  it('在线 tick 只推送当前角色的世界，且每 tick 至多一帧 world.tick', async () => {
    await players.select(1, X);
    await players.select(1, Y);
    frames.length = 0;
    runTicks(2);
    // 两次 tick → 两帧（同一批内同路由会合并，不存在「一个 tick 两帧」）
    expect(tickFrames().length).toBe(2);
  });
});
