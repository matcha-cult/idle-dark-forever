/**
 * 探究：会话重启（刷新/重连/换图回来）后，wave 已过 20 但 BOSS 未击杀时，
 * BOSS 会不会在后续波次重新出现？
 *
 * 依据 WorldService.start()：只把 `wave` 交给 `enemyBornState`，
 * 单位（含 worldBoss）不入档 → 重启后 BOSS 丢失。
 * trySpawnWorldBoss 只在 `wave % 20 === 0` 被调 → 若丢掉，下一次是 wave 40。
 */
import {
  createDefaultTables,
  BattleWorld,
  SeededRngFactory,
  Player,
  VirtualClock,
  InventorySlot,
} from '../../packages/game-core/dist/index.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;

function makeWorld(wave) {
  const clock = new VirtualClock();
  const player = Player.fromJSON(tables, 'c1', () => NOW, { role: 'Eyer', currentCareer: 'warrior' });
  player.postCreate();
  player.level = 80;
  const w = new InventorySlot(tables, 'inventory').fromJSON({ key: 'woodSword', count: 1 });
  player.inventory.push(w);
  player.equip(w);
  const like = Object.create(player);
  Object.defineProperty(like, 'loot', { value: () => 0, writable: true, enumerable: true });
  const sink = { damage() {}, heal() {}, dodge() {}, buff() {}, exp() {}, loot() {}, general() {}, death() {}, mapEnter() {} };
  const world = new BattleWorld({
    clock, tables, rng: new SeededRngFactory().create(99), sink,
    player: like, map: 'world.2', updateRate: 1, expRate: 1,
  });
  world.addPlayer(like);
  // 模拟 WorldService.start() 的恢复：只有 wave，没有单位
  world.onMapChanged({ enemyBorn: { wave } });
  world.playerUnit?.rebindEquipmentHooks?.();
  world.playerUnit?.rebindPassiveHooks?.();
  clock.pause();
  return { clock, world, player };
}

function runTo(maxWave) {
  const { clock, world } = makeWorld(20);
  const firstBossWave = { wave: null };
  let last = 0;
  let rest = 60 * 60_000;
  let steps = 0;
  while (rest > 0 && steps < 60000) {
    const left = clock.stepPaused(200, 2000);
    steps += 1;
    rest -= (200 - left);
    const wave = world.enemyBorn?.wave ?? 0;
    if (wave !== last) {
      last = wave;
      const boss = world.units.find((u) => u.worldBoss);
      if (boss && firstBossWave.wave === null) firstBossWave.wave = wave;
    }
    if (wave >= maxWave) break;
  }
  const res = { startWave: 20, reachedWave: world.enemyBorn?.wave ?? 0, firstBossWave: firstBossWave.wave };
  world.dispose();
  clock.dispose();
  return res;
}

console.log(JSON.stringify({
  restoreAtWave20: runTo(39),
  restoreAtWave20_toWave40: runTo(41),
  restoreAtWave19: (() => {
    // 对照组：从 wave 19 开始，应当在第 20 波正常刷 BOSS
    const { clock, world } = makeWorld(19);
    let last = 0;
    let firstBossWave = null;
    let rest = 60 * 60_000;
    let steps = 0;
    while (rest > 0 && steps < 60000) {
      const left = clock.stepPaused(200, 2000);
      steps += 1;
      rest -= (200 - left);
      const wave = world.enemyBorn?.wave ?? 0;
      if (wave !== last) {
        last = wave;
        if (world.units.some((u) => u.worldBoss) && firstBossWave === null) firstBossWave = wave;
      }
      if (wave >= 25) break;
    }
    const r = { startWave: 19, reachedWave: world.enemyBorn?.wave ?? 0, firstBossWave };
    world.dispose();
    clock.dispose();
    return r;
  })(),
}, null, 2));
