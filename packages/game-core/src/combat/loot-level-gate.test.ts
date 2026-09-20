/**
 * 掉落等级门槛（`LootEntry.minLevel` / `maxLevel`）。
 *
 * 用户口径：判定等级 = **min(怪物等级, 地图等级)**。本文件用**真实 `BattleWorld.loots` 路径**
 * 验证：地图等级与传入等级（= 击杀时怪物等级 / 通关时地图等级）中的较小者决定是否掉落。
 */
import { describe, expect, it } from 'vitest';

import type { MapData } from '../contracts/data.js';
import { makePlayer, makeTables, makeTestWorld } from './test-support.js';

const SCOUR = { key: 'currency.scour', rate: 1, count: [1, 1] as [number, number], minLevel: 40 };
const EXALT = { key: 'currency.exalt', rate: 1, count: [1, 1] as [number, number], minLevel: 60 };

/** 造一张指定等级的地图（无怪物，仅用于承载 `mapData.level`）。 */
function tablesWithMapLevel(level: number | undefined) {
  const tables = makeTables();
  const map: MapData = { key: 'gate', name: 'Gate', monsters: [] };
  if (level !== undefined) map.level = level;
  tables.maps = { gate: map };
  return tables;
}

function droppedKeys(mapLevel: number | undefined, level: number): string[] {
  const t = makeTestWorld({ seed: 1, tables: tablesWithMapLevel(mapLevel) });
  const player = makePlayer();
  t.world.addPlayer(player);
  t.world.map = 'gate';
  t.world.loots([SCOUR, EXALT], level, 0);
  return t.sink.events.filter((e) => e.kind === 'loot').map((e) => String(e.key));
}

describe('掉落等级门槛：min(怪物等级, 地图等级)', () => {
  it('两者都达标才掉：地图 40 + 等级 100 → 只掉重铸石', () => {
    expect(droppedKeys(40, 100)).toEqual(['currency.scour']);
  });

  it('怪物等级低于地图 → 被怪物等级卡住：地图 100 + 等级 40 → 只掉重铸石', () => {
    expect(droppedKeys(100, 40)).toEqual(['currency.scour']);
  });

  it('两者都到 60 → 重铸石 + 崇高石都掉', () => {
    expect(droppedKeys(100, 100)).toEqual(['currency.scour', 'currency.exalt']);
  });

  it('地图低于门槛（39）→ 即使怪物 100 也不掉', () => {
    expect(droppedKeys(39, 100)).toEqual([]);
  });

  it('怪物低于门槛（59）→ 即使地图 100 也只掉 40 档', () => {
    expect(droppedKeys(100, 59)).toEqual(['currency.scour']);
  });

  it('地图无 level → 退化为只用传入等级（不把无等级地图一刀切）', () => {
    expect(droppedKeys(undefined, 60)).toEqual(['currency.scour', 'currency.exalt']);
    expect(droppedKeys(undefined, 39)).toEqual([]);
  });

  it('门槛外的条目在消耗 RNG 之前就被跳过（同种子下等级越高掉落越全）', () => {
    const at20 = droppedKeys(100, 20);
    const at100 = droppedKeys(100, 100);
    expect(at20).toEqual([]);
    expect(at100.length).toBeGreaterThan(at20.length);
  });

  it('maxLevel 生效：高于上限不掉', () => {
    const t = makeTestWorld({ seed: 1, tables: tablesWithMapLevel(100) });
    t.world.addPlayer(makePlayer());
    t.world.map = 'gate';
    t.world.loots(
      [{ key: 'currency.low', rate: 1, count: [1, 1], maxLevel: 50 }],
      100,
      0,
    );
    expect(t.sink.events.filter((e) => e.kind === 'loot')).toHaveLength(0);
  });

  it('边界：minLevel=0 / 负数视为无门槛', () => {
    const t = makeTestWorld({ seed: 1, tables: tablesWithMapLevel(0) });
    t.world.addPlayer(makePlayer());
    t.world.map = 'gate';
    t.world.loots(
      [
        { key: 'currency.a', rate: 1, count: [1, 1], minLevel: 0 },
        { key: 'currency.b', rate: 1, count: [1, 1], minLevel: -5 },
      ],
      0,
      0,
    );
    expect(t.sink.events.filter((e) => e.kind === 'loot').map((e) => e.key)).toEqual([
      'currency.a',
      'currency.b',
    ]);
  });
});
