/**
 * 验证：仅靠时钟推进（模拟"离线实时战斗"），角色是否真的会涨经验/金币/掉落。
 * 只读 game-core dist；不涉及 server 的 isOnline 判断。
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
const clock = new VirtualClock();
const player = Player.fromJSON(tables, 'c1', () => NOW, {
  role: 'Eyer',
  currentCareer: 'warrior',
});
player.postCreate();

// 角色数据里没有 startup（Eyer 无初始装备）→ 给一把 1 级武器，模拟"有装备的真实玩家"。
const { InventorySlot } = await import('../../packages/game-core/dist/index.js');
let equipped = 0;
const weapon = new InventorySlot(tables, 'inventory').fromJSON({ key: 'woodSword', count: 1 });
player.inventory.push(weapon);
if (player.equip(weapon)) equipped += 1;

let expEvents = 0;let goldEvents = 0;
let lootEvents = 0;
let deathEvents = 0;
let dmgEvents = 0;
let playerDealt = 0;
let monsterDealt = 0;
const deathCamps = {};
const dmgByFrom = {};
const countByFrom = {};
let playerId = null;
const sink = {
  damage(e) {
    dmgEvents += 1;
    const k = String(e.fromId);
    dmgByFrom[k] = (dmgByFrom[k] ?? 0) + (e.value ?? 0);
    countByFrom[k] = (countByFrom[k] ?? 0) + 1;
    if (e.fromId === playerId) playerDealt += e.value ?? 0;
    else monsterDealt += e.value ?? 0;
  },
  heal() {}, dodge() {},
  buff() {}, general() {}, mapEnter() {},
  death(e) { deathEvents += 1; const c = e.camp ?? '?'; deathCamps[c] = (deathCamps[c] ?? 0) + 1; },
  exp() { expEvents += 1; },
  loot() { lootEvents += 1; },
};

// 复刻 server `toPlayerLike` 的最小影子：BattleWorld 会把普通对象交给 player.loot。
const like = Object.create(player);
Object.defineProperty(like, 'loot', {
  value: (input) => {
    const key = input?.key ?? null;
    const count = Number.isFinite(input?.count) ? input.count : 0;
    if (key === 'gold') { player.gold += count; return count; }
    if (key !== null && count > 0) player.wallet.set(key, (player.wallet.get(key) ?? 0) + count);
    return count;
  },
  writable: true,
  enumerable: true,
});

const world = new BattleWorld({
  clock, tables, rng: new SeededRngFactory().create(2024), sink,
  player: like, map: 'world.1', updateRate: 1, expRate: 1,
});
world.addPlayer(like);
world.onMapChanged();
playerId = world.playerUnit?.id ?? null;
// 等价 WorldService 的 CombatHooksDirty 重绑（面板换装后必须重绑，战斗才生效）。
world.playerUnit?.rebindEquipmentHooks?.();
world.playerUnit?.rebindPassiveHooks?.();
clock.pause();

const before = { level: player.level, exp: player.exp, gold: player.gold };
let rest = 10 * 60_000; // 模拟离线 10 分钟
let calls = 0;
while (rest > 0 && calls < 360) {
  rest = clock.stepPaused(rest, 2000);
  calls += 1;
}
const after = { level: player.level, exp: player.exp, gold: player.gold };

console.log(JSON.stringify({
  virtualMinutes: 10,
  simCalls: calls,
  equipped,
  before, after,
  expEvents, goldEvents, lootEvents, deathEvents, deathCamps,
  dmgEvents, playerDealt: Math.round(playerDealt), monsterDealt: Math.round(monsterDealt),
  playerId,
  units: world.units.length,
  playerCamp: world.playerUnit?.camp,
  playerHp: world.playerUnit?.hp,
  playerMaxHp: world.playerUnit?.maxHp,
}));
world.dispose();
clock.dispose();
