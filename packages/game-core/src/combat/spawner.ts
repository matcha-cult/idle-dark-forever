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
import type { BattleWorld } from './battle-world.js';
import { EnemyUnit } from './enemy-unit.js';

/**
 * 野外守关 BOSS 的节拍基数（W4 / W11）：**每 20 波**。
 *
 * ⚠️ W11 起不再用 `wave % 20 === 0` 当闸门 —— 那个写法在**会话恢复**后必然错过窗口
 * （恢复到第 20 波时 `wave 21 % 20 !== 0`，要一直等到第 40 波才再出；实测见
 * `ai-script/explore/check-boss-respawn.mjs`）。现在改用「目标波 + 已交付记录」的幂等判据，
 * 见 {@link EnemyBorn.ensureMilestones}。
 *
 * 语义分两态（野外图）：
 * - **开荒**（`bossPending === true`）：第 {@link ELITE_WAVE_INTERVAL} 波精英、第 20 波守关 BOSS，各一次；
 * - **挂机**（野外图已通关）：不再出 BOSS，改为每 {@link ELITE_WAVE_INTERVAL} 波一只精英；
 * - **混沌图**：维持 W6 行为（每 20 波 BOSS、可重复刷、**不出精英**）。
 */
export const WORLD_BOSS_WAVE_INTERVAL = 20;

/** 精英节拍（W11）：每完成这么多波出一只。开荒期只有第 10 波那一只。 */
export const ELITE_WAVE_INTERVAL = 10;

/**
 * 精英的敌人品质（W11）：`quality = 2` ⇒ 两条词缀 + `maxHp` / `exp` ×4。
 *
 * ⚠️ **不要**改成 1：`quality 1` 就是自然刷怪 9% 概率掷到的「稀有」档，精英会因此
 * 完全无法与普通稀有怪区分（那正是「四阶稀有度」要解决的问题）。
 */
export const ELITE_QUALITY = 2;

/** 相对地图等级的加成（W4 / W11：普通 +0 / 稀有 +1 / 精英 +2 / BOSS +2）。 */
export const WORLD_BOSS_LEVEL_OFFSET = 2;

/** 存档里的波数归一：非有限 / 非正 / 非数字一律 0（脏存档防御）。 */
function waveOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

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

  /**
   * 本图当前存活的**敌对怪物**数量（W12）。
   *
   * 计入：野怪、守关 BOSS、BOSS 的召唤物（`camp` 为 `enemy` / `neutral`）。
   * 不计入：玩家 / 联军召唤物（`player` / `alien`）、`ghost`（尸体）、`shrine` / `story`。
   *
   * ⚠️ 自然刷新的闸门用它而**不是** `this.count`：`count` 只统计本刷怪器刷出的单位，
   * 无法感知「BOSS 召唤物把总量推过上限」的情况；上限口径是**全图怪物总数（含 BOSS）**。
   */
  aliveMonsterCount(): number {
    let count = 0;
    for (const unit of this.world.units) {
      if (!(unit instanceof EnemyUnit)) continue;
      if (unit.camp === 'enemy' || unit.camp === 'neutral') count += 1;
    }
    return count;
  }

  /**
   * 是否已达到**本图**同时存活上限（达到后暂停自然刷新，等有怪死亡再恢复）。
   *
   * ⚠️ 与 `world.atUnitCap()`（**全局单位硬顶**，I2）不是一回事：本函数只看
   * `config.max`，而 BOSS / 技能召唤物可以把它推过 `max`；全局硬顶是最后一道保险。
   */
  atMonsterCap(): boolean {
    const max = this.config.max;
    return typeof max === 'number' && max > 0 && this.aliveMonsterCount() >= max;
  }

  setTimer(startup: boolean | number = false): void {
    // 只按「本波是否刷满」判定是否还要继续：是否达到存活上限由 `onTimer` 再判
    //（这样被上限挡住时仍会周期复查，怪死后自动恢复刷新，不会永久停刷）。
    if (this.config.total && this.total >= this.config.total) {
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
    if (this.config.total && this.total >= this.config.total) {
      return;
    }
    // W12（产品拍板）：**守关 BOSS 在场时不刷杂兵** —— BOSS 战不再掺杂兵。
    // 口径是「存在」：`hasWorldBossUnit()` 连已死亡但尚未清尸的 `ghost` 也算在场，
    // 因此 BOSS 死后要等清尸（默认 3s）才恢复刷怪。⚠️ world.11 的 BOSS 因
    // `simba.goodFriends` 可能延后清尸（见 `BattleWorld.hasWorldBossUnit` 的尾巴说明）。
    // 与下面两条一样**保持轮询**：BOSS 一旦离场就自动恢复，不需要任何人重置状态。
    //
    // W12：全图怪物总数（含 BOSS 与召唤物）达到上限 → 暂停自然刷新。
    // 保持定时轮询，因此召唤物 / 杂兵死亡后会自动恢复刷新，不会永久停刷。
    //
    // 此外还要查**全局单位硬顶**（I2）：`addEnemy` 在超顶时会**拒绝注册**，
    // 而本函数在其后会 `count += 1 / total += 1` —— 若不在**调用前**拦住，
    // 记账会失真、该波永远无法判定完成。这里的提前 return 让刷新推迟而**不是丢失**。
    if (this.world.hasWorldBossUnit() || this.atMonsterCap() || this.world.atUnitCap()) {
      this.setTimer();
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

  /**
   * 最近一次**已交付**的精英波 / BOSS 波（W11 里程碑幂等，随会话落库）。
   *
   * 为什么要记「已交付」而不是继续用 `wave % N === 0`：
   * 1. **会话恢复**（刷新 / 断线重连 / 空闲回收）会把 `wave` 恢复到中间值，取模必然错过窗口
   *    —— 旧实现实测「恢复到第 20 波后首次再出 BOSS = 第 40 波」（R3）；
   * 2. 交付失败（全局单位硬顶 I2）时**不记录**，下一波自动重试，不会永久丢失；
   * 3. 开荒 → 挂机切换时，两者共用同一套判据，不会各自漂移。
   */
  lastEliteWave = 0;
  lastBossWave = 0;

  constructor(
    world: BattleWorld,
    clock: Clock,
    map: string,
    savedState?: {
      borns?: BornSavedState[];
      wave?: number;
      lastEliteWave?: number;
      lastBossWave?: number;
    } | null,
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
    this.wave = waveOf(savedState?.wave);
    if (savedState !== undefined && savedState !== null) {
      // 里程碑恢复：**不能**晚于 `wave`（脏存档防御），且只在 > 0 时采纳。
      const elite = waveOf(savedState.lastEliteWave);
      const boss = waveOf(savedState.lastBossWave);
      this.lastEliteWave = elite <= this.wave ? elite : 0;
      this.lastBossWave = boss <= this.wave ? boss : 0;
    }
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
      lastEliteWave: this.lastEliteWave,
      lastBossWave: this.lastBossWave,
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
   * 完成一波：波数 +1，重置全部刷怪器，然后**幂等地交付本波窗口的里程碑**。
   *
   * 全程由注入的 `Clock` 驱动（重置只重新武装定时器），不使用 `Date.now()`。
   */
  completeWave(): void {
    this.wave += 1;
    for (const born of this.borns ?? []) {
      born?.reset();
    }
    this.ensureMilestones();
  }

  // ────────────────────────────── 里程碑（W11） ──────────────────────────────

  /** 本图刷怪池（取第一条加权 `types`；退化为单一 `type`）。无刷怪池 → `null`。 */
  private spawnTypes(): Record<string, number> | null {
    const monsters = this.mapData?.monsters;
    if (!Array.isArray(monsters) || monsters.length === 0) {
      return null;
    }
    for (const config of monsters) {
      if (!config) continue;
      const types = config.types;
      if (types && Object.keys(types).length > 0) {
        return types;
      }
      if (typeof config.type === 'string' && config.type !== '') {
        return { [config.type]: 1 };
      }
    }
    return null;
  }

  /**
   * 精英的**目标交付波**（`null` = 本图不刷精英）。
   *
   * - 混沌图：`null`（维持 W6：只出 BOSS）；
   * - 开荒（`bossPending === true`）：固定第 {@link ELITE_WAVE_INTERVAL} 波，**只此一次**；
   * - 挂机（已通关）：每 {@link ELITE_WAVE_INTERVAL} 波一只，即取当前 10 波窗口的起点。
   */
  eliteWaveTarget(): number | null {
    if (this.world.isChaosMap) return null;
    if (this.spawnTypes() === null) return null;
    if (this.world.bossPending) return ELITE_WAVE_INTERVAL;
    return Math.max(
      ELITE_WAVE_INTERVAL,
      Math.floor(this.wave / ELITE_WAVE_INTERVAL) * ELITE_WAVE_INTERVAL,
    );
  }

  /**
   * 守关 BOSS 的**目标交付波**（`null` = 本图不再出 BOSS）。
   *
   * - 混沌图：每 {@link WORLD_BOSS_WAVE_INTERVAL} 波（当前窗口起点），可重复刷；
   * - 开荒：固定第 {@link WORLD_BOSS_WAVE_INTERVAL} 波；
   * - 挂机（已通关）：`null` —— 这与 `BattleWorld.bossPending === false` 同源，
   *   所以 UI 的「距守关 BOSS N 波」不会给出一个永远不来的倒计时。
   */
  bossWaveTarget(): number | null {
    if (this.world.isChaosMap) {
      return Math.max(
        WORLD_BOSS_WAVE_INTERVAL,
        Math.floor(this.wave / WORLD_BOSS_WAVE_INTERVAL) * WORLD_BOSS_WAVE_INTERVAL,
      );
    }
    return this.world.bossPending ? WORLD_BOSS_WAVE_INTERVAL : null;
  }

  /** 场上是否已有存活的精英（避免恢复 / 连刷时出现两只）。 */
  hasLiveElite(): boolean {
    return this.world.units.some((u) => u instanceof EnemyUnit && u.elite);
  }

  /**
   * **幂等地**交付当前波窗口的里程碑（精英 + 守关 BOSS）。
   *
   * `completeWave()` 与会话恢复（`WorldService.start` → `buildBattleWorld` 之后）都调用它，
   * 因此「恢复到第 20 波」也能立刻补刷 —— 这正是 R3 的结构性修法：
   * **不再可能出现「UI 说 BOSS 还会出、但要等到第 40 波」**。
   *
   * 幂等靠 `lastEliteWave` / `lastBossWave`：`wave >= 目标 && 未交付过` 才刷，交付成功才记录。
   * 交付被全局单位硬顶（I2）挡住时不记录 ⇒ 下一波自动重试，**不会永久丢失**。
   */
  ensureMilestones(): void {
    const eliteTarget = this.eliteWaveTarget();
    if (
      eliteTarget !== null &&
      this.wave >= eliteTarget &&
      this.lastEliteWave !== eliteTarget &&
      !this.hasLiveElite()
    ) {
      if (this.spawnElite()) {
        this.lastEliteWave = eliteTarget;
      }
    }
    const bossTarget = this.bossWaveTarget();
    if (bossTarget !== null && this.wave >= bossTarget) {
      if (this.world.isChaosMap) {
        // 混沌图：可重复刷 ⇒ 必须按**窗口**记「已交付」，否则杀掉后会每一波都重刷。
        if (this.lastBossWave !== bossTarget) {
          if (this.trySpawnWorldBoss()) {
            this.lastBossWave = bossTarget;
          }
        }
      } else {
        // 野外图：**一次性**，且判据不能只看 `lastBossWave` ——
        // 会话恢复会丢掉「已刷出但尚未击杀」的 BOSS 单位（R3），此时
        // `bossPending` 仍为 true、场上却没有 BOSS，必须**立刻补刷**。
        // 所以这里只用 `trySpawnWorldBoss()` 自身的闸门：
        // 已击杀 → `bossPending === false` 永不再刷；场上已有 → 不重复刷。
        // 若再叠一层 `lastBossWave !== bossTarget`，就会把 R3 从「等到第 40 波」
        // 变成「永远不再出」—— 比原缺陷更糟。
        if (this.trySpawnWorldBoss()) {
          this.lastBossWave = bossTarget;
        }
      }
    }
  }

  /**
   * 刷新一只**精英**（W11 / 决策 3）：强制 `quality = {@link ELITE_QUALITY}` 的普通怪。
   *
   * 为什么复用 `addEnemy(..., quality)` 而不是新造字段与倍率：
   * `quality` 现成就有完整链路 —— `maxHp *= 2 ** quality`、`exp *= 2 ** quality`、
   * `displayName` 会拼上两条词缀名（可见）、`applyOpenWorldLevelOverride` 给 +2 级、
   * 稀有度第 2 档（`enemyRarityOf`）。**不新增随机源、不新增等级公式、不新增数据字段**。
   *
   * 刷出位置与普通怪一致（`borner = null` ⇒ 不推进波次计数，与守关 BOSS 同处理）。
   *
   * @returns 是否真的刷出。`false` = 本图没有刷怪池 / 池里全是未知敌人 / 已达全局单位硬顶。
   */
  spawnElite(): boolean {
    const types = this.spawnTypes();
    if (types === null) return false;
    // I2：全图单位已达硬顶 → 本次不刷（调用方不记录里程碑，下一波重试）。
    if (this.world.atUnitCap()) return false;
    const key = randomType(types, this.world.rng.spawn);
    if (!this.world.tables.enemies[key]) return false;
    const unit = this.world.addEnemy(key, null, ELITE_QUALITY);
    unit.elite = true;
    return true;
  }

  /**
   * 尝试刷新该图守关 BOSS。
   *
   * - 一次性：角色已击杀该图 BOSS → 不再刷新（普通怪照旧，图仍可 farm）；
   * - 同一时刻只允许一只 BOSS 存活（上一只未死则本次跳过）；
   * - 等级 = 地图等级 + {@link WORLD_BOSS_LEVEL_OFFSET}；显式 `worldBoss` 标记该单位。
   *
   * ⚠️ 「还会不会出」的判据是 `BattleWorld.bossPending`（**唯一真相**，UI 读同一个 getter）：
   * 混沌图可重复刷、野外图一次性、无 `boss` 数据的图根本不刷。
   *
   * @returns 是否真的刷出（供 {@link ensureMilestones} 决定要不要记 `lastBossWave`）。
   */
  trySpawnWorldBoss(): boolean {
    const mapData = this.mapData;
    const bossKey = mapData?.boss;
    if (!bossKey || !this.world.tables.enemies[bossKey]) {
      return false;
    }
    if (!this.world.bossPending) {
      return false;
    }
    if (this.world.hasWorldBossUnit()) {
      return false;
    }
    // I2：全图单位已达硬顶 → 本次不刷 BOSS（下一波还会再试，不会永久丢失）。
    if (this.world.atUnitCap()) {
      return false;
    }
    const unit = this.world.addEnemy(bossKey, null, 0);
    unit.worldBoss = true;
    const mapLevel =
      typeof mapData?.level === 'number' && Number.isFinite(mapData.level) ? mapData.level : 0;
    unit.levelOverride = mapLevel + WORLD_BOSS_LEVEL_OFFSET;
    return true;
  }

  onPlayerDeath(): void {
    // 原版基类为空实现。
  }
}
