/**
 * 战斗 tick 成本基准：每 tick 每个角色要花多少 CPU？
 * 用真实数据表 + 真实 BattleWorld（与 WorldService.tickSession 同样的调用方式：
 * pause() 后 stepPaused(200ms, budget)）。
 */
import { createDefaultTables, BattleWorld, SeededRngFactory, Player, VirtualClock } from '../packages/game-core/dist/index.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;
const BUDGET = 2_000;      // WORLD_CONFIG.callbackBudgetPerCharacterPerTick
const STEP_MS = 200;       // WORLD_CONFIG.tickIntervalMs

function makeWorld(i, clock) {
  const player = Player.fromJSON(tables, `c${i}`, () => NOW, {
    role: 'Eyer', currentCareer: 'warrior', careers: { warrior: { type: 'warrior', level: 1 } },
  });
  player.postCreate();
  player.selectCareer('warrior');
  const sink = { events: [], damage(){}, heal(){}, dodge(){}, death(){}, buff(){}, exp(){}, general(){}, loot(){}, mapEnter(){} };
  const world = new BattleWorld({
    clock, tables, rng: new SeededRngFactory().create(i + 1), sink,
    player, map: 'town.street', updateRate: 1, expRate: 10,
  });
  world.addPlayer(player);
  world.onMapChanged();
  return world;
}

function bench(n, rounds) {
  const clocks = [];
  const worlds = [];
  for (let i = 0; i < n; i++) {
    const clock = new VirtualClock();
    const world = makeWorld(i, clock);
    // 先 warmup 2s 虚拟时间，让怪物刷出来（模拟"已经在打"的稳态）
    clock.pause();
    clock.stepPaused(2000, BUDGET);
    clocks.push(clock); worlds.push(world);
  }
  const t0 = process.hrtime.bigint();
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n; i++) clocks[i].stepPaused(STEP_MS, BUDGET);
  }
  const t1 = process.hrtime.bigint();
  const perCharTickUs = Number(t1 - t0) / 1e3 / (rounds * n);
  const units = worlds.reduce((s, w) => s + w.units.length, 0) / n;
  for (const w of worlds) w.dispose();
  for (const c of clocks) c.dispose();
  return { n, rounds, perCharTickUs: +perCharTickUs.toFixed(2), avgUnits: +units.toFixed(1),
           totalMs: +(Number(t1 - t0) / 1e6).toFixed(1) };
}

console.log('=== 单角色一次 tick 的 CPU 成本（200ms 虚拟时间，budget=2000）===');
for (const n of [10, 100]) console.log(JSON.stringify(bench(n, 50)));

// 稳态（跑久一点，怪物更多、伤害事件更多）
console.log('=== 稳态（先跑 30s 虚拟时间再测）===');
for (const n of [10, 100]) {
  const clocks = [], worlds = [];
  for (let i = 0; i < n; i++) {
    const clock = new VirtualClock();
    const world = makeWorld(i, clock);
    clock.pause();
    for (let k = 0; k < 150; k++) clock.stepPaused(200, BUDGET);
    clocks.push(clock); worlds.push(world);
  }
  const t0 = process.hrtime.bigint();
  for (let r = 0; r < 50; r++) for (let i = 0; i < n; i++) clocks[i].stepPaused(STEP_MS, BUDGET);
  const t1 = process.hrtime.bigint();
  console.log(JSON.stringify({ n, rounds: 50, perCharTickUs: +(Number(t1 - t0) / 1e3 / (50 * n)).toFixed(2),
    avgUnits: +(worlds.reduce((s,w)=>s+w.units.length,0)/n).toFixed(1) }));
  for (const w of worlds) w.dispose();
  for (const c of clocks) c.dispose();
}
