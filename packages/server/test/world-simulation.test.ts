/**
 * 世界运行装配单测（VirtualClock + BattleWorld）
 *
 * 验证服务端新增的三块胶水：
 * 1. `buildBattleWorld` 能跑起来并产生战斗事件；
 * 2. `toPlayerLike` 的掉落包装不会因 `BattleWorld` 传入普通对象而抛错（已知的
 *    `Player.loot` ↔ `LootSlot` 形状冲突，见 `internal/player-like.ts`）；
 * 3. 同种子同初始存档 → 事件流可复算（确定性）。
 */
import { describe, expect, it } from 'vitest';
import {
  Player,
  VirtualClock,
  createDefaultTables,
} from '@idle-dark/game-core';
import { BattleCollector } from '../src/modules/logic/world/internal/battle-collector.js';
import { buildBattleWorld, nextWorldSeed } from '../src/modules/logic/world/internal/headless.js';
import { unitStateDtoOf } from '../src/modules/logic/world/internal/unit-state.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;

function freshPlayer(): Player {
  const player = Player.fromJSON(tables, 'c1', () => NOW, {
    role: 'Eyer',
    currentCareer: 'warrior',
    careers: { warrior: { type: 'warrior', level: 1 } },
  });
  player.postCreate();
  player.selectCareer('warrior');
  return player;
}

function run(seed: number, ms: number): { texts: string[]; frames: number } {
  const player = freshPlayer();
  const clock = new VirtualClock();
  const collector = new BattleCollector();
  const { world } = buildBattleWorld({
    tables,
    player,
    map: 'town.street',
    seed,
    sink: collector,
    clock,
  });
  const left = clock.advanceBy(ms, 5_000);
  const snapshot = collector.snapshot();
  const texts = snapshot.events.map((event) => JSON.stringify(event));
  expect(left).toBe(0);
  expect(world.units.length).toBeGreaterThan(0);
  world.dispose();
  clock.dispose();
  return { texts, frames: snapshot.events.length };
}

describe('buildBattleWorld（在线/离线共用装配）', () => {
  it('初始单位里包含玩家，且单位快照字段有限', () => {
    const player = freshPlayer();
    const clock = new VirtualClock();
    const collector = new BattleCollector();
    const { world, playerUnit } = buildBattleWorld({
      tables,
      player,
      map: 'town.street',
      seed: 42,
      sink: collector,
      clock,
    });

    const playerState = unitStateDtoOf(playerUnit, world.playerUnit);
    expect(playerState.kind).toBe('player');
    expect(playerState.typeKey).toBe('c1');
    expect(Number.isFinite(playerState.hp)).toBe(true);
    expect(Number.isFinite(playerState.maxHp)).toBe(true);
    expect(playerState.targetId === null || typeof playerState.targetId === 'string').toBe(true);

    world.dispose();
    clock.dispose();
  });

  it('推进 60s 虚拟时间会产生战斗事件（击杀 / 伤害 / 掉落）', () => {
    const { frames } = run(2024, 60_000);
    expect(frames).toBeGreaterThan(0);
  });

  it('同种子同初始存档 → 事件序列逐字节一致（可复算）', () => {
    const a = run(777, 45_000);
    const b = run(777, 45_000);
    expect(b.texts).toEqual(a.texts);
  });

  it('不同种子 → 事件序列不同（随机源真的在起作用）', () => {
    const a = run(1, 45_000);
    const b = run(2, 45_000);
    expect(b.texts.join('|')).not.toBe(a.texts.join('|'));
  });

  it('掉落包装不抛错：普通对象（gold/材料）也能被 Player.loot 消化', () => {
    const { frames } = run(999, 120_000);
    expect(frames).toBeGreaterThan(0);
  });

  it('nextWorldSeed 产生非负 32 位整数', () => {
    for (let i = 0; i < 20; i += 1) {
      const seed = nextWorldSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
