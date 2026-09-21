/**
 * 量化：指定等级的角色在某张野外图挂机的经验获取速率（击杀数 / 波数 / 每次击杀经验）。
 *
 * 沿革：本脚本原用于判定「13 级在 world.2 升到 15 级是否现实可达」，当时的结论是**不可达**
 * （经验等级差窗口恰好等于段位宽度，13 级只有 20%、15 级归零，13→14 需 21228 次击杀）。
 * ⚠️ W10 已**整体移除**该经验惩罚，因此 `expPerKill` 不再随等级差变化 ——
 * 本脚本现在的用途是**调经验曲线时的速率测量工具**（配合 `enemies.ts` 的 `exp` 与 `expRate`）。
 */
import {
  createDefaultTables, BattleWorld, SeededRngFactory, Player, VirtualClock, InventorySlot,
} from '../../packages/game-core/dist/index.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;
const MAP = process.env.MAP ?? 'world.2';
const LEVEL = Number(process.env.LEVEL ?? 13);
const MINUTES = Number(process.env.MINUTES ?? 10);

const clock = new VirtualClock();
const player = Player.fromJSON(tables, 'c1', () => NOW, { role: 'Eyer', currentCareer: 'warrior' });
player.postCreate();
player.level = LEVEL;
const w = new InventorySlot(tables, 'inventory').fromJSON({ key: 'copperSword', count: 1 });
player.inventory.push(w);
player.equip(w);

const like = Object.create(player);
Object.defineProperty(like, 'loot', { value: () => 0, writable: true, enumerable: true });
let kills = 0;
const sink = {
  damage() {}, heal() {}, dodge() {}, buff() {}, exp() {}, loot() {}, general() {}, mapEnter() {},
  death(e) { if (e.camp === 'enemy') kills += 1; },
};
const world = new BattleWorld({
  clock, tables, rng: new SeededRngFactory().create(7), sink,
  player: like, map: MAP, updateRate: 1, expRate: 1,
});
world.addPlayer(like);
world.onMapChanged();
world.playerUnit?.rebindEquipmentHooks?.();
world.playerUnit?.rebindPassiveHooks?.();
clock.pause();

const before = { level: player.level, exp: player.exp, maxExp: player.maxExp };
let rest = MINUTES * 60_000;
let steps = 0;
while (rest > 0 && steps < 200000) {
  const left = clock.stepPaused(Math.min(rest, 200), 2000);
  steps += 1;
  rest -= (Math.min(rest, 200) - left);
}
const after = { level: player.level, exp: player.exp, maxExp: player.maxExp };
const gained = (after.level - before.level) * before.maxExp + after.exp - before.exp;
console.log(JSON.stringify({
  map: MAP, level: LEVEL, virtualMinutes: MINUTES,
  kills, waves: world.enemyBorn?.wave ?? 0,
  before, after,
  expGainedApprox: +gained.toFixed(2),
  expPerKill: kills > 0 ? +(gained / kills).toFixed(3) : 0,
  maxExpAtStart: before.maxExp,
  expNeededToNextLevel: before.maxExp - before.exp,
  killsNeededToNextLevel: kills > 0 ? Math.round((before.maxExp - before.exp) / (gained / kills)) : null,
}, null, 2));

world.dispose();
clock.dispose();
