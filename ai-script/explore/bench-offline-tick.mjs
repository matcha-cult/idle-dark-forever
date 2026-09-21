/**
 * 探究用基准：如果让「离线角色」也在服务端实时 tick，成本是多少？
 *
 * 与 packages/server WorldService.tickSession 完全相同的驱动方式：
 *   clock.pause() → 每 200ms 调一次 clock.stepPaused(200ms, budget=2000)
 *
 * 目的：为「离线实时战斗（C3）」方案给出量化依据，不修改任何仓库源码。
 * 只读 game-core 的 dist，落盘仅在本 tmp 目录。
 */
import {
  createDefaultTables,
  BattleWorld,
  SeededRngFactory,
  Player,
  VirtualClock,
} from '../../packages/game-core/dist/index.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;
const BUDGET = 2_000; // callbackBudgetPerCharacterPerTick
const STEP_MS = 200; // tickIntervalMs
const MAP = process.env.BENCH_MAP ?? 'world.1';
const ROUND_CPU_BUDGET_MS = 40; // maxRoundCpuMs
const WARMUP_MS = 5_000;

function makeWorld(i, clock, sink) {
  const player = Player.fromJSON(tables, `c${i}`, () => NOW, {
    role: 'Eyer',
    currentCareer: 'warrior',
    careers: { warrior: { type: 'warrior', level: 1 } },
  });
  player.postCreate();
  player.selectCareer('warrior');
  const world = new BattleWorld({
    clock,
    tables,
    rng: new SeededRngFactory().create(i + 1),
    sink,
    player,
    map: MAP,
    updateRate: 1,
    expRate: 1,
  });
  world.addPlayer(player);
  world.onMapChanged();
  return world;
}

const silentSink = {
  damage() {}, heal() {}, dodge() {}, death() {}, buff() {},
  exp() {}, general() {}, loot() {}, mapEnter() {},
};

function bench(n, rounds) {
  const clocks = [];
  const worlds = [];
  for (let i = 0; i < n; i += 1) {
    const clock = new VirtualClock();
    clock.pause();
    const world = makeWorld(i, clock, silentSink);
    // warmup：让刷怪器进入稳态（怪物已刷出并在战斗）
    let rest = WARMUP_MS;
    let guard = 0;
    while (rest > 0 && guard < 1000) {
      rest = clock.stepPaused(rest, BUDGET);
      guard += 1;
    }
    worlds.push(world);
    clocks.push(clock);
  }

  const t0 = process.hrtime.bigint();
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < n; i += 1) clocks[i].stepPaused(STEP_MS, BUDGET);
  }
  const t1 = process.hrtime.bigint();

  const totalMs = Number(t1 - t0) / 1e6;
  const perCharTickUs = (Number(t1 - t0) / 1e3 / (rounds * n));
  const units = worlds.reduce((s, w) => s + w.units.length, 0) / n;
  for (const w of worlds) w.dispose();
  for (const c of clocks) c.dispose();
  return {
    n,
    rounds,
    avgUnits: +units.toFixed(1),
    perCharTickUs: +perCharTickUs.toFixed(2),
    perRoundMs: +(totalMs / rounds).toFixed(2),
    roundCpuPct: +((totalMs / rounds) / ROUND_CPU_BUDGET_MS * 100).toFixed(1),
  };
}

const sizes = (process.env.BENCH_SIZES ?? '1,100,500,1000,2000').split(',').map(Number);
const rounds = Number(process.env.BENCH_ROUNDS ?? 50);
console.log(JSON.stringify({ map: MAP, budget: BUDGET, stepMs: STEP_MS, rounds }));
for (const n of sizes) {
  // eslint-disable-next-line no-await-in-loop
  const r = bench(n, rounds);
  console.log(JSON.stringify(r));
}
