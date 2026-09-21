/** 每会话内存 + 每帧推送字节数 */
import { createDefaultTables, BattleWorld, SeededRngFactory, Player, VirtualClock } from '../packages/game-core/dist/index.js';
const tables = createDefaultTables();
const NOW = 1_700_000_000_000;
const BUDGET = 2000;

function makeWorld(i, clock) {
  const player = Player.fromJSON(tables, `c${i}`, () => NOW, {
    role: 'Eyer', currentCareer: 'warrior', careers: { warrior: { type: 'warrior', level: 1 } } });
  player.postCreate(); player.selectCareer('warrior');
  const sink = { events: [], damage(){}, heal(){}, dodge(){}, death(){}, buff(){}, exp(){}, general(){}, loot(){}, mapEnter(){} };
  const world = new BattleWorld({ clock, tables, rng: new SeededRngFactory().create(i + 1), sink,
    player, map: 'town.street', updateRate: 1, expRate: 10 });
  world.addPlayer(player); world.onMapChanged();
  clock.pause(); clock.stepPaused(3000, BUDGET);
  return world;
}

// 内存：测 200 个会话的堆增量
const N = 200;
global.gc?.();
const before = process.memoryUsage().heapUsed;
const held = [];
for (let i = 0; i < N; i++) { const c = new VirtualClock(); held.push([makeWorld(i, c), c]); }
const after = process.memoryUsage().heapUsed;
console.log(JSON.stringify({ sessions: N, heapPerSessionKB: +(((after - before) / N) / 1024).toFixed(1),
  nonHeapNote: 'heapUsed 增量（含单位/词缀/定时器树）' }));

// 单帧 payload：模拟服务端 unitStateDtoOf 的字段面（从 live 服务器抓真实帧更准）
console.log(JSON.stringify({ unitsPerSession: held[0][0].units.length }));
for (const [w, c] of held) { w.dispose(); c.dispose(); }
