/**
 * W6 混沌图守关 BOSS 可重复性 + `chaosOutcome` 结算（§1 R3 / §4 W6）。
 *
 * 与野外一次性 BOSS（`world-waves.test.ts`）的差异：
 * - 混沌 BOSS **不写** `worldBossKilled`；
 * - 每次重进混沌图（`onMapChanged`）→ 结算位清零，第 20 波再次刷 BOSS；
 * - 击杀 → `chaosOutcome='clear'`；玩家阵亡 → `'death'`；非混沌图不受影响。
 */
import { describe, expect, it } from 'vitest';

import { enemyData, makePlayer, makeTables, makeTestWorld, mapData } from './test-support.js';
import { EnemyUnit } from './enemy-unit.js';
import { EnemyBorn, WORLD_BOSS_WAVE_INTERVAL } from './spawner.js';

const CHAOS_MAP = 'chaos.t01';
const WORLD_MAP = 'world.5';

function makeTablesWithChaos() {
  const tables = makeTables();
  tables.maps = {
    home: mapData({ key: 'home', name: 'Home', monsters: [] }),
    [CHAOS_MAP]: mapData({
      key: CHAOS_MAP,
      name: '混沌 T1',
      level: 85,
      chaos: 1,
      boss: 'boss',
      monsters: [{ type: 'dummy', delay: 100, max: 3, warmup: 0, total: 3, quality: [100] }],
    }),
    [WORLD_MAP]: mapData({
      key: WORLD_MAP,
      name: 'World 5',
      level: 35,
      boss: 'boss',
      monsters: [{ type: 'dummy', delay: 100, max: 3, warmup: 0, total: 3, quality: [100] }],
    }),
  };
  tables.enemies = {
    ...tables.enemies,
    boss: enemyData({ key: 'boss', name: 'Chaos Boss', maxHp: 500, atk: 1, atkSpeed: 0.1, exp: 5, level: 87 }),
  };
  return tables;
}

function setup(map: string, killed = new Set<string>()) {
  const tables = makeTablesWithChaos();
  const player = makePlayer({
    hasWorldBossKilled: (key: string) => killed.has(key),
    markWorldBossKilled: (key: string) => {
      killed.add(key);
    },
  });
  const t = makeTestWorld({ map, tables, seed: 7, player });
  t.world.addPlayer(player);
  t.world.onMapChanged();
  return { t, killed, spawner: t.world.enemyBorn as EnemyBorn };
}

function bossUnits(t: { world: { units: unknown[] } }): EnemyUnit[] {
  return t.world.units.filter((u): u is EnemyUnit => u instanceof EnemyUnit && u.worldBoss);
}

describe('W6 混沌图守关 BOSS', () => {
  it('第 20 波刷 BOSS；击杀登记 chaosOutcome=clear 且不写 worldBossKilled', () => {
    const { t, killed, spawner } = setup(CHAOS_MAP);
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
    const boss = bossUnits(t)[0]!;
    expect(boss).toBeTruthy();
    expect(boss.level).toBe(85 + 2); // 地图等级 +2

    boss.kill();
    expect(t.world.chaosOutcome).toBe('clear');
    expect(killed.has(CHAOS_MAP)).toBe(false);
  });

  it('重进混沌图 → 结算位清零，第 20 波再次刷 BOSS（可重复）', () => {
    const { t, killed, spawner } = setup(CHAOS_MAP);
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
    const first = bossUnits(t)[0]!;
    first.kill();
    t.world.removeUnit(first);
    expect(t.world.chaosOutcome).toBe('clear');

    // 重进本图（同一 run 结束后的下一把 / 重试都走这条路）。
    t.world.onMapChanged();
    expect(t.world.chaosOutcome).toBeNull();
    expect(killed.has(CHAOS_MAP)).toBe(false);

    const next = t.world.enemyBorn as EnemyBorn;
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) next.completeWave();
    expect(bossUnits(t)).toHaveLength(1);
  });

  it('混沌图玩家阵亡 → chaosOutcome=death', () => {
    const { t } = setup(CHAOS_MAP);
    expect(t.world.chaosOutcome).toBeNull();
    t.world.playerUnit!.kill();
    expect(t.world.chaosOutcome).toBe('death');
  });

  it('非混沌图：击杀写 worldBossKilled 且不置 chaosOutcome；阵亡也不置位', () => {
    const { t, killed, spawner } = setup(WORLD_MAP);
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
    const boss = bossUnits(t)[0]!;
    boss.kill();
    expect(killed.has(WORLD_MAP)).toBe(true);
    expect(t.world.chaosOutcome).toBeNull();

    t.world.playerUnit!.kill();
    expect(t.world.chaosOutcome).toBeNull();
  });
});
