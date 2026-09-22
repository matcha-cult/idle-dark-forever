/**
 * 续探基准：**离线常驻会话的「推送差分」成本**（研究稿 §7 只量了 `stepPaused`，漏了这段）。
 *
 * ## 为什么这段必须单独量
 *
 * 研究稿 §7 的 2.6–3.5 µs/角色/tick 只覆盖 `clock.stepPaused(...)`。但 `WorldService.tickSession`
 * 每 tick 还会走 `emitTick`：
 *   `world.units.map(unitStateDtoOf)` → `diffUnitStates(lastSent, units)` → `worldFrameOf(...)`。
 * 这段是 **O(单位数 × 白名单长度 17)** 的，与「世界是否推进」无关。
 *
 * 关键推论（本脚本要验证的）：**离线（未附着）会话根本不需要差分** —— 它不推帧，
 * 只要把 `collector` 的 exp/gold/loot 折进 `awaySummary` 再 `drain()` 即可。
 * 若照搬「先 buildFrame 再决定发不发」，离线会话每 tick 白付一次全量 DTO + diff 的钱。
 *
 * ## 三种口径
 *
 *  - `step`    ：只 `stepPaused`（= 研究稿 §7 的口径，**低估**）
 *  - `step+dto`：`stepPaused` + `units.map(unitStateDtoOf)`（构 DTO）
 *  - `full`    ：再加 `diffUnitStates`（= 现 `emitTick` 的真实成本）
 *
 * 跑法：`node ai-script/explore/bench-offline-emit.mjs`
 * 环境变量同 `bench-offline-tick.mjs`：`BENCH_MAP` / `BENCH_ROUNDS` / `BENCH_SIZES`。
 */
import {
  createDefaultTables,
  BattleWorld,
  SeededRngFactory,
  Player,
  VirtualClock,
} from '../../packages/game-core/dist/index.js';
import { unitStateDtoOf } from '../../packages/server/dist/modules/logic/world/internal/unit-state.js';
import { diffUnitStates } from '../../packages/server/dist/modules/logic/world/internal/unit-state-diff.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;
const BUDGET = 2_000;
const STEP_MS = 200;
const WARMUP_MS = 5_000;
const MAP = process.env.BENCH_MAP ?? 'world.9';
const ROUND_CPU_BUDGET_MS = 40;

const silentSink = {
  damage() {}, heal() {}, dodge() {}, buff() {}, exp() {}, general() {}, loot() {}, mapEnter() {},
};

function makeWorld(i, clock) {
  const player = Player.fromJSON(tables, `c${i}`, () => NOW, {
    role: 'Eyer',
    currentCareer: 'warrior',
    careers: { warrior: { type: 'warrior', level: 1 } },
  });
  player.postCreate();
  player.selectCareer('warrior');
  const world = new BattleWorld({
    clock, tables, rng: new SeededRngFactory().create(i + 1), sink: silentSink,
    player, map: MAP, updateRate: 1, expRate: 1,
  });
  world.addPlayer(player);
  world.onMapChanged();
  clock.pause();
  let rest = WARMUP_MS;
  let guard = 0;
  while (rest > 0 && guard < 1000) {
    rest = clock.stepPaused(rest, BUDGET);
    guard += 1;
  }
  return world;
}

function bench(n, rounds) {
  const clocks = [];
  const worlds = [];
  const baselines = [];
  for (let i = 0; i < n; i += 1) {
    const clock = new VirtualClock();
    const world = makeWorld(i, clock);
    worlds.push(world);
    clocks.push(clock);
    baselines.push(new Map());
  }

  // 把**同一个 tick** 拆成三段分别计时，避免「三阶段各跑一遍、世界状态与 JIT 冷热都不同」
  // 带来的顺序偏差（第一版就是这么写错的：step 段吃冷启动、full 段白蹭热 JIT）。
  let accStep = 0n;
  let accDto = 0n;
  let accDiff = 0n;
  const total = rounds * n;
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < n; i += 1) {
      const t0 = process.hrtime.bigint();
      clocks[i].stepPaused(STEP_MS, BUDGET);
      const t1 = process.hrtime.bigint();
      const units = worlds[i].units.map((u) => unitStateDtoOf(u, worlds[i].playerUnit));
      const t2 = process.hrtime.bigint();
      diffUnitStates(baselines[i], units);
      const t3 = process.hrtime.bigint();
      accStep += t1 - t0;
      accDto += t2 - t1;
      accDiff += t3 - t2;
    }
  }

  const us = (acc) => Number(acc) / 1e3 / total;
  const avgUnits = worlds.reduce((s, w) => s + w.units.length, 0) / n;
  for (const w of worlds) w.dispose();
  for (const c of clocks) c.dispose();
  return {
    n,
    rounds,
    avgUnits: +avgUnits.toFixed(1),
    stepUs: +us(accStep).toFixed(2),
    dtoUs: +us(accDto).toFixed(2),
    diffUs: +us(accDiff).toFixed(2),
  };
}

const sizes = (process.env.BENCH_SIZES ?? '1,500,2000').split(',').map(Number);
const rounds = Number(process.env.BENCH_ROUNDS ?? 50);
console.log(JSON.stringify({ map: MAP, stepMs: STEP_MS, rounds, roundCpuBudgetMs: ROUND_CPU_BUDGET_MS }));
for (const n of sizes) {
  const r = bench(n, rounds);
  r.fullUs = +(r.stepUs + r.dtoUs + r.diffUs).toFixed(2);
  r.fullOverStepX = +(r.fullUs / r.stepUs).toFixed(2);
  r.fullRoundMs = +(r.fullUs * n / 1e3).toFixed(2);
  r.fullRoundCpuPct = +((r.fullUs * n / 1e3) / ROUND_CPU_BUDGET_MS * 100).toFixed(1);
  // 只跑时钟（离线应有的口径）
  r.stepRoundMs = +(r.stepUs * n / 1e3).toFixed(2);
  r.stepRoundCpuPct = +((r.stepUs * n / 1e3) / ROUND_CPU_BUDGET_MS * 100).toFixed(1);
  console.log(JSON.stringify(r));
}
