/** 不同地图（单位数不同）下的单角色 tick 成本 */
import { createDefaultTables, BattleWorld, SeededRngFactory, Player, VirtualClock } from '../packages/game-core/dist/index.js';
const tables = createDefaultTables();
const NOW = 1_700_000_000_000;
const BUDGET = 2000;
function makeWorld(i, clock, map) {
  const player = Player.fromJSON(tables, `c${i}`, () => NOW, {
    role: 'Eyer', currentCareer: 'warrior', careers: { warrior: { type: 'warrior', level: 1 } } });
  player.postCreate(); player.selectCareer('warrior');
  let events = 0;
  const sink = { events: [], damage(){events++}, heal(){events++}, dodge(){}, death(){events++}, buff(){events++}, exp(){}, general(){}, loot(){}, mapEnter(){} };
  const world = new BattleWorld({ clock, tables, rng: new SeededRngFactory().create(i + 1), sink,
    player, map, updateRate: 1, expRate: 10 });
  world.addPlayer(player); world.onMapChanged();
  clock.pause();
  for (let k = 0; k < 300; k++) clock.stepPaused(200, BUDGET); // 稳态 60s 虚拟时间
  return { world, clock, eventsSeen: () => events };
}
const maps = process.argv.slice(2);
console.log('map, units, us_per_char_tick, events_per_60s');
for (const map of maps) {
  const N = 30;
  const held = [];
  for (let i = 0; i < N; i++) { const c = new VirtualClock(); held.push(makeWorld(i, c, map)); }
  const t0 = process.hrtime.bigint();
  for (let r = 0; r < 50; r++) for (const h of held) h.clock.stepPaused(200, BUDGET);
  const t1 = process.hrtime.bigint();
  const us = Number(t1 - t0) / 1e3 / (50 * N);
  const units = held.reduce((s, h) => s + h.world.units.length, 0) / N;
  const ev = held.reduce((s, h) => s + h.eventsSeen(), 0) / N;
  console.log(`${map}, ${units.toFixed(1)}, ${us.toFixed(2)}, ${Math.round(ev)}`);
  for (const h of held) { h.world.dispose(); h.clock.dispose(); }
}
