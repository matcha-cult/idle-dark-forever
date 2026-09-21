/**
 * 世界侧车状态（W11 / R0）：形状解析、**唯一写入口**、以及"离线结算不再吞波数"的回归。
 *
 * ## 为什么这个文件必须存在
 *
 * `wave` 曾经由**两处**各自拼对象字面量落库：
 * - `WorldService.persistPosition()` 写 `{ map, wave }`；
 * - `IdleLogicService.settle()` 只写 `{ map }` —— **把 `wave` 抹掉**。
 *
 * 而离线结算在**每次登录**都会跑（`root-store` 拉离线报告），所以「波数」永远不可能跨会话，
 * 玩家看到的波次每次都从 0 开始 —— 这不是"少写一个字段"，而是**同一片状态两个写者且形状不一致**
 * （违反 `AGENTS.md` §16 的 C6「每片状态只有一个写者」）。
 */
import { describe, expect, it } from 'vitest';

import {
  cloneWorldMaps,
  parseWorldMapState,
  worldWaveOf,
  writeWorldMapKeepingProgress,
  writeWorldMapState,
  type WorldMapState,
} from '../src/modules/logic/shared/world-map-state.js';

describe('worldWaveOf：波次类存档值 → 安全整数', () => {
  it('正整数原样（小数截断）', () => {
    expect(worldWaveOf(7)).toBe(7);
    expect(worldWaveOf(7.9)).toBe(7);
    expect(worldWaveOf(1)).toBe(1);
  });

  it('0 / 负数 / 非有限 / 非数字 / 缺失 → 0', () => {
    for (const dirty of [0, -1, -2.5, Number.NaN, Infinity, -Infinity, '7', null, undefined, {}, []]) {
      expect(worldWaveOf(dirty), `value=${String(dirty)}`).toBe(0);
    }
  });
});

describe('parseWorldMapState：读入唯一入口', () => {
  it('非对象 / null → null（调用方跳过该条）', () => {
    for (const bad of [null, undefined, 0, '', 'x', [], true]) {
      expect(parseWorldMapState(bad), `entry=${String(bad)}`).toBeNull();
    }
  });

  it('map 非字符串 / 空串 → home', () => {
    expect(parseWorldMapState({ map: '' })).toEqual({ map: 'home' });
    expect(parseWorldMapState({ map: 42 })).toEqual({ map: 'home' });
    expect(parseWorldMapState({})).toEqual({ map: 'home' });
    expect(parseWorldMapState({ map: 'world.3' })).toEqual({ map: 'world.3' });
  });

  it('波数类字段为 0 / 脏值 → 省略（保持旧存档形状，不落 0）', () => {
    const parsed = parseWorldMapState({
      map: 'world.1',
      wave: 0,
      lastEliteWave: Number.NaN,
      lastBossWave: -3,
    });
    expect(parsed).toEqual({ map: 'world.1' });
    expect('wave' in (parsed ?? {})).toBe(false);
  });

  it('里程碑晚于 wave（脏存档）→ 丢弃该里程碑，避免"提前认为已交付"永久漏刷', () => {
    expect(
      parseWorldMapState({ map: 'world.1', wave: 5, lastEliteWave: 10, lastBossWave: 20 }),
    ).toEqual({ map: 'world.1', wave: 5 });
    // 等于 wave 是合法边界（第 5 波交付、当前就在第 5 波）。
    expect(
      parseWorldMapState({ map: 'world.1', wave: 10, lastEliteWave: 10, lastBossWave: 20 }),
    ).toEqual({ map: 'world.1', wave: 10, lastEliteWave: 10 });
  });

  it('完整记录往返不丢字段', () => {
    const saved: WorldMapState = {
      map: 'world.2',
      wave: 21,
      lastEliteWave: 20,
      lastBossWave: 20,
    };
    expect(parseWorldMapState(saved)).toEqual(saved);
  });
});

describe('writeWorldMapState：唯一写入口', () => {
  it('写入并归一（0 不落，里程碑不得晚于 wave）', () => {
    const maps: Record<string, WorldMapState> = {};
    writeWorldMapState(maps, 'c1', {
      map: 'world.1',
      wave: 10,
      lastEliteWave: 10,
      lastBossWave: 0,
    });
    expect(maps['c1']).toEqual({ map: 'world.1', wave: 10, lastEliteWave: 10 });

    writeWorldMapState(maps, 'c1', { map: 'world.1', lastEliteWave: 10 });
    expect(maps['c1']).toEqual({ map: 'world.1' });
  });

  it('只覆盖本角色，不影响其它角色', () => {
    const maps: Record<string, WorldMapState> = { c2: { map: 'home' } };
    writeWorldMapState(maps, 'c1', { map: 'world.4', wave: 3 });
    expect(maps['c2']).toEqual({ map: 'home' });
    expect(maps['c1']).toEqual({ map: 'world.4', wave: 3 });
  });
});

describe('R0 回归：离线结算保留波数与里程碑', () => {
  it('同图 → 进度原样保留（旧实现手拼 `{ map }` 会把它抹掉）', () => {
    const maps: Record<string, WorldMapState> = {
      c1: { map: 'world.2', wave: 21, lastEliteWave: 20, lastBossWave: 20 },
    };
    writeWorldMapKeepingProgress(maps, 'c1', 'world.2');
    expect(maps['c1']).toEqual({ map: 'world.2', wave: 21, lastEliteWave: 20, lastBossWave: 20 });
  });

  it('换图 → 进度归零（离线不换图，但混沌仪 run 会换）', () => {
    const maps: Record<string, WorldMapState> = {
      c1: { map: 'world.2', wave: 21, lastEliteWave: 20, lastBossWave: 20 },
    };
    writeWorldMapKeepingProgress(maps, 'c1', 'chaos.t03');
    expect(maps['c1']).toEqual({ map: 'chaos.t03' });
  });

  it('从未进过图的角色 → 只写位置', () => {
    const maps: Record<string, WorldMapState> = {};
    writeWorldMapKeepingProgress(maps, 'c9', 'world.1');
    expect(maps['c9']).toEqual({ map: 'world.1' });
  });

  it('反复结算（登录多次）不会累积丢字段', () => {
    const maps: Record<string, WorldMapState> = {};
    writeWorldMapState(maps, 'c1', { map: 'world.2', wave: 21, lastEliteWave: 20, lastBossWave: 20 });
    for (let i = 0; i < 5; i += 1) {
      writeWorldMapKeepingProgress(maps, 'c1', 'world.2');
    }
    expect(worldWaveOf(maps['c1']?.wave)).toBe(21);
    expect(maps['c1']?.lastEliteWave).toBe(20);
    expect(maps['c1']?.lastBossWave).toBe(20);
  });
});

describe('cloneWorldMaps：缓存快照深拷贝', () => {
  it('逐条归一，且是深拷贝（改副本不影响源）', () => {
    const source: Record<string, WorldMapState> = {
      c1: { map: 'world.2', wave: 21 },
      c2: { map: '' },
    };
    const copy = cloneWorldMaps(source);
    expect(copy['c1']).toEqual({ map: 'world.2', wave: 21 });
    expect(copy['c2']).toEqual({ map: 'home' });
    copy['c1']!.wave = 99;
    expect(source['c1']?.wave).toBe(21);
  });

  it('空对象安全', () => {
    expect(cloneWorldMaps({})).toEqual({});
  });
});
