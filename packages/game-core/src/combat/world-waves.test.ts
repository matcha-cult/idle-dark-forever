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
import { createDefaultTables } from '../data/index.js';

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
  it('恰好第 20 波刷 BOSS，19 波不刷；同一时刻只允许一只', () => {
    const { t, spawner } = setup();
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL - 1; i += 1) spawner.completeWave();
    expect(spawner.wave).toBe(19);
    expect(bossUnits(t)).toHaveLength(0);

    spawner.completeWave(); // 第 20 波
    expect(spawner.wave).toBe(20);
    expect(bossUnits(t)).toHaveLength(1);

    // 上一只仍存活 → 后续波次不会刷出第二只（推满一整个 20 波窗口）。
    for (let w = WORLD_BOSS_WAVE_INTERVAL; w < 2 * WORLD_BOSS_WAVE_INTERVAL; w += 1) {
      spawner.completeWave();
    }
    expect(spawner.wave).toBe(40);
    expect(bossUnits(t)).toHaveLength(1);
  });

  it('R3 回归：BOSS 因会话重启丢失后**恢复即补刷**（旧实现取模错过窗口，要等到第 40 波）', () => {
    const { t, spawner } = setup();
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
    expect(spawner.wave).toBe(20);
    expect(bossUnits(t)).toHaveLength(1);

    // 模拟刷新 / 断线重连：BOSS 单位不入档 ⇒ 新会话里 wave=20、场上却没有 BOSS。
    t.world.removeUnit(bossUnits(t)[0]!);
    expect(bossUnits(t)).toHaveLength(0);

    const restored = new EnemyBorn(t.world, t.clock, WORLD_MAP, { wave: 20 });
    t.world.enemyBorn = restored;
    expect(restored.wave).toBe(20);
    // 关键断言：不是「等到第 40 波」，而是**当波就补上**。
    restored.ensureMilestones();
    expect(bossUnits(t)).toHaveLength(1);
    expect(bossUnits(t)[0]!.level).toBe(WORLD_MAP_LEVEL + 2);
  });

  it('R3 回归：BOSS 仍存活时恢复不会刷出第二只', () => {
    const { t, spawner } = setup();
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
    const restored = new EnemyBorn(t.world, t.clock, WORLD_MAP, { wave: 20 });
    t.world.enemyBorn = restored;
    restored.ensureMilestones();
    expect(bossUnits(t)).toHaveLength(1);
    expect(spawner.wave).toBe(20);
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

describe('W4 守关 BOSS 是否还会出现（bossPending，UI 与刷怪闸门的唯一判据）', () => {
  it('未击杀的野外图 → true', () => {
    const killed = new Set<string>();
    const { t } = setup({
      hasWorldBossKilled: (map: string) => killed.has(map),
      markWorldBossKilled: (map: string) => {
        killed.add(map);
      },
    });
    expect(t.world.bossPending).toBe(true);
  });

  it('击杀后 → false（同一 world 上立即翻转；通关不再刷 BOSS）', () => {
    const killed = new Set<string>();
    const { t, spawner } = setup({
      hasWorldBossKilled: (map: string) => killed.has(map),
      markWorldBossKilled: (map: string) => {
        killed.add(map);
      },
    });
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
    expect(t.world.bossPending).toBe(true);
    bossUnits(t)[0]!.kill();
    expect(t.world.bossPending).toBe(false);
  });

  it('引擎真的不再刷 = 判据说 false（两者同源，不漂移）', () => {
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
    t.world.removeUnit(boss);
    expect(t.world.bossPending).toBe(false);
    for (let w = WORLD_BOSS_WAVE_INTERVAL; w < 2 * WORLD_BOSS_WAVE_INTERVAL; w += 1) {
      spawner.completeWave();
    }
    expect(bossUnits(t)).toHaveLength(0);
  });

  it('没有 boss 数据的图 → false（本图压根没有守关 BOSS）', () => {
    const { t } = setup();
    t.world.map = 'home';
    expect(t.world.bossPending).toBe(false);
  });

  it('boss key 不在敌人表里 → false（fail-closed，不乱报「还会出」）', () => {
    const { t } = setup();
    t.world.mapData!.boss = 'not-in-tables';
    expect(t.world.bossPending).toBe(false);
  });

  it('混沌图恒为 true（W6 可重复刷；已击杀记录不影响）', () => {
    const { t } = setup();
    t.world.mapData!.chaos = 1;
    expect(t.world.bossPending).toBe(true);
    // 即使该图被错误地记进 worldBossKilled（历史脏档），混沌图仍会刷
    const killed = new Set<string>([WORLD_MAP]);
    t.world.player!.hasWorldBossKilled = (map: string) => killed.has(map);
    expect(t.world.bossPending).toBe(true);
  });
});

describe('W4 怪物等级规则', () => {
  it('野外：普通 = 地图等级 / 稀有 +1 / 精英（quality 2）+2', () => {
    const { t } = setup();
    const normal = t.world.addEnemy('dummy', null, 0);
    const rare = t.world.addEnemy('dummy', null, 1);
    const elite = t.world.addEnemy('dummy', null, 2);
    expect(normal.level).toBe(WORLD_MAP_LEVEL);
    expect(rare.level).toBe(WORLD_MAP_LEVEL + 1);
    // W11：稀有度四阶后，`quality` 夹到 0..2 逐级 +1 —— 精英（第 10 波保底）比稀有更硬。
    expect(elite.level).toBe(WORLD_MAP_LEVEL + 2);
  });

  it('野外：`quality` 脏值被安全化，且等级不会被推到天上（W11 夹取）', () => {
    const { t } = setup();
    for (const [bad, expectedQuality] of [
      [3, 3],
      [99, 8], // 夹到 MAX_ENEMY_QUALITY
      [1e9, 8],
      [Number.NaN, 0],
      [Infinity, 0],
      [-Infinity, 0],
      [-5, 0],
      [1.7, 1],
    ] as const) {
      const unit = t.world.addEnemy('dummy', null, bad);
      // 字段级安全化：词缀条数一定是有限非负整数（否则构造器会 push 到 RangeError）。
      expect(Number.isInteger(unit.quality), `quality=${bad}`).toBe(true);
      expect(unit.quality, `quality=${bad}`).toBe(expectedQuality);
      expect(unit.affixes.length, `quality=${bad}`).toBe(expectedQuality);
      // 等级口径夹到 0..2：`mapLevel + min(quality, 2)`。
      expect(unit.level, `quality=${bad}`).toBe(
        WORLD_MAP_LEVEL + Math.min(expectedQuality, 2),
      );
      expect(Number.isFinite(unit.maxHp), `quality=${bad}`).toBe(true);
    }
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

describe('W12 同屏上限（含守关 BOSS 与召唤物）', () => {
  /** 自定义波次配置（`total` > `max`，用来观察「被上限挡住」的行为）。 */
  function capSetup(total: number, max: number) {
    const tables = makeTables();
    tables.maps = {
      home: mapData({ key: 'home', name: 'Home' }),
      [WORLD_MAP]: mapData({
        key: WORLD_MAP,
        name: 'Cap',
        level: WORLD_MAP_LEVEL,
        monsters: [{ type: 'dummy', delay: 10, max, warmup: 0, total, quality: [100] }],
      }),
    };
    const player = makePlayer();
    const t = makeTestWorld({ map: WORLD_MAP, tables, seed: 3, player });
    t.world.addPlayer(player);
    t.world.onMapChanged();
    const born = (t.world.enemyBorn as EnemyBorn).borns![0]!;
    return { t, born };
  }

  const hostileCount = (t: { world: { units: unknown[] } }): number =>
    t.world.units.filter(
      (u): u is EnemyUnit =>
        u instanceof EnemyUnit && (u.camp === 'enemy' || u.camp === 'neutral'),
    ).length;

  it('自然刷新封顶：同屏敌对怪不超过 max', () => {
    const { t, born } = capSetup(10, 4);
    t.clock.advanceBy(5000);
    expect(born.total).toBe(4);
    expect(hostileCount(t)).toBe(4);
    // 再快进也不会超过上限。
    t.clock.advanceBy(20000);
    expect(hostileCount(t)).toBe(4);
    expect(born.total).toBe(4);
  });

  it('召唤物把总数推过上限 → 暂停自然刷新；降到上限以下后恢复', () => {
    const { t, born } = capSetup(10, 4);
    t.clock.advanceBy(5000);
    expect(born.total).toBe(4);

    // 模拟守关 BOSS 的召唤物（`borner=null`，camp 仍是 enemy）。
    t.world.addEnemy('dummy', null, 0);
    expect(hostileCount(t)).toBe(5);

    // 被上限挡住：不再自然刷新。
    t.clock.advanceBy(20000);
    expect(born.total, '超过上限时不得继续自然刷新').toBe(4);
    expect(hostileCount(t)).toBe(5);

    // 死掉两只 → 总数 3 < 4 → 恢复刷新。
    const all = t.world.units.filter((u): u is EnemyUnit => u instanceof EnemyUnit);
    all[0]!.kill(false);
    all[1]!.kill(false);
    t.clock.advanceBy(2000);
    expect(born.total, '低于上限后恢复自然刷新').toBeGreaterThan(4);
  });

  it('玩家 / 联军召唤物不占敌对名额（否则会卡死刷怪）', () => {
    const { t } = capSetup(10, 4);
    const ally = t.world.addEnemy('dummy', null, 0);
    ally.camp = 'player';
    t.clock.advanceBy(5000);
    expect(hostileCount(t), '敌对仍能刷满 4 只').toBe(4);
  });

  it('默认数据（world/chaos 图）每波 4 只、同屏上限 4 只', () => {
    const real = createDefaultTables();
    const combat = Object.entries(real.maps).filter(
      ([key, map]) => (key.startsWith('world.') || key.startsWith('chaos.')) && (map.monsters ?? []).length > 0,
    );
    expect(combat.length).toBeGreaterThanOrEqual(29);
    for (const [key, map] of combat) {
      for (const spawn of map.monsters ?? []) {
        expect(spawn.total, `${key} total`).toBe(4);
        expect(spawn.max, `${key} max`).toBe(4);
      }
    }
  });
});
