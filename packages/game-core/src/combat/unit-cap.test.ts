/**
 * I2 单测：单图**单位总数硬顶**（`MAX_UNITS_PER_WORLD`）的全局预算与超载行为。
 *
 * 覆盖：
 * - 达到硬顶后新增敌人（BOSS / 召唤）**不被注册**进 `world.units`，但**仍返回有效对象**
 *   且立刻是 ghost（`addBuff` / `addSkill` / 受击 / 读条全部 early-return），调用方不会崩；
 * - 拒绝次数计入 `world.refusedUnits`，并发出 `world.unitCap:*` 事件（I3：不许静默降级）；
 * - **自然刷新在到达硬顶前就被拦住**（否则 `Born` 的 `count`/`total` 记账会失真、波次卡死）；
 * - BOSS 在硬顶下不刷新（且不会把 `worldBoss` 标记打到孤儿上）；
 * - 玩家单位永远不受硬顶影响；
 * - 为差分循环给出的上界确实成立：`units.length <= MAX_UNITS_PER_WORLD`。
 */
import { describe, expect, it } from 'vitest';

import { MAX_UNITS_PER_WORLD } from './battle-world.js';
import { EnemyUnit } from './enemy-unit.js';
import { EnemyBorn } from './spawner.js';
import { enemyData, makePlayer, makeTables, makeTestWorld, mapData } from './test-support.js';

const MAP = 'world.5';

function makeTablesWithSpawner() {
  const tables = makeTables();
  tables.maps = {
    home: mapData({ key: 'home', name: 'Home' }),
    [MAP]: mapData({
      key: MAP,
      name: 'World 5',
      level: 35,
      boss: 'boss',
      monsters: [{ type: 'dummy', delay: 100, max: 3, warmup: 0, total: 3, quality: [100] }],
    }),
  };
  tables.enemies = {
    ...tables.enemies,
    boss: enemyData({ key: 'boss', name: 'World Boss', maxHp: 500, atk: 1, atkSpeed: 0.1, exp: 5, level: 99 }),
  };
  return tables;
}

function setup() {
  const tables = makeTablesWithSpawner();
  const player = makePlayer();
  const t = makeTestWorld({ map: MAP, tables, seed: 11, player });
  t.world.addPlayer(player);
  t.world.onMapChanged();
  return { t, player, spawner: t.world.enemyBorn as EnemyBorn };
}

const enemiesOf = (units: readonly unknown[]): EnemyUnit[] =>
  units.filter((u): u is EnemyUnit => u instanceof EnemyUnit);

describe(`I2 单位硬顶（MAX_UNITS_PER_WORLD = ${MAX_UNITS_PER_WORLD}）`, () => {
  it('低于硬顶时正常注册；达到硬顶后拒绝注册但返回可用的 ghost 对象', () => {
    const { t } = setup();
    const world = t.world;

    // 先填到刚好低于硬顶（玩家已占 1 个名额）
    let added = 0;
    while (world.units.length < MAX_UNITS_PER_WORLD - 1) {
      world.addEnemy('dummy', null, 0);
      added += 1;
      expect(added).toBeLessThan(MAX_UNITS_PER_WORLD + 5);
    }
    expect(world.atUnitCap()).toBe(false);
    expect(world.refusedUnits).toBe(0);

    // 再补一个 → 正好到顶
    world.addEnemy('dummy', null, 0);
    expect(world.units.length).toBe(MAX_UNITS_PER_WORLD);
    expect(world.atUnitCap()).toBe(true);
    expect(world.refusedUnits).toBe(0);

    // 超顶：不注册，但返回有效对象且已是 ghost
    const overflow = world.addEnemy('dummy', null, 0);
    expect(world.units.length).toBe(MAX_UNITS_PER_WORLD);
    expect(world.refusedUnits).toBe(1);
    expect(overflow).toBeInstanceOf(EnemyUnit);
    expect(overflow.camp).toBe('ghost');
    expect(overflow.summoner).toBeNull();
    expect(overflow.borner).toBeNull();
    // ghost ⇒ 加 Buff / 受击 全部 no-op，数据层拿返回值也不会崩
    expect(overflow.addBuff('any')).toBeNull();
    expect(overflow.damage('melee', null, 999)).toBe(false);
    expect(overflow.canUseSkill()).toBeNull();
  });

  it('拒绝计数会累计，并发出 `world.unitCap:*` 事件（不许静默降级）', () => {
    const { t } = setup();
    const world = t.world;
    while (!world.atUnitCap()) world.addEnemy('dummy', null, 0);
    const before = world.units.length;

    const seen: string[] = [];
    world.sink.general = (event: { text: string }) => {
      seen.push(event.text);
    };
    for (let i = 0; i < 5; i += 1) world.addEnemy('dummy', null, 0);

    expect(world.refusedUnits).toBe(5);
    expect(world.units.length).toBe(before);
    expect(seen.filter((text) => text.startsWith('world.unitCap:')).length).toBe(5);
  });

  it('自然刷新在硬顶前被拦住：不刷怪、不计账，清场后自动恢复', () => {
    // 这张图的 `total` 要足够大，否则 Born 早就因「本波刷满」而停止，测不出硬顶的作用。
    const tables = makeTablesWithSpawner();
    tables.maps[MAP] = mapData({
      key: MAP,
      name: 'World 5',
      level: 35,
      boss: 'boss',
      monsters: [{ type: 'dummy', delay: 100, max: 3, warmup: 0, total: 100, quality: [100] }],
    });
    const player = makePlayer();
    const t = makeTestWorld({ map: MAP, tables, seed: 11, player });
    t.world.addPlayer(player);
    t.world.onMapChanged();
    const world = t.world;
    const born = (world.enemyBorn as EnemyBorn).borns?.[0];
    expect(born).not.toBeNull();

    // 让刷怪器先正常刷几只
    t.clock.advanceBy(500);
    const spawnedNaturally = born!.total;
    expect(spawnedNaturally).toBeGreaterThan(0);

    // 顶到硬顶
    while (!world.atUnitCap()) world.addEnemy('dummy', null, 0);
    const totalAtCap = born!.total;
    const unitsAtCap = world.units.length;

    // 硬顶下推进：不产生新单位，也不推进 Born 的记账（否则该波永远完不成）
    for (let i = 0; i < 5; i += 1) t.clock.advanceBy(2000);
    expect(world.units.length).toBe(unitsAtCap);
    expect(born!.total).toBe(totalAtCap);
    expect(world.refusedUnits).toBe(0); // 在调用前就拦住了，不产生「拒绝」

    // 清到硬顶以下 → 刷新自动恢复（绝不永久停刷）
    for (const unit of enemiesOf(world.units)) world.removeUnit(unit);
    t.clock.advanceBy(2000);
    expect(born!.total).toBeGreaterThan(totalAtCap);
    expect(world.units.length).toBeLessThan(MAX_UNITS_PER_WORLD);
  });

  it('硬顶下不刷 BOSS（也不会把 worldBoss 标记打到孤儿上）', () => {
    const { t, spawner } = setup();
    const world = t.world;
    while (!world.atUnitCap()) world.addEnemy('dummy', null, 0);
    const refusedBefore = world.refusedUnits;
    const unitsBefore = world.units.length;

    spawner.trySpawnWorldBoss();

    expect(world.units.length).toBe(unitsBefore);
    expect(world.units.some((u) => u instanceof EnemyUnit && u.worldBoss)).toBe(false);
    expect(world.refusedUnits).toBe(refusedBefore); // 在调用前就返回，不产生拒绝
  });

  it('玩家单位不受硬顶影响，且硬顶给出的上界成立', () => {
    const { t, player } = setup();
    const world = t.world;
    expect(world.playerUnit).not.toBeNull();
    while (!world.atUnitCap()) world.addEnemy('dummy', null, 0);
    for (let i = 0; i < 20; i += 1) world.addEnemy('dummy', null, 0);

    // 上界：差分循环 O(units × 9) 的 N 有界
    expect(world.units.length).toBeLessThanOrEqual(MAX_UNITS_PER_WORLD);
    expect(world.playerUnit?.camp).toBe('player');
    // 玩家仍在表内（未被顶掉）
    expect(world.units.includes(world.playerUnit as never)).toBe(true);
    void player;
  });

  it('边界：MAX_UNITS_PER_WORLD 取值是「安全阀」而不是平衡旋钮', () => {
    // 正常玩法（4 自然怪 + 1 BOSS + 少量召唤）≈ 10，必须离硬顶很远；
    // 同时硬顶不能大到让单帧失去意义（32 × 264B ≈ 8.4KB 是 reset 帧的悲观上界）。
    expect(MAX_UNITS_PER_WORLD).toBeGreaterThanOrEqual(16);
    expect(MAX_UNITS_PER_WORLD).toBeLessThanOrEqual(64);
  });
});
