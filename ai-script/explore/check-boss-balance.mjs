/**
 * 守关 BOSS 平衡表：**单挑口径**逐图模拟「同级基准角色 vs 守关 BOSS」，输出击杀时长。
 *
 * 规格来源：`/home/nbb/projects/user-tmp/map-boss-redesign-plan.md` §7 第 6 项 / §8.2。
 *
 * ## 为什么是「单挑」
 *
 * W12 起 `Born.onTimer` 在**守关 BOSS 在场时一只杂兵都不刷**（`BattleWorld.hasWorldBossUnit()`，
 * 口径是「存在」，含已死未清尸的 `ghost`）。所以 BOSS 战的真实形态就是**场上只有 BOSS**；
 * 本脚本因此不驱动刷怪器刷普通怪，只显式刷一只 BOSS，再推进时钟。
 *
 * ## 角色模型（**基准**，非满配）
 *
 * 本引擎的敌人数值与玩家数值都**不随等级自动缩放**：`level` 只影响展示 / 经验 / 掉落门槛。
 * 玩家战力来自职业成长 + **装备上的词缀**（`goods` 底材本身不含 atk）。脚本无法凭空造出
 * 一件「85 级满词缀神装」，因此采用**可复现的基准模型**并在输出里显式标注：
 *
 *  - `level = 地图等级 + LEVEL_OFFSET`（默认 0，即同级）；
 *  - 每个装备槽取「`minLevel ≤ level ≤ maxLevel` 里 `minLevel` 最高」的**底材**（无词缀）；
 *  - 不点强化 / 不带 buff。
 *
 * ⇒ 输出里的 `TIMEOUT` **不代表该图在真实满配下不可击杀**，只说明「基准角色打不动」。
 * 这正是设计稿 §8.2 要的信号（超时 / 不可击杀的图回退数值），据此判断 BOSS 是否过肉。
 *
 * ## 运行
 *
 * ```bash
 * pnpm --filter @idle-dark/game-core run build
 * node ai-script/explore/check-boss-balance.mjs                 # 全部 29 图
 * MAPS=world.10,chaos.t16 node ...                             # 只跑指定图
 * CAP_SECONDS=600 LEVEL_OFFSET=10 node ...                     # 调上限 / 等级
 * ```
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
const CAP_SECONDS = Number(process.env.CAP_SECONDS ?? 300);
const LEVEL_OFFSET = Number(process.env.LEVEL_OFFSET ?? 0);
const STEP_MS = 200;
const TICK_BUDGET = 2_000;
const WEAPON = process.env.WEAPON ?? null;

/** 装备槽（`goods.position` 的口径）。 */
const SLOTS = ['weapon', 'offHand', 'plastron', 'gloves', 'belt', 'boots', 'amulet', 'ring'];

/** 取该槽在等级内可用、`minLevel` 最高的底材 key（无则 `null`）。 */
function bestGoodFor(position, level) {
  let best = null;
  for (const good of Object.values(tables.goods)) {
    if (good.position !== position) continue;
    const minLevel = good.minLevel ?? 0;
    const maxLevel = good.maxLevel ?? Number.POSITIVE_INFINITY;
    if (minLevel > level || maxLevel < level) continue;
    if (minLevel >= 999999) continue; // `wand` 是占位条目
    if (best === null || minLevel > (best.minLevel ?? 0)) best = good;
  }
  return best?.key ?? null;
}

function makePlayer(level) {
  const player = Player.fromJSON(tables, 'c1', () => NOW, { role: 'Eyer', currentCareer: 'warrior' });
  player.postCreate();
  player.level = level;
  player.selectCareer('warrior');
  const weaponKey = WEAPON ?? bestGoodFor('weapon', level);
  for (const slot of SLOTS) {
    const key = slot === 'weapon' ? weaponKey : bestGoodFor(slot, level);
    if (key === null) continue;
    const slotItem = new InventorySlot(tables, 'inventory').fromJSON({ key, count: 1 });
    player.inventory.push(slotItem);
    player.equip(slotItem);
  }
  return player;
}

const silentSink = {
  damage() {}, heal() {}, dodge() {}, buff() {}, exp() {}, loot() {}, general() {}, mapEnter() {}, death() {},
};

/** 跑一张图，返回击杀时长报告。 */
function runMap(mapKey, capSeconds) {
  const map = tables.maps[mapKey];
  const level = (map.level ?? 1) + LEVEL_OFFSET;
  const clock = new VirtualClock();
  const player = makePlayer(level);
  const stats = { playerDamage: 0, playerUnitId: undefined };
  const sink = {
    ...silentSink,
    damage(e) {
      if (stats.playerUnitId !== undefined && String(e.fromId) === String(stats.playerUnitId)) {
        stats.playerDamage += e.value;
      }
    },
  };
  const world = new BattleWorld({
    clock, tables, rng: new SeededRngFactory().create(20240919), sink,
    player, map: mapKey, updateRate: 1, expRate: 1,
  });
  world.addPlayer(player);
  stats.playerUnitId = world.playerUnit?.id;
  world.onMapChanged();
  world.playerUnit?.rebindEquipmentHooks?.();
  world.playerUnit?.rebindPassiveHooks?.();
  clock.pause();

  const spawned = world.enemyBorn.trySpawnWorldBoss();
  const boss = world.units.find((u) => u.worldBoss);
  if (!spawned || !boss) {
    world.dispose();
    clock.dispose();
    return { map: mapKey, boss: map.boss, level, killed: false, reason: 'BOSS 未刷出' };
  }

  const bossId = boss.id;
  const playerId = world.playerUnit?.id;
  const bossMaxHp0 = boss.maxHp;
  const bossAtk0 = boss.atk;
  let elapsedMs = 0;
  let playerDeaths = 0;
  let spawnerMobsSeen = 0;
  let lastCamp = world.playerUnit?.camp;
  const capMs = capSeconds * 1000;
  while (elapsedMs < capMs) {
    const left = clock.stepPaused(STEP_MS, TICK_BUDGET);
    elapsedMs += STEP_MS - left;
    // 单挑口径守护：BOSS 在场时不应再出现**刷怪器**杂兵（W12 闸门）。
    // ⚠️ 敌方召唤物（`summoner` 非空）与精英**不在**闸门内（errata §1.1-4a），故排除。
    for (const unit of world.units) {
      if (unit.id === bossId || unit.id === playerId || unit.worldBoss || unit.summoner) continue;
      if (unit.camp === 'enemy' || unit.camp === 'ghost') spawnerMobsSeen += 1;
    }
    const camp = world.playerUnit?.camp;
    if (lastCamp !== 'ghost' && camp === 'ghost') playerDeaths += 1;
    lastCamp = camp;
    if (boss.camp === 'ghost') break;
  }

  const killed = boss.camp === 'ghost';
  const report = {
    map: mapKey,
    boss: map.boss,
    playerLevel: level,
    bossMaxHp: bossMaxHp0,
    bossAtk: bossAtk0,
    playerAtk: +Number(world.playerUnit?.atkOf?.('main') ?? 0).toFixed(1),
    playerMaxHp: +Number(world.playerUnit?.maxHp ?? 0).toFixed(0),
    seconds: +(elapsedMs / 1000).toFixed(1),
    killed,
    timeToKillSec: killed ? +(elapsedMs / 1000).toFixed(1) : null,
    playerDeaths,
    // 玩家打出的伤害占 BOSS 初始血量的比例：<100% 就死 = 死于自身技能（如 `azathoth.explode`）。
    playerDamagePct: +((stats.playerDamage / Math.max(1, bossMaxHp0)) * 100).toFixed(1),
    bossHpLeft: +Number(boss.hp ?? 0).toFixed(0),
    spawnerMobsSeen: spawnerMobsSeen === 0 ? 0 : '>0（违反单挑口径）',
  };
  world.dispose();
  clock.dispose();
  return report;
}

const allMaps = Object.keys(tables.maps).filter((key) => key.startsWith('world.') || key.startsWith('chaos.'));
const selected = process.env.MAPS ? process.env.MAPS.split(',').map((s) => s.trim()) : allMaps;

console.log(JSON.stringify({
  capSeconds: CAP_SECONDS, levelOffset: LEVEL_OFFSET,
  note: '基准角色（底材无词缀）；TIMEOUT = 基准打不动，不代表满配不可击杀',
}));
let killable = 0;
for (const mapKey of selected) {
  if (!tables.maps[mapKey]) {
    console.log(JSON.stringify({ map: mapKey, error: '地图不存在' }));
    continue;
  }
  // eslint-disable-next-line no-await-in-loop
  const r = runMap(mapKey, CAP_SECONDS);
  if (r.killed) killable += 1;
  console.log(JSON.stringify(r));
}
console.log(JSON.stringify({ maps: selected.length, killable, timedOut: selected.length - killable }));
