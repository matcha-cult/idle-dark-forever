/**
 * W11 波次里程碑：精英怪（决策 3）+ 通关清算（决策 2）+ 阵亡重开（决策 4）。
 *
 * ## 节拍（两态 + 混沌图）
 *
 * | 图 | 精英 | 守关 BOSS |
 * |---|---|---|
 * | 野外 · 开荒（`bossPending`） | 第 10 波，一次 | 第 20 波，一次 |
 * | 野外 · 挂机（已通关） | 每 10 波 | 不再出 |
 * | 混沌图 | **不出** | 每 20 波，可重复刷 |
 *
 * ## 为什么要「目标波 + 已交付记录」而不是 `wave % N === 0`
 *
 * 取模在**会话恢复**后必然错过窗口（恢复到第 20 波 → 要等到第 40 波），这是 R3。
 * 本文件同时钉住修复后的语义：**野外 BOSS 只要还会出、场上又没有，就当波补刷**；
 * 混沌图按 20 波窗口记「已交付」，避免杀掉后每波重刷。
 */
import { describe, expect, it } from 'vitest';

import { createDefaultTables } from '../data/index.js';
import { EnemyUnit } from './enemy-unit.js';
import { ENEMY_RARITY, enemyRarityOf } from './enemy-rarity.js';
import { ELITE_QUALITY, ELITE_WAVE_INTERVAL, EnemyBorn, WORLD_BOSS_WAVE_INTERVAL } from './spawner.js';
import { MAX_UNITS_PER_WORLD } from './battle-world.js';
import { makePlayer, makeTestWorld } from './test-support.js';
import type { LootEntry } from '../contracts/data.js';

const WORLD_MAP = 'world.1'; // 地图等级 1、map.exp = 5000、BOSS = slime.giant.enemy
const WORLD_MAP_LEVEL = 1;
const WORLD_MAP_EXP = 5000;
const CHAOS_MAP = 'chaos.t01';

interface SetupOptions {
  /** 该图守关 BOSS 是否已击杀（= 挂机态）。 */
  cleared?: boolean;
  map?: string;
}

function setup(options: SetupOptions = {}) {
  const tables = createDefaultTables();
  const map = options.map ?? WORLD_MAP;
  const killed = new Set<string>(options.cleared ? [map] : []);
  const player = makePlayer({
    maxExp: 1_000_000,
    hasWorldBossKilled: (m: string) => killed.has(m),
    markWorldBossKilled: (m: string) => {
      killed.add(m);
    },
  });
  const t = makeTestWorld({ map, tables, seed: 5, player });
  t.world.addPlayer(player);
  t.world.onMapChanged();
  const spawner = t.world.enemyBorn as EnemyBorn;
  return { t, tables, player, killed, spawner };
}

function elites(t: { world: { units: unknown[] } }): EnemyUnit[] {
  return t.world.units.filter((u): u is EnemyUnit => u instanceof EnemyUnit && u.elite);
}

function bosses(t: { world: { units: unknown[] } }): EnemyUnit[] {
  return t.world.units.filter((u): u is EnemyUnit => u instanceof EnemyUnit && u.worldBoss);
}

function enemies(t: { world: { units: unknown[] } }): EnemyUnit[] {
  return t.world.units.filter((u): u is EnemyUnit => u instanceof EnemyUnit);
}

/** 推进 `n` 波（不推进时钟 ⇒ 自然刷怪不会插手，只观察里程碑）。 */
function waves(spawner: EnemyBorn, n: number): void {
  for (let i = 0; i < n; i += 1) spawner.completeWave();
}

const clearRewardEvents = (t: { sink: { events: Array<{ kind?: string; amount?: unknown }> } }) =>
  t.sink.events.filter((e) => e.kind === 'exp' && e.amount === WORLD_MAP_EXP).length;

const lootEvents = (t: { sink: { events: Array<{ kind?: string; key?: unknown }> } }) =>
  t.sink.events.filter((e) => e.kind === 'loot');

// ────────────────────────────── 精英：开荒 / 挂机 / 混沌 ──────────────────────────────

describe('W11 精英怪节拍', () => {
  it('开荒：第 10 波恰好出一只，quality = 2、+2 级、稀有度为「精英」', () => {
    const { t, spawner } = setup();
    waves(spawner, ELITE_WAVE_INTERVAL - 1);
    expect(spawner.wave).toBe(9);
    expect(elites(t)).toHaveLength(0);

    spawner.completeWave();
    expect(spawner.wave).toBe(ELITE_WAVE_INTERVAL);
    const list = elites(t);
    expect(list).toHaveLength(1);
    const elite = list[0]!;
    expect(elite.quality).toBe(ELITE_QUALITY);
    expect(elite.elite).toBe(true);
    expect(elite.worldBoss).toBe(false);
    expect(elite.level).toBe(WORLD_MAP_LEVEL + 2);
    expect(enemyRarityOf(elite)).toBe(ENEMY_RARITY.elite);
    // 场上没有 BOSS（开荒期 BOSS 在第 20 波）。
    expect(bosses(t)).toHaveLength(0);
  });

  it('开荒：同一个 10 波窗口只交付一次；推到第 20 波时 BOSS 与精英各一只', () => {
    const { t, spawner } = setup();
    waves(spawner, ELITE_WAVE_INTERVAL);
    expect(elites(t)).toHaveLength(1);

    waves(spawner, 9); // → 第 19 波
    expect(elites(t)).toHaveLength(1);
    spawner.completeWave(); // 第 20 波
    expect(spawner.wave).toBe(WORLD_BOSS_WAVE_INTERVAL);
    expect(elites(t)).toHaveLength(1);
    expect(bosses(t)).toHaveLength(1);
  });

  it('挂机（已通关）：每 10 波一只、且**永不再出** BOSS', () => {
    const { t, spawner } = setup({ cleared: true });
    const spawnedAt: number[] = [];
    // 每清掉一只才能观察到下一次节拍（同一时刻只允许一只精英存活）。
    for (let w = 1; w <= 35; w += 1) {
      spawner.completeWave();
      if (elites(t).length > 0) {
        spawnedAt.push(spawner.wave);
        t.world.removeUnit(elites(t)[0]!);
      }
    }
    expect(spawner.wave).toBe(35);
    expect(spawnedAt).toEqual([10, 20, 30]);
    expect(bosses(t)).toHaveLength(0);
  });

  it('挂机：精英一直不被清掉时不会堆积（同一时刻只允许一只）', () => {
    const { t, spawner } = setup({ cleared: true });
    waves(spawner, 35);
    expect(elites(t)).toHaveLength(1);
    expect(spawner.lastEliteWave).toBe(ELITE_WAVE_INTERVAL);
  });

  it('混沌图：不出精英，维持每 20 波可重复刷的 BOSS', () => {
    const { t, spawner } = setup({ map: CHAOS_MAP });
    expect(t.world.isChaosMap).toBe(true);
    waves(spawner, WORLD_BOSS_WAVE_INTERVAL);
    expect(elites(t)).toHaveLength(0);
    expect(bosses(t)).toHaveLength(1);

    // 混沌 BOSS 可重复：杀掉之后，**下一个 20 波窗口**才再出（不是每波都出）。
    bosses(t)[0]!.kill();
    expect(bosses(t)).toHaveLength(1); // 尸体仍在 units 里
    t.world.removeUnit(bosses(t)[0]!);
    waves(spawner, 1); // 第 21 波
    expect(bosses(t)).toHaveLength(0);
    waves(spawner, WORLD_BOSS_WAVE_INTERVAL - 1); // → 第 40 波
    expect(spawner.wave).toBe(2 * WORLD_BOSS_WAVE_INTERVAL);
    expect(bosses(t)).toHaveLength(1);
  });

  it('I2 单位硬顶：刷不出时**不记里程碑**，腾出位置后当波补刷', () => {
    const { t, spawner } = setup();
    // 填满全局单位硬顶（`borner = null` ⇒ 不影响波次记账）。
    while (!t.world.atUnitCap()) {
      t.world.addEnemy('slime.minimal', null, 0);
    }
    expect(t.world.units.length).toBe(MAX_UNITS_PER_WORLD);

    waves(spawner, ELITE_WAVE_INTERVAL);
    expect(spawner.wave).toBe(ELITE_WAVE_INTERVAL);
    expect(elites(t)).toHaveLength(0);
    expect(spawner.lastEliteWave).toBe(0); // 未交付 ⇒ 不算数

    // 腾出一个位置 → 下一波补刷（不永久丢失）。
    const victim = t.world.units.find((u) => u instanceof EnemyUnit && !u.elite)!;
    t.world.removeUnit(victim);
    spawner.completeWave();
    expect(elites(t)).toHaveLength(1);
    expect(spawner.lastEliteWave).toBe(ELITE_WAVE_INTERVAL);
  });

  it('里程碑随 dumpState 往返；脏数据（里程碑 > wave / 非正 / NaN）归 0', () => {
    const { t, spawner } = setup();
    waves(spawner, ELITE_WAVE_INTERVAL);
    const dumped = spawner.dumpState();
    expect(dumped.wave).toBe(ELITE_WAVE_INTERVAL);
    expect(dumped.lastEliteWave).toBe(ELITE_WAVE_INTERVAL);

    const restored = new EnemyBorn(t.world, t.clock, WORLD_MAP, dumped as never);
    expect(restored.wave).toBe(ELITE_WAVE_INTERVAL);
    expect(restored.lastEliteWave).toBe(ELITE_WAVE_INTERVAL);
    expect(restored.lastBossWave).toBe(0);

    expect(new EnemyBorn(t.world, t.clock, WORLD_MAP, { lastEliteWave: -5 }).lastEliteWave).toBe(0);
    expect(
      new EnemyBorn(t.world, t.clock, WORLD_MAP, {
        lastEliteWave: Number.NaN as unknown as number,
      }).lastEliteWave,
    ).toBe(0);
    // 里程碑晚于 wave（脏存档）→ 归 0，避免「提前认为已交付」而永久漏刷。
    expect(
      new EnemyBorn(t.world, t.clock, WORLD_MAP, { wave: 5, lastEliteWave: 10 }).lastEliteWave,
    ).toBe(0);
  });

  it('恢复后不重复出精英（里程碑已交付）', () => {
    const { t, spawner } = setup();
    waves(spawner, ELITE_WAVE_INTERVAL);
    expect(elites(t)).toHaveLength(1);

    const restored = new EnemyBorn(t.world, t.clock, WORLD_MAP, {
      wave: ELITE_WAVE_INTERVAL,
      lastEliteWave: ELITE_WAVE_INTERVAL,
    });
    t.world.enemyBorn = restored;
    restored.ensureMilestones();
    expect(elites(t)).toHaveLength(1);
  });

  it('没有刷怪池的图不刷精英（也不会抛错）', () => {
    const { t, spawner } = setup({ map: 'home' });
    expect(() => spawner.ensureMilestones()).not.toThrow();
    waves(spawner, 30);
    expect(elites(t)).toHaveLength(0);
  });
});

// ────────────────────────────── 精英必掉 ──────────────────────────────

describe('W11 精英必掉一条通货/精华', () => {
  function loot(t: Parameters<typeof lootEvents>[0], entries: LootEntry[], level = 1): void {
    (t as never as { world: { lootEliteGuaranteed: (l: LootEntry[], lv: number, q: number) => void } })
      .world.lootEliteGuaranteed(entries, level, ELITE_QUALITY);
  }

  it('从「钱包物品」池里恰好抽一条（rate 强制 1）', () => {
    const { t, tables } = setup();
    const pool = tables.enemies['slime.minimal']!.loots!;
    loot(t, pool);
    const drops = lootEvents(t);
    expect(drops).toHaveLength(1);
    expect(tables.goods[String(drops[0]!.key)]?.wallet).toBe(true);
  });

  it('同种子下确定性（只消耗 rng.loot，不引入新随机源）', () => {
    const a = setup();
    const b = setup();
    loot(a.t, a.tables.enemies['slime.minimal']!.loots!);
    loot(b.t, b.tables.enemies['slime.minimal']!.loots!);
    expect(lootEvents(a.t).map((e) => e.key)).toEqual(lootEvents(b.t).map((e) => e.key));
  });

  it('非钱包 key（如 gold）不入池 → 不发', () => {
    const { t } = setup();
    loot(t, [{ key: 'gold', rate: 1, count: [1, 5] }]);
    expect(lootEvents(t)).toEqual([]);
  });

  it('空池 / 无 key 的条目 / 权重非正或非有限 → 不发', () => {
    const { t } = setup();
    loot(t, []);
    loot(t, [{ type: 'equip', rate: 1 } as LootEntry]);
    loot(t, [
      { key: 'currency.transmute', rate: 0, count: [1, 1] },
      { key: 'currency.alchemy', rate: Number.NaN, count: [1, 1] },
      { key: 'currency.chaos', rate: -1, count: [1, 1] },
      { key: 'currency.scour', rate: Infinity, count: [1, 1] },
    ]);
    expect(lootEvents(t)).toEqual([]);
  });

  it('等级门槛（min(怪物等级, 地图等级)）挡掉全部条目 → 不发', () => {
    const { t } = setup();
    loot(t, [{ key: 'currency.mirror', rate: 0.0001, count: [1, 1], minLevel: 100 }], 1);
    expect(lootEvents(t)).toEqual([]);
  });

  it('精英清尸（`clean`）时真的会必掉一条钱包物品', () => {
    const { t, tables, spawner } = setup();
    waves(spawner, ELITE_WAVE_INTERVAL);
    const elite = elites(t)[0]!;
    elite.kill(false); // 立即挂清尸定时器
    t.clock.advanceBy(5000);
    const walletDrops = lootEvents(t).filter((e) => tables.goods[String(e.key)]?.wallet === true);
    expect(walletDrops.length).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────── 通关清算（决策 2） ──────────────────────────────

describe('W11 通关清算：首通全额发 map.exp', () => {
  it('首通 BOSS 发放 map.exp（全额，不打折）', () => {
    const { t, player, spawner } = setup();
    waves(spawner, WORLD_BOSS_WAVE_INTERVAL);
    const boss = bosses(t)[0]!;
    const before = player.exp;
    boss.kill();
    expect(clearRewardEvents(t)).toBe(1);
    // BOSS 自身经验（slime.giant.enemy exp = 3）+ 通关清算 5000。
    expect(player.exp - before).toBe(WORLD_MAP_EXP + boss.enemyData.exp!);
  });

  it('非首通不发（重复击杀幂等）', () => {
    const { t, spawner } = setup();
    waves(spawner, WORLD_BOSS_WAVE_INTERVAL);
    const boss = bosses(t)[0]!;
    boss.kill();
    expect(clearRewardEvents(t)).toBe(1);
    boss.kill();
    expect(clearRewardEvents(t)).toBe(1);
  });

  it('挂机态（进图前就已通关）击杀旧 BOSS 也不会重复结算', () => {
    const { t, spawner } = setup({ cleared: true });
    waves(spawner, 2 * WORLD_BOSS_WAVE_INTERVAL);
    expect(bosses(t)).toHaveLength(0);
    expect(clearRewardEvents(t)).toBe(0);
  });

  it('`map.exp` 缺失 / 为 0 / 非有限 → 一条经验事件都不发', () => {
    for (const bad of [undefined, 0, -1, Number.NaN, Infinity]) {
      const { t, tables, spawner } = setup();
      if (bad === undefined) {
        delete tables.maps[WORLD_MAP]!.exp;
      } else {
        tables.maps[WORLD_MAP]!.exp = bad as number;
      }
      waves(spawner, WORLD_BOSS_WAVE_INTERVAL);
      bosses(t)[0]!.kill();
      const rewards = t.sink.events.filter((e) => e.kind === 'exp' && e.amount === bad);
      expect(rewards, `exp=${String(bad)}`).toEqual([]);
      // 但 BOSS 自身经验照旧发。
      expect(t.sink.events.some((e) => e.kind === 'exp')).toBe(true);
    }
  });

  it('混沌图通关不发野外通关清算（可重复刷，不属于 worldBossKilled 链）', () => {
    const { t, spawner } = setup({ map: CHAOS_MAP });
    waves(spawner, WORLD_BOSS_WAVE_INTERVAL);
    bosses(t)[0]!.kill();
    expect(clearRewardEvents(t)).toBe(0);
  });
});

// ────────────────────────────── 阵亡重开（决策 4） ──────────────────────────────

describe('W11 阵亡重开本图 run', () => {
  it('野外战斗图阵亡 → 置位（服务端据此重置）', () => {
    const { t } = setup();
    expect(t.world.openWorldDeath).toBe(false);
    t.world.playerUnit!.kill();
    expect(t.world.openWorldDeath).toBe(true);
  });

  it('混沌图阵亡 **不**置位（走 chaosOutcome 的失败分支）', () => {
    const { t } = setup({ map: CHAOS_MAP });
    t.world.playerUnit!.kill();
    expect(t.world.openWorldDeath).toBe(false);
    expect(t.world.chaosOutcome).toBe('death');
  });

  it('非战斗区（home）阵亡不置位（没有波次可重开）', () => {
    const { t } = setup({ map: 'home' });
    t.world.playerUnit!.kill();
    expect(t.world.openWorldDeath).toBe(false);
  });

  it('resetOpenWorldRun：波数归 0、里程碑复位、清场、清标志', () => {
    const { t, spawner } = setup();
    waves(spawner, ELITE_WAVE_INTERVAL + 2);
    expect(spawner.wave).toBe(12);
    expect(enemies(t).length).toBeGreaterThan(0);

    t.world.playerUnit!.kill();
    expect(t.world.openWorldDeath).toBe(true);
    t.world.resetOpenWorldRun();

    expect(t.world.openWorldDeath).toBe(false);
    const again = t.world.enemyBorn as EnemyBorn;
    expect(again).not.toBe(spawner);
    expect(again.wave).toBe(0);
    expect(again.lastEliteWave).toBe(0);
    expect(again.lastBossWave).toBe(0);
    expect(enemies(t)).toHaveLength(0);
  });

  it('重置不销毁会话：玩家单位仍在（原地复活照常）', () => {
    const { t } = setup();
    t.world.playerUnit!.kill();
    t.world.resetOpenWorldRun();
    expect(t.world.playerUnit).toBeTruthy();
    expect(t.world.player).toBeTruthy();
  });

  it('未置位时 resetOpenWorldRun 是安全幂等的（重复调用不炸）', () => {
    const { t } = setup();
    t.world.resetOpenWorldRun();
    t.world.resetOpenWorldRun();
    expect(t.world.openWorldDeath).toBe(false);
    expect((t.world.enemyBorn as EnemyBorn).wave).toBe(0);
  });
});
