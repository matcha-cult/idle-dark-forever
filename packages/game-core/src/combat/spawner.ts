/**
 * 刷怪与副本阶段（原版 `src/logics/EnemyBorn.js`，303 行）。
 *
 * ## 去 MobX
 *
 * 原版 `DungeonState` 用一个 `autorun` 监听「`phaseBorn` 是否全部结束（`over`）」以推进阶段：
 *
 * ```js
 * this.autoDispose = autorun(() => {
 *   const { phaseBorn, disposed } = this;
 *   if (!disposed && phaseBorn && phaseBorn.every(v => !v || !v.config.total || v.over)) {
 *     this.switchToPhase(this.currentPhase + 1);
 *   }
 * });
 * ```
 *
 * 移植后改为显式：每个 `Born` 在 `over` 置位时回调 `onOver()`，`DungeonState` 用它触发
 * `checkPhaseAdvance()`。触发点只有一个（`Born.onEnemyKilled`），不会漏。
 *
 * 随机：`randomType` 的加权抽取、`setTimer` 的随机延迟、quality 抽取全部经
 * `world.rng.spawn`；时间全部来自注入的 `Clock`。
 */

import type { Clock, Rng, TimerHandle } from '../contracts/ports.js';
import type { MapData, MonsterSpawnConfig } from '../contracts/data.js';
import type { BattleWorld } from './battle-world.js';
import { transformEquipLevel } from './util.js';

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

  /** 显式替代 `DungeonState` 的 autorun：`over` 置位时通知阶段控制器。 */
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
      this.setTimer(savedState.timer ?? 0);
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
  /** 地城阶段的刷怪器（`EnemyUnit.dumpState` 需要按它反查索引）。 */
  phaseBorn: Array<Born | null> | null = null;

  constructor(world: BattleWorld, clock: Clock, map: string, savedState?: { borns?: BornSavedState[] } | null) {
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
    };
  }

  onPlayerDeath(): void {
    // 原版基类为空实现。
  }
}

export interface DungeonSavedState {
  borns?: BornSavedState[];
  phaseBorn?: BornSavedState[];
  currentPhase?: number | null;
}

export class DungeonState extends EnemyBorn {
  currentPhase: number | null = 0;
  disposed = false;

  constructor(world: BattleWorld, clock: Clock, map: string, savedState?: DungeonSavedState | null) {
    super(world, clock, map, savedState);
    this.switchToPhase(
      savedState ? (savedState.currentPhase ?? 0) : 0,
      savedState && savedState.phaseBorn,
    );
  }

  get phaseData(): NonNullable<MapData['phases']>[number] | undefined {
    return this.mapData?.phases?.[this.currentPhase ?? 0];
  }

  /** 替代原版 `autorun`：阶段内全部刷怪器结束（或无 total）时推进到下一阶段。 */
  checkPhaseAdvance(): void {
    if (this.disposed) {
      return;
    }
    const { phaseBorn } = this;
    if (phaseBorn && phaseBorn.every((v) => !v || !v.config.total || v.over)) {
      this.switchToPhase((this.currentPhase ?? 0) + 1);
    }
  }

  switchToPhase(phase: number, phaseBorn?: Array<BornSavedState | null> | null): void {
    this.currentPhase = phase;
    if (this.phaseBorn) {
      this.phaseBorn.forEach((v) => v?.dispose());
      this.phaseBorn = null;
    }

    const phaseData = this.phaseData;
    if (!phaseData) {
      // I'm over!
      const player = this.world.player;
      const ticketType = this.world.endlessLevel
        ? 'nightmare.' + this.world.endlessLevel
        : this.mapData?.group || this.map;

      const ticketCount = player?.countTicket?.(ticketType) ?? 0;

      if (ticketCount > 0) {
        this.world.sink.general({
          text: `dungeon.clear:${this.mapData?.name ?? this.map}`,
        });
        const { exp = 0, level = 0, loots } = this.mapData ?? {};
        this.world.gotExp(
          exp * (this.world.endlessLevel ? Math.pow(1.5, this.world.endlessLevel) : 1),
          transformEquipLevel(level),
        );
        this.world.loots(loots ?? [], level, 0);
        this.world.lootEndless();
        player?.costTicket?.(ticketType);
      } else {
        this.world.sink.general({
          text: `dungeon.noTicket:${this.mapData?.name ?? this.map}`,
        });
      }
      this.currentPhase = null;
      if (this.world.pendingMaps.length > 0) {
        const [map, lvl] = this.world.pendingMaps.shift()!;
        this.world.enterPendingMap(map, lvl);
      } else {
        this.world.map = this.mapData?.outside || 'home';
      }
      return;
    }
    this.phaseBorn = phaseData.monsters
      ? phaseData.monsters.map(
          (config, i) =>
            new Born(
              this.world,
              this.clock,
              config as MonsterSpawnConfig,
              phaseBorn && phaseBorn[i],
            ),
        )
      : null;
    // 显式接线：任一刷怪器 over → 尝试推进阶段（原版 autorun）。
    this.phaseBorn?.forEach((b) => {
      if (b) {
        b.onOver = () => this.checkPhaseAdvance();
      }
    });
  }

  override dispose(): void {
    this.disposed = true;
    if (this.borns) {
      this.borns.forEach((v) => v?.dispose());
    }
    if (this.phaseBorn) {
      this.phaseBorn.forEach((v) => v?.dispose());
    }
  }

  override dumpState(): Record<string, unknown> {
    const ret = super.dumpState();
    ret.phaseBorn = this.phaseBorn && this.phaseBorn.map((v) => v && v.dumpState());
    ret.currentPhase = this.currentPhase;
    return ret;
  }

  override onPlayerDeath(): void {
    // Failed!
    this.world.sink.general({ text: `dungeon.failed:${this.mapData?.name ?? this.map}` });
    this.currentPhase = null;
    if (this.world.pendingMaps.length > 0) {
      const [map, lvl] = this.world.pendingMaps.shift()!;
      this.world.enterPendingMap(map, lvl);
    } else {
      this.world.map = this.mapData?.outside || 'home';
    }
  }
}
