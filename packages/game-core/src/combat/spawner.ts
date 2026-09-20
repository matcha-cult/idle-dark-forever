/**
 * 刷怪与波次（原版 `src/logics/EnemyBorn.js`）。
 *
 * ## 去 MobX
 *
 * 原版秘境阶段机用一个 `autorun` 监听「`phaseBorn` 是否全部结束」以推进副本阶段；
 * 该氪金秘境阶段机在 W6 已随旧体系物理删除。现在只保留 open-world 刷怪：
 * 每个 `Born` 在 `over` 置位时回调 `onOver()`，`EnemyBorn` 用它判定整波是否完成。
 *
 * 随机：`randomType` 的加权抽取、`setTimer` 的随机延迟、quality 抽取全部经
 * `world.rng.spawn`；时间全部来自注入的 `Clock`。
 */

import type { Clock, Rng, TimerHandle } from '../contracts/ports.js';
import type { MapData, MonsterSpawnConfig } from '../contracts/data.js';
import { isChaosMap } from '../rules/chaos.js';
import type { BattleWorld } from './battle-world.js';
import { EnemyUnit } from './enemy-unit.js';

/**
 * 野外守关 BOSS 的刷新间隔：每完成这么多波出一次（W4）。
 *
 * `wave % 20 === 0` 时尝试刷新（第 20 / 40 / 60 … 波）。
 */
export const WORLD_BOSS_WAVE_INTERVAL = 20;

/** BOSS 相对地图等级的加成（W4：普通 +0 / 稀有 +1 / BOSS +2）。 */
export const WORLD_BOSS_LEVEL_OFFSET = 2;

/** 原版 `randomType(types)`：按权重抽取（`Math.random()` → `rng.next()`）。 */
export function randomType(types: Record<string, number>, rng: Rng): string {
  const keys = Object.keys(types);
  const total = keys.reduce((a, s) => types[s]! + a, 0);
  let dice = rng.next() * total;

  for (let i = 0; i < keys.length; i++) {
    if (dice < types[keys[i]!]!) {
      return keys[i]!;
    }
    dice -= types[keys[i]!]!;
  }
  return keys[0]!;
}

export interface BornSavedState {
  over?: boolean;
  total?: number;
  timer?: number;
}

export class Born {
  readonly world: BattleWorld;
  readonly clock: Clock;
  readonly config: MonsterSpawnConfig;

  over = false;
  count = 0;
  total = 0;
  timer: TimerHandle | null = null;
  disposed = false;

  /** `over` 置位时通知刷怪控制器（用于波次推进）。 */
  onOver: (() => void) | null = null;

  constructor(
    world: BattleWorld,
    clock: Clock,
    config: MonsterSpawnConfig,
    savedState?: BornSavedState | null,
  ) {
    this.world = world;
    this.clock = clock;
    this.config = config;

    if (savedState) {
      this.over = savedState.over ?? false;
      this.total = savedState.total ?? 0;
      // 原版直接 `this.setTimer(savedState.timer)`：`undefined` 会走默认分支（重新随机延迟），
      // 0（或缺失时被 `?? 0` 误替换）会立刻刷怪。这里保持原版的 undefined 语义。
      if (savedState.timer !== undefined) {
        this.setTimer(savedState.timer);
      } else {
        this.setTimer();
      }
    } else {
      this.setTimer(true);
    }
  }

  testTimer(): void {
    // 看看 count 是否已经达到，是否要取消 timer。
    if (this.config.max && this.count >= this.config.max && this.timer) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  setTimer(startup: boolean | number = false): void {
    if (
      (this.config.max && this.count >= this.config.max) ||
      (this.config.total && this.total >= this.config.total)
    ) {
      return;
    }
    if (typeof startup === 'number') {
      this.schedule(startup);
      return;
    }
    if (!this.timer && !this.disposed) {
      const delay = startup
        ? this.config.warmup || 0
        : this.config.delay && this.config.delay + this.world.rng.spawn.next() * 1000 - 500;
      if (!startup && !delay) {
        return;
      }
      this.schedule(delay as number);
    }
  }

  /** 记录计时起点/延迟（`TimerHandle` 契约不含 `at`，dumpState 需要剩余时间）。 */
  private schedule(delay: number): void {
    this.timerStart = this.clock.getTime();
    this.timerDelay = delay;
    this.timer = this.clock.setTimeout(this.onTimer, delay);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 波次完成后重置（W4）：清空计数与 `over`，并按**与构造时相同**的方式重新武装定时器。
   *
   * 构造（无存档）走 `setTimer(true)` —— 以 `warmup` 起第一波；这里保持一致，
   * 因此下一波同样从 `warmup` 开始。清掉在飞的定时器，避免重复调度。
   */
  reset(): void {
    this.count = 0;
    this.total = 0;
    this.over = false;
    this.disposed = false;
    if (this.timer) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    this.setTimer(true);
  }

  onTimer = (): void => {
    this.timer = null;
    if (
      (this.config.max && this.count >= this.config.max) ||
      (this.config.total && this.total >= this.config.total)
    ) {
      return;
    }

    let quality = 0;
    if (this.config.quality) {
      const sum = this.config.quality.reduce((a, b) => a + b, 0);
      let dice = this.world.rng.spawn.next() * sum;
      quality = this.config.quality.findIndex((v) => {
        if (dice < v) {
          return true;
        }
        dice -= v;
        return false;
      });
    }
    const { type, types } = this.config;
    this.world.addEnemy(
      type || randomType(types ?? {}, this.world.rng.spawn),
      this,
      quality,
    );
    this.count += 1;
    this.total += 1;
    this.setTimer();
  };

  onEnemyKilled(): void {
    this.count -= 1;
    if (this.config.total && this.total >= this.config.total && this.count <= 0) {
      // 所有敌人已经击毙
      this.over = true;
      this.onOver?.();
    } else {
      this.setTimer();
    }
  }

  dumpState(): BornSavedState {
    const ret: BornSavedState = {
      over: this.over,
      total: this.total,
    };
    // 定时器句柄不入快照，只保留剩余时间。
    if (this.timer && this.timerStart !== null) {
      ret.timer = this.timerStart - this.clock.getTime() + this.timerDelay;
    }
    return ret;
  }

  /** `dumpState` 用的计时起点/延迟（`TimerHandle` 契约不含 `at`）。 */
  timerStart: number | null = null;
  timerDelay = 0;
}

export class EnemyBorn {
  readonly world: BattleWorld;
  readonly clock: Clock;
  readonly map: string;

  borns: Array<Born | null> | null = null;

  /**
   * 已完成的波数（open-world，W4）。
   *
   * 一波 = 该图 `monsters` 的全部条目都刷满 `config.total` 且已刷出的敌人全部清空。
   */
  wave = 0;

  constructor(
    world: BattleWorld,
    clock: Clock,
    map: string,
    savedState?: { borns?: BornSavedState[]; wave?: number } | null,
  ) {
    this.world = world;
    this.clock = clock;
    this.map = map;
    const { monsters } = this.mapData ?? ({} as MapData);
    this.borns = monsters
      ? monsters.map((config, i): Born | null => {
          return (
            config &&
            new Born(world, clock, config, savedState && savedState.borns && savedState.borns[i])
          );
        })
      : null;
    const savedWave = savedState?.wave;
    this.wave = typeof savedWave === 'number' && Number.isFinite(savedWave) && savedWave > 0 ? Math.trunc(savedWave) : 0;
    // 显式接线：任一 Born 刷满清空 → 检查整波是否完成（open-world）。
    this.borns?.forEach((born) => {
      if (born) {
        born.onOver = () => this.onBornOver();
      }
    });
  }

  get mapData(): MapData | undefined {
    return this.world.tables.maps[this.map];
  }

  dispose(): void {
    if (this.borns) {
      this.borns.forEach((v) => v?.dispose());
      this.borns = null;
    }
  }

  dumpState(): Record<string, unknown> {
    return {
      borns: this.borns && this.borns.map((v) => v && v.dumpState()),
      wave: this.wave,
    };
  }

  /**
   * 单个 `Born` 刷满并清空后的回调（由 `Born.onOver` 触发）。
   *
   * 所有 `borns` 都刷满且清空 → 完成一波。
   */
  onBornOver(): void {
    if (this.isWaveComplete()) {
      this.completeWave();
    }
  }

  /** 一波完成的判据：所有 `Born` 均满足 `total >= config.total && count <= 0`。 */
  isWaveComplete(): boolean {
    const borns = this.borns;
    if (!borns || !borns.some((b) => b)) {
      return false;
    }
    return borns.every(
      (b) => !b || (typeof b.config.total === 'number' && b.total >= b.config.total && b.count <= 0),
    );
  }

  /**
   * 完成一波：波数 +1，重置全部刷怪器，并在每 {@link WORLD_BOSS_WAVE_INTERVAL} 波尝试刷新守关 BOSS。
   *
   * 全程由注入的 `Clock` 驱动（重置只重新武装定时器），不使用 `Date.now()`。
   */
  completeWave(): void {
    this.wave += 1;
    for (const born of this.borns ?? []) {
      born?.reset();
    }
    if (this.wave % WORLD_BOSS_WAVE_INTERVAL === 0) {
      this.trySpawnWorldBoss();
    }
  }

  /**
   * 尝试刷新该图守关 BOSS（每 20 波）。
   *
   * - 一次性：角色已击杀该图 BOSS → 不再刷新（普通怪照旧，图仍可 farm）；
   * - 同一时刻只允许一只 BOSS 存活（上一只未死则本次跳过）；
   * - 等级 = 地图等级 + {@link WORLD_BOSS_LEVEL_OFFSET}；显式 `worldBoss` 标记该单位。
   */
  trySpawnWorldBoss(): void {
    const mapData = this.mapData;
    const bossKey = mapData?.boss;
    if (!bossKey || !this.world.tables.enemies[bossKey]) {
      return;
    }
    // W6：混沌图的守关 BOSS **可重复刷**（每次 run 第 20 波起都会再出），
    // 因此**跳过**「已击杀」一次性判据；野外图保持一次性语义。
    if (!isChaosMap(mapData) && this.world.player?.hasWorldBossKilled?.(this.map)) {
      return;
    }
    if (this.world.units.some((u) => u instanceof EnemyUnit && u.worldBoss)) {
      return;
    }
    const unit = this.world.addEnemy(bossKey, null, 0);
    unit.worldBoss = true;
    const mapLevel =
      typeof mapData?.level === 'number' && Number.isFinite(mapData.level) ? mapData.level : 0;
    unit.levelOverride = mapLevel + WORLD_BOSS_LEVEL_OFFSET;
  }

  onPlayerDeath(): void {
    // 原版基类为空实现。
  }
}
