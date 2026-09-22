/**
 * W12：**守关 BOSS 在场时停止自然刷怪**（产品拍板）。
 *
 * ## 规则
 *
 * `Born.onTimer` 的自然刷怪闸门在原有两条（本图同屏上限 / 全局单位硬顶）之前，
 * 先查 `BattleWorld.hasWorldBossUnit()` —— **BOSS 在场就不刷杂兵**，让 BOSS 战不再掺杂兵。
 *
 * ⚠️ 口径是「**存在**」而不是「存活」：`hasWorldBossUnit()` 连已死亡但尚未清尸的 `ghost`
 * 也算在场，因此 BOSS 死后要等清尸（默认 3s）才恢复刷怪。这是**产品选择**，本文件把它钉死。
 * ⚠️ 已知尾巴：`chapter3.beast.pengpeng`（world.11 的 BOSS）携带 `simba.goodFriends`，
 * 其 `willClean` 在「仍有兄弟存活」时返回 `false` ⇒ 尸体不挂清尸计时器，要等最后一个兄弟
 * 死亡时才统一清 —— 那段时间杂兵停刷。见 `BattleWorld.hasWorldBossUnit` 的注释。
 *
 * ## 本文件钉死的行为
 *
 * 1. BOSS 在场 → `Born.total` **不前进**（不是"刷得慢"，是一点都不刷）；
 * 2. BOSS 死但尸体还在 → **仍拦**；尸体清掉 → 立即恢复（靠保持轮询，无需任何外部重置）；
 * 3. 波数会**冻结在 BOSS 那一波**（`isWaveComplete` 要求 `total >= config.total`）；
 * 4. **精英不拦**（只拦守关 BOSS）、**召唤物不拦**（走 `addEnemy(..., summoner)`，不经闸门）；
 * 5. 混沌图同样适用；无 `boss` 的图不受影响。
 */
import { describe, expect, it } from 'vitest';

import { enemyData, makePlayer, makeTables, makeTestWorld, mapData } from './test-support.js';
import { EnemyUnit } from './enemy-unit.js';
import { EnemyBorn, WORLD_BOSS_WAVE_INTERVAL } from './spawner.js';

const MAP = 'field';
const MAP_LEVEL = 35;
/** 清尸周期（`EnemyUnit.setCleanTimer` 默认值）。 */
const CLEAN_MS = 3000;

/**
 * 一张带守关 BOSS 的野外图；`total` 给大值，这样 `Born.total` 增长就是「允许刷怪」的干净信号。
 *
 * ⚠️ `warmup` 必须是**正的**（与生产图的 `WARMUP = 1000` 一致）：`warmup: 0` 会让波首的
 * `setTimer(true)` **同步**刷出一只杂兵 —— 而 BOSS 是在 `completeWave()` 里 `born.reset()`
 * **之后**才同步 `addEnemy` 的，于是「BOSS 波起步就带一只杂兵」。生产数据不会这样，
 * 但这条差异会掩盖闸门本身，所以 fixture 跟生产对齐。
 */
function makeTablesWithBoss(options: { boss?: boolean } = {}) {
  const tables = makeTables();
  tables.maps = {
    home: mapData({ key: 'home', name: 'Home', monsters: [] }),
    [MAP]: mapData({
      key: MAP,
      name: 'World',
      level: MAP_LEVEL,
      ...(options.boss === false ? {} : { boss: 'boss' }),
      monsters: [{ type: 'dummy', delay: 500, max: 3, warmup: 1000, total: 100, quality: [100] }],
    }),
  };
  tables.enemies = {
    ...tables.enemies,
    // 打不死也打不动玩家：让「BOSS 一直在场」成为稳定前提，测试只观察闸门。
    boss: enemyData({
      key: 'boss',
      name: 'World Boss',
      maxHp: 1e9,
      atk: 0,
      atkSpeed: 0,
      exp: 5,
      level: 99,
    }),
  };
  return tables;
}

function setup(options: { boss?: boolean; map?: string } = {}) {
  const tables = makeTablesWithBoss(options);
  const map = options.map ?? MAP;
  const player = makePlayer();
  const t = makeTestWorld({ map, tables, seed: 7, player });
  t.world.addPlayer(player);
  t.world.onMapChanged();
  const spawner = t.world.enemyBorn as EnemyBorn;
  const born = spawner.borns?.[0];
  if (!born) throw new Error('缺少刷怪器');
  return { t, spawner, born };
}

function bossUnits(t: { world: { units: unknown[] } }): EnemyUnit[] {
  return t.world.units.filter((u): u is EnemyUnit => u instanceof EnemyUnit && u.worldBoss);
}

/** 推到第 20 波（BOSS 波）并返回当前 BOSS。 */
function reachBossWave(setupResult: ReturnType<typeof setup>): EnemyUnit {
  const { t, spawner } = setupResult;
  for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
  const boss = bossUnits(t)[0];
  if (!boss) throw new Error('第 20 波没有刷出 BOSS');
  return boss;
}

describe('hasWorldBossUnit：口径是「存在」（含 ghost 尸体）', () => {
  it('空世界 / 普通怪 → false；BOSS 存活 → true', () => {
    const { t, born } = setup({ boss: false });
    expect(t.world.hasWorldBossUnit()).toBe(false);
    t.world.addEnemy('dummy', null, 0);
    expect(t.world.hasWorldBossUnit()).toBe(false);
    void born;

    const withBoss = setup();
    expect(withBoss.world === undefined).toBe(true); // 占位，避免误用
    const boss = withBoss.t.world.addEnemy('boss', null, 0);
    boss.worldBoss = true;
    expect(withBoss.t.world.hasWorldBossUnit()).toBe(true);
  });

  it('BOSS **死亡后尸体仍在场** → 仍然 true（这是「存在」而非「存活」的关键）', () => {
    const s = setup();
    const boss = s.t.world.addEnemy('boss', null, 0);
    boss.worldBoss = true;
    boss.kill();
    expect(boss.camp).toBe('ghost');
    expect(s.t.world.units).toContain(boss);
    expect(s.t.world.hasWorldBossUnit()).toBe(true);
  });

  it('尸体被移除后 → false', () => {
    const s = setup();
    const boss = s.t.world.addEnemy('boss', null, 0);
    boss.worldBoss = true;
    boss.kill();
    s.t.world.removeUnit(boss);
    expect(s.t.world.hasWorldBossUnit()).toBe(false);
  });
});

describe('W12 自然刷怪闸门：BOSS 在场就停刷', () => {
  it('BOSS 存活 → `Born.total` 一点不涨（不是刷得慢）', () => {
    const s = setup();
    reachBossWave(s);
    expect(s.born.total).toBe(0);

    for (let i = 0; i < 10; i += 1) s.t.clock.advanceBy(5000);
    expect(s.born.total).toBe(0);
    // 场上除了 BOSS 与第 10 波精英，没有任何杂兵。
    const nonBoss = s.t.world.units.filter(
      (u): u is EnemyUnit => u instanceof EnemyUnit && !u.worldBoss,
    );
    expect(nonBoss.every((u) => u.elite || u.camp === 'ghost')).toBe(true);
  });

  it('BOSS 死亡但尸体未清 → **仍拦**；尸体清掉后**立即恢复**（无需任何外部重置）', () => {
    const s = setup();
    const boss = reachBossWave(s);
    boss.kill(); // shouldWait=true → 3s 后清尸
    expect(s.t.world.hasWorldBossUnit()).toBe(true);

    // 清尸之前：一直不刷。
    s.t.clock.advanceBy(CLEAN_MS - 500);
    expect(s.born.total).toBe(0);

    // 越过清尸周期 → 尸体移除 → 刷怪自行恢复。
    s.t.clock.advanceBy(2000);
    expect(s.t.world.hasWorldBossUnit()).toBe(false);
    expect(s.born.total).toBeGreaterThan(0);
  });

  it('`shouldWait=false`（0ms 清尸）→ 下一次推进就恢复', () => {
    const s = setup();
    const boss = reachBossWave(s);
    boss.kill(false);
    // 越过 `warmup`（1000ms）并留出余量：清尸在 T+0、首次刷怪在 T+1000。
    s.t.clock.advanceBy(2000);
    expect(s.t.world.hasWorldBossUnit()).toBe(false);
    expect(s.born.total).toBeGreaterThan(0);
  });

  it('波数**冻结在 BOSS 那一波**（`isWaveComplete` 需要 `total >= config.total`）', () => {
    const s = setup();
    reachBossWave(s);
    expect(s.spawner.wave).toBe(WORLD_BOSS_WAVE_INTERVAL);

    for (let i = 0; i < 10; i += 1) s.t.clock.advanceBy(5000);
    // 既不完成该波，也不推进波数 —— BOSS 战期间波数是停的。
    expect(s.spawner.wave).toBe(WORLD_BOSS_WAVE_INTERVAL);
    expect(s.spawner.isWaveComplete()).toBe(false);
  });

  it('BOSS 清尸后杂兵照常刷满并推进波数（闸门不是「永久停刷」）', () => {
    const s = setup();
    const boss = reachBossWave(s);
    boss.kill(false);

    let guard = 0;
    while (s.spawner.wave === WORLD_BOSS_WAVE_INTERVAL && guard < 200) {
      guard += 1;
      s.t.clock.advanceBy(2000);
      for (const unit of [...s.t.world.units]) {
        if (unit instanceof EnemyUnit && !unit.worldBoss) s.t.world.removeUnit(unit);
      }
    }
    expect(s.spawner.wave).toBe(WORLD_BOSS_WAVE_INTERVAL + 1);
  });

  it('**精英不拦**：第 10 波精英在场时杂兵照刷（只拦守关 BOSS）', () => {
    const s = setup();
    for (let i = 0; i < 10; i += 1) s.spawner.completeWave();
    const elite = s.t.world.units.find(
      (u): u is EnemyUnit => u instanceof EnemyUnit && u.elite,
    );
    expect(elite).toBeTruthy();
    expect(s.t.world.hasWorldBossUnit()).toBe(false);

    s.t.clock.advanceBy(2000);
    expect(s.born.total).toBeGreaterThan(0);
  });

  it('**召唤物不拦**：非 BOSS 的召唤单位既不触发闸门、也不拦刷怪', () => {
    const s = setup();
    const summoner = s.t.world.addEnemy('dummy', null, 0);
    const summon = s.t.world.addEnemy('dummy', null, 0, summoner);
    expect(summon.worldBoss).toBe(false);
    expect(s.t.world.hasWorldBossUnit()).toBe(false);

    s.t.clock.advanceBy(2000);
    expect(s.born.total).toBeGreaterThan(0);
  });

  it('无 `boss` 配置的图不受影响（对照组）', () => {
    const s = setup({ boss: false });
    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) s.spawner.completeWave();
    expect(s.t.world.hasWorldBossUnit()).toBe(false);
    s.t.clock.advanceBy(2000);
    expect(s.born.total).toBeGreaterThan(0);
  });

  it('混沌图同样适用（BOSS 也是 `worldBoss`）', () => {
    const tables = makeTablesWithBoss();
    tables.maps['chaos.t01'] = mapData({
      key: 'chaos.t01',
      name: 'Chaos T1',
      level: 85,
      chaos: 1,
      boss: 'boss',
      monsters: [{ type: 'dummy', delay: 500, max: 3, warmup: 1000, total: 100, quality: [100] }],
    });
    const player = makePlayer();
    const t = makeTestWorld({ map: 'chaos.t01', tables, seed: 7, player });
    t.world.addPlayer(player);
    t.world.onMapChanged();
    const spawner = t.world.enemyBorn as EnemyBorn;
    const born = spawner.borns?.[0];
    if (!born) throw new Error('缺少刷怪器');

    for (let i = 0; i < WORLD_BOSS_WAVE_INTERVAL; i += 1) spawner.completeWave();
    expect(bossUnits(t)).toHaveLength(1);
    expect(born.total).toBe(0);
    t.clock.advanceBy(10000);
    expect(born.total).toBe(0);
  });

  it('闸门优先于同屏上限与全局硬顶（三条判据并存时仍是「不刷」）', () => {
    const s = setup();
    reachBossWave(s);
    // 把图填到全局硬顶附近也不改变结论：本来就不刷。
    while (!s.t.world.atUnitCap()) s.t.world.addEnemy('dummy', null, 0);
    expect(s.t.world.hasWorldBossUnit()).toBe(true);
    s.t.clock.advanceBy(5000);
    expect(s.born.total).toBe(0);
    expect(s.t.world.atUnitCap()).toBe(true);
  });
});
