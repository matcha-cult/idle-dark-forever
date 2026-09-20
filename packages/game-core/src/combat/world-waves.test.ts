/**
 * W4 单测：野外波次计数 + 普通/稀有/BOSS 等级规则 + 一次性野外 BOSS + 击杀登记。
 *
 * 关键点：
 * - 波次由注入的 `Clock`（虚拟时钟）推进，测试用 `advanceBy` / `completeWave()` 显式步进，
 *   **不 sleep 真实时间**；
 * - 等级覆写按地图等级作用于野外图；
 * - BOSS 一次性：击杀登记在角色上，之后该图只刷普通怪。
 */
import { describe, expect, it } from 'vitest';

import { enemyData, makePlayer, makeTables, makeTestWorld, mapData } from './test-support.js';
import { EnemyUnit } from './enemy-unit.js';
import { EnemyBorn, WORLD_BOSS_WAVE_INTERVAL } from './spawner.js';

const WORLD_MAP = 'world.5';
const WORLD_MAP_LEVEL = 35;

/** 一张野外图（每波 3 只 dummy，同时最多 3 只）。 */
function makeW4Tables() {
  const tables = makeTables();
  tables.maps = {
    home: mapData({ key: 'home', name: 'Home' }),
    [WORLD_MAP]: mapData({
      key: WORLD_MAP,
      name: 'World 5',
      level: WORLD_MAP_LEVEL,
      boss: 'boss',
      monsters: [
        { type: 'dummy', delay: 100, max: 3, warmup: 0, total: 3, quality: [100] },
      ],
    }),
  };
  tables.enemies = {
    ...tables.enemies,
    boss: enemyData({ key: 'boss', name: 'World Boss', maxHp: 500, atk: 1, atkSpeed: 0.1, exp: 5, level: 99 }),
  };
  return tables;
}

function setup(playerOverrides?: Parameters<typeof makePlayer>[0]) {
  const tables = makeW4Tables();
  const player = makePlayer(playerOverrides);
  const t = makeTestWorld({ map: WORLD_MAP, tables, seed: 7, player });
  t.world.addPlayer(player);
  t.world.onMapChanged();
  const spawner = t.world.enemyBorn as EnemyBorn;
  return { t, player, spawner };
}

function bossUnits(t: { world: { units: unknown[] } }): EnemyUnit[] {
  return t.world.units.filter((u): u is EnemyUnit => u instanceof EnemyUnit && u.worldBoss);
}

function enemies(t: { world: { units: unknown[] } }): EnemyUnit[] {
  return t.world.units.filter((u): u is EnemyUnit => u instanceof EnemyUnit);
}

describe('W4 野外波次计数', () => {
  it('刷满 total 且全部清空后 wave +1，并重置 Born 供下一波', () => {
    const { t, spawner } = setup();
    expect(spawner.wave).toBe(0);

    let guard = 0;
    while (spawner.wave === 0 && guard < 500) {
      guard += 1;
      t.clock.advanceBy(2000);
      for (const unit of [...t.world.units]) {
        if (unit instanceof EnemyUnit) t.world.removeUnit(unit);
      }
    }

    expect(spawner.wave).toBe(1);

    // 重置语义（直接验证，避免与新一波已开始的刷怪竞态）：计数归零、over 清空。
    const born = spawner.borns?.[0]!;
    born.count = 2;
    born.total = 3;
    born.over = true;
    born.reset();
    expect(born.count).toBe(0);
    expect(born.total).toBe(0);
    expect(born.over).toBe(false);
  });

  it('连续两波都能靠击杀完成（重置后重新武装定时器）', () => {
    const { t, spawner } = setup();
    let guard = 0;
    while (spawner.wave < 2 && guard < 2000) {
      guard += 1;
      t.clock.advanceBy(2000);
      for (const unit of [...t.world.units]) {
        if (unit instanceof EnemyUnit) t.world.removeUnit(unit);
      }
    }
    expect(spawner.wave).toBe(2);
  });

  it('wave 会随 dumpState 往返（读档不把已完成的波数清零）', () => {
    const { t, spawner } = setup();
    for (let i = 0; i < 7; i += 1) spawner.completeWave();
    expect(spawner.wave).toBe(7);
    const dumped = spawner.dumpState();
    expect(dumped.wave).toBe(7);
    const restored = new EnemyBorn(t.world, t.clock, WORLD_MAP, dumped as { wave?: number });
    expect(restored.wave).toBe(7);
    // 脏数据（非数字 / 负数）→ 0，不污染
    expect(new EnemyBorn(t.world, t.clock, WORLD_MAP, { wave: -3 }).wave).toBe(0);
    expect(
      new EnemyBorn(t.world, t.clock, WORLD_MAP, { wave: Number.NaN as unknown as number }).wave,
    ).toBe(0);
  });
});

describe('W4 一次性野外 BOSS', () => {
  it('恰好第 20 波刷 BOSS，19 / 21 波不额外刷（同一时刻只允许一只）', () => {
    const { t, spawner } = setup();
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL - 1; i += 1) spawner.completeWave();
    expect(spawner.wave).toBe(19);
    expect(bossUnits(t)).toHaveLength(0);

    spawner.completeWave(); // 第 20 波
    expect(spawner.wave).toBe(20);
    expect(bossUnits(t)).toHaveLength(1);

    spawner.completeWave(); // 第 21 波：上一只仍存活 → 不刷第二只
    expect(bossUnits(t)).toHaveLength(1);

    // 干掉上一只后，第 22~39 波不再刷；第 40 波再刷。
    const first = bossUnits(t)[0]!;
    t.world.removeUnit(first);
    for (let w = 21; w < 2 * WORLD_BOSS_WAVE_INTERVAL - 1; w += 1) spawner.completeWave();
    expect(spawner.wave).toBe(39);
    expect(bossUnits(t)).toHaveLength(0);

    spawner.completeWave(); // 第 40 波
    expect(spawner.wave).toBe(40);
    expect(bossUnits(t)).toHaveLength(1);
  });

  it('没有 boss 配置的图永远不刷 BOSS', () => {
    const tables = makeW4Tables();
    tables.maps[WORLD_MAP] = mapData({
      key: WORLD_MAP,
      name: 'No Boss',
      level: WORLD_MAP_LEVEL,
      monsters: [{ type: 'dummy', delay: 100, max: 1, warmup: 0, total: 1, quality: [100] }],
    });
    const player = makePlayer();
    const t = makeTestWorld({ map: WORLD_MAP, tables, seed: 1, player });
    t.world.addPlayer(player);
    t.world.onMapChanged();
    const spawner = t.world.enemyBorn as EnemyBorn;
    for (let i = 0; i < 20; i += 1) spawner.completeWave();
    expect(bossUnits(t)).toHaveLength(0);
  });

  it('击杀 BOSS 登记到角色；之后该图不再刷 BOSS，但普通怪照旧', () => {
    const killed = new Set<string>();
    const { t, spawner } = setup({
      hasWorldBossKilled: (map: string) => killed.has(map),
      markWorldBossKilled: (map: string) => {
        killed.add(map);
      },
    });
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
    const boss = bossUnits(t)[0]!;
    expect(boss).toBeTruthy();

    boss.kill();
    expect(killed.has(WORLD_MAP)).toBe(true);

    // 清掉尸体，继续推到第 40 波：一次性已登记 → 不再刷 BOSS。
    t.world.removeUnit(boss);
    for (let w = WORLD_BOSS_WAVE_INTERVAL; w < 2 * WORLD_BOSS_WAVE_INTERVAL; w += 1) {
      spawner.completeWave();
    }
    expect(spawner.wave).toBe(40);
    expect(bossUnits(t)).toHaveLength(0);

    // 普通怪仍会刷（图仍可 farm）。
    t.clock.advanceBy(100000);
    expect(enemies(t).some((u) => !u.worldBoss)).toBe(true);
  });

  it('重进同一张图时尊重已击杀记录（先登记再进图）', () => {
    const killed = new Set<string>([WORLD_MAP]);
    const { t, spawner } = setup({
      hasWorldBossKilled: (map: string) => killed.has(map),
      markWorldBossKilled: (map: string) => {
        killed.add(map);
      },
    });
    // 模拟重进：同图 `onMapChanged()` 重建刷怪器。
    t.world.onMapChanged();
    const again = t.world.enemyBorn as EnemyBorn;
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) again.completeWave();
    expect(bossUnits(t)).toHaveLength(0);
    expect(spawner).not.toBe(again);
  });

  it('markWorldBossKilled 幂等（重复击杀不产生重复记录）', () => {
    const killed = new Set<string>();
    const { t, spawner } = setup({
      hasWorldBossKilled: (map: string) => killed.has(map),
      markWorldBossKilled: (map: string) => {
        killed.add(map);
      },
    });
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
    const boss = bossUnits(t)[0]!;
    boss.kill();
    boss.kill();
    expect(killed.size).toBe(1);
    expect([...killed]).toEqual([WORLD_MAP]);
  });
});

describe('W4 怪物等级规则', () => {
  it('野外：普通 = 地图等级 / 稀有（quality>=1）= +1', () => {
    const { t } = setup();
    const normal = t.world.addEnemy('dummy', null, 0);
    const rare = t.world.addEnemy('dummy', null, 1);
    const legendary = t.world.addEnemy('dummy', null, 2);
    expect(normal.level).toBe(WORLD_MAP_LEVEL);
    expect(rare.level).toBe(WORLD_MAP_LEVEL + 1);
    expect(legendary.level).toBe(WORLD_MAP_LEVEL + 1);
  });

  it('野外 BOSS = 地图等级 +2（第 20 波）', () => {
    const { t, spawner } = setup();
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
    const boss = bossUnits(t)[0]!;
    expect(boss.level).toBe(WORLD_MAP_LEVEL + 2);
  });

  it('levelOverride 非法值（NaN / Infinity）不生效，回落旧公式', () => {
    const { t } = setup();
    const unit = t.world.addEnemy('dummy', null, 2);
    unit.levelOverride = Number.NaN;
    expect(unit.level).toBe(1 + 2 * 4); // dummy 数据等级 1 + quality 2 ×4
    unit.levelOverride = Number.POSITIVE_INFINITY;
    expect(unit.level).toBe(9);
  });
});
