/**
 * 战斗世界装配（在线 tick 与离线结算共用）
 *
 * 把 `game-core` 的 `BattleWorld` 与 rules 掉落实现、`Player` 影子适配接起来。
 * 时钟由调用方注入：在线用 `RealClock`（pause + `stepPaused`），离线用 `VirtualClock`
 * （`advanceBy` + 预算）。
 */
import {
  BattleWorld,
  PlayerUnit,
  SeededRngFactory,
  type BattleSink,
  type Clock,
  type DataTables,
  type Player,
} from '@idle-dark/game-core';
import { RulesLootService } from './loot-service.js';
import { toPlayerLike, type LootRecorder } from './player-like.js';

export interface BuildWorldOptions {
  tables: DataTables;
  player: Player;
  /** 当前地图 key。 */
  map: string;
  endlessLevel?: number;
  /** 持久化随机种子（复算用）。 */
  seed: number;
  sink: BattleSink;
  clock: Clock;
  /** 离线快进倍率（原版 `world.updateRate`）。 */
  updateRate?: number;
  /** 角色经验倍率（`1` = 原版；只影响经验，不影响掉落）。 */
  expRate?: number;
  /** 原版 `game.onEnemyKilled`（击杀任务 / 掉落计数）。 */
  onEnemyKilled?: (type: string, count: number, role?: string) => void;
  /** 原版 `game.medicineLevel.get(type)`。 */
  medicineLevel?: (type: string) => number;
  /** 掉落落地记录（用于推送 / 离线报告）。 */
  lootRecorder?: LootRecorder;
  /** 掉落词缀随机流的派生标签（默认 `equipLoot`）。 */
  lootStreamLabel?: string;
}

export interface BuiltWorld {
  world: BattleWorld;
  playerUnit: PlayerUnit;
}

/** 构造并启动一个战斗世界（已进入 `map`，刷怪器已就绪）。 */
export function buildBattleWorld(options: BuildWorldOptions): BuiltWorld {
  const root = new SeededRngFactory().create(normalizeSeed(options.seed));
  const lootService = new RulesLootService(
    options.tables,
    root.fork(options.lootStreamLabel ?? 'equipLoot'),
  );
  const like = toPlayerLike(options.player, options.tables, options.lootRecorder);

  const world = new BattleWorld({
    clock: options.clock,
    tables: options.tables,
    rng: root,
    sink: options.sink,
    player: like,
    map: options.map,
    endlessLevel: normalizeEndless(options.endlessLevel),
    updateRate: normalizeRate(options.updateRate),
    ...(options.expRate === undefined ? {} : { expRate: options.expRate }),
    lootService,
    ...(options.medicineLevel ? { medicineLevel: options.medicineLevel } : {}),
    ...(options.onEnemyKilled ? { onEnemyKilled: options.onEnemyKilled } : {}),
  });

  const playerUnit = world.addPlayer(like);
  world.onMapChanged();
  return { world, playerUnit };
}

/** 生成一个可持久化的新种子（`nextSeed` 是 game-core 唯一允许的真随机入口）。 */
export function nextWorldSeed(): number {
  return new SeededRngFactory().nextSeed();
}

function normalizeSeed(seed: unknown): number {
  return typeof seed === 'number' && Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1;
}

function normalizeEndless(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  return n > 0 ? n : 0;
}

function normalizeRate(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  return n > 0 ? n : 1;
}
