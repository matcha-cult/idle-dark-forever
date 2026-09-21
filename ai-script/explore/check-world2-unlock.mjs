/**
 * 探究：world.2（迷雾林间）挂机到第 20 波时守关 BOSS 是否会刷、击杀后 world.3 是否解锁。
 *
 * 只读 game-core dist；不改仓库源码。目的：判定「超越25波仍未解锁」是逻辑判定错误、
 * 还是「BOSS 没刷 / 没杀掉 / 等级门槛」。
 */
import {
  createDefaultTables,
  BattleWorld,
  SeededRngFactory,
  Player,
  VirtualClock,
  InventorySlot,
  checkRequirement,
} from '../../packages/game-core/dist/index.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;
const MAP = 'world.2';
const STEP_MS = 200;
const BUDGET = 2000;

const clock = new VirtualClock();
const player = Player.fromJSON(tables, 'c1', () => NOW, { role: 'Eyer', currentCareer: 'warrior' });
player.postCreate();
player.level = 50; // 排除等级门槛干扰，专测 BOSS 刷新/登记
const weapon = new InventorySlot(tables, 'inventory').fromJSON({ key: 'woodSword', count: 1 });
player.inventory.push(weapon);
player.equip(weapon);

const like = Object.create(player);
Object.defineProperty(like, 'loot', {
  value: (input) => {
    const key = input?.key ?? null;
    const count = Number.isFinite(input?.count) ? input.count : 0;
    if (key === 'gold') { player.gold += count; return count; }
    return count;
  },
  writable: true,
  enumerable: true,
});

const sink = {
  damage() {}, heal() {}, dodge() {}, buff() {}, exp() {}, loot() {}, mapEnter() {},
  death(e) { if (e.camp) deaths[e.camp] = (deaths[e.camp] ?? 0) + 1; },
  general(e) { if (String(e.text).includes('BOSS') || String(e.text).includes('boss')) generals.push(e.text); },
};
const deaths = {};
const generals = [];

const world = new BattleWorld({
  clock, tables, rng: new SeededRngFactory().create(4242), sink,
  player: like, map: MAP, updateRate: 1, expRate: 1,
});
world.addPlayer(like);
world.onMapChanged();
world.playerUnit?.rebindEquipmentHooks?.();
world.playerUnit?.rebindPassiveHooks?.();
clock.pause();

const events = [];
let lastWave = 0;
let totalSteps = 0;
// 推进到第 22 波（或最多 30 虚拟分钟）
let rest = 30 * 60_000;
while (rest > 0 && totalSteps < 20000) {
  const left = clock.stepPaused(Math.min(rest, STEP_MS), BUDGET);
  totalSteps += 1;
  rest -= (Math.min(rest, STEP_MS) - left);
  const wave = world.enemyBorn?.wave ?? 0;
  if (wave !== lastWave) {
    const bosses = world.units.filter((u) => u.worldBoss).map((u) => `${u.type}:hp${Math.round(u.hp)}:${u.camp}`);
    events.push({ wave, bosses });
    lastWave = wave;
  }
  if (wave >= 22) break;
}

// 若此刻仍有 BOSS 存活，直接打死它，看是否登记 worldBossKilled
const aliveBoss = world.units.find((u) => u.worldBoss);
let killedBoss = null;
if (aliveBoss) {
  killedBoss = `${aliveBoss.type}`;
  aliveBoss.hp = 0;
  aliveBoss.kill?.(false);
}

const player2 = world.player; // shadow
const hasW2 = player.hasWorldBossKilled?.('world.2') ?? false;
const checkWorld3 = checkRequirement(
  tables.maps['world.3'].requirement,
  { player: { role: player.role, currentCareer: player.currentCareer, level: player.level, maxLevel: player.maxLevel }, map: 'world.2', bossKilled: player.worldBossKilled },
);

console.log(JSON.stringify({
  map: MAP,
  finalWave: world.enemyBorn?.wave ?? 0,
  virtualMinutes: +((30 * 60_000 - rest) / 60000).toFixed(1),
  steps: totalSteps,
  unitsNow: world.units.map((u) => `${u.type}:${u.camp}:hp${Math.round(u.hp)}${u.worldBoss ? ':BOSS' : ''}`),
  waveEvents: events,
  generals,
  deaths,
  bossPending: world.bossPending,
  aliveBossBeforeForceKill: killedBoss,
  hasWorldBossKilledWorld2: hasW2,
  worldBossKilled: [...player.worldBossKilled],
  playerLevel: player.level,
  checkWorld3,
}, null, 2));

world.dispose();
clock.dispose();
