/**
 * 战斗世界（原版 `src/logics/world.js` 的战斗部分 + `unit.js` 的全局单例依赖）。
 *
 * ## 从单例世界到显式依赖
 *
 * 原版 `world` 是模块级单例，`unit.js` / `EnemyBorn.js` 直接 `import world from './world'`，
 * 并且与 `player.js` / `game.js` 形成循环引用。移植后这些依赖全部变成构造器注入：
 * `BattleWorld` 持有 `Clock` / `Rng` / `BattleSink` / `DataTables`，单位只持有 `world` 引用。
 *
 * ## 伤害管线（`sendDamage`，原版 `world.js` 第 406–451 行，顺序不可变）
 *
 * ```
 * ① to.shieldReflect（有值 → 对 from 递归结算；递归里 from === to，天然终止）
 * ② from.willDamage → to.willDamaged
 * ③ absorbed = value * to[`${type}Absorb`]
 * ④ melee → (value-absorbed)/(1+to.def/200)；其它系 → /(1+to[`${type}Resist`]/200)
 * ⑤ to.absorbed（护盾）→ to.damaged → sink.damage → to.damage()
 * ```
 *
 * ## 随机
 *
 * 根 `Rng` 只在构造时 `fork` 出若干**稳定标签**的独立子序列并长期持有
 * （`Mulberry32Rng.fork` 不推进父状态，因此不能每次现 fork——那样会反复得到同一序列）。
 * 子序列标签：`target` / `crit` / `dodge` / `stun` / `break` / `affix` / `spawn` / `loot`。
 *
 * ## 时间
 *
 * 不再有 `Date.now()`：世界时钟由构造器注入；`logicClock` 是它的一级子时钟
 * （原版 `world.timeline` → `world.logicTimeline` 的两级结构）。
 */

import type { BattleSink, Clock, Logger, Rng, TimerHandle } from '../contracts/ports.js';
import type { DataTables, LootEntry, MapData } from '../contracts/data.js';
import { Timeline } from '../sim/index.js';
import { lootRuleActionOf } from '../rules/loot-rule.js';
import { Camps } from './camps.js';
import { EnemyBorn, DungeonState, type Born, type BornSavedState, type DungeonSavedState } from './spawner.js';
import { EnemyUnit } from './enemy-unit.js';
import { PlayerUnit, type PlayerLike } from './player-unit.js';
import { SkillState } from './skill-state.js';
import { BuffState } from './buff-state.js';
import { Unit } from './unit.js';
import { camelCase, readAttr, toNumber, untransformEquipLevel } from './util.js';

/** 各用途独立的随机子序列（标签稳定，便于审计/复算）。 */
export interface CombatRngStreams {
  target: Rng;
  crit: Rng;
  dodge: Rng;
  stun: Rng;
  break: Rng;
  affix: Rng;
  spawn: Rng;
  loot: Rng;
  /**
   * 数据表里的技能 / Buff / 强化 hook 专用通道。
   *
   * 原版这些 hook 内部直接调用 `Math.random()`（`data/skills.ts` 47 处等），无法重放；
   * 而契约的 hook 签名**不带 `rng` 形参**。因此改为：hook 收到的 `world` 参数上暴露本通道
   * —— `world.rng.skill.next()`。
   *
   * 独立成通道是必须的：复用 `crit` / `loot` 等通道会让战斗判定与技能随机的序列互相扰动，
   * 破坏金样回归的可解释性与可复算性。
   */
  skill: Rng;
}

/** 掉落物槽位（原版 `InventorySlot` 在战斗侧需要的最小投影）。 */
export interface LootSlot {
  key: string | null;
  count: number;
  quality?: number;
  dungeonKey?: string;
  price?: number;
  kind?: 'loot' | 'build';
  handled?: 'pickup' | 'sell' | 'decompose';
}

/**
 * 装备掉落生成端口。
 *
 * 原版这些函数在 `src/logics/goods.js`（`randomEquip` / `generateEquip` /
 * `getDecomposeMatrials`），属于 `rules/` 域。为让 combat 不依赖尚未就绪的
 * `rules/`，这里以端口注入；未注入时 `equip` / `specialEquip` 条目会被跳过并告警。
 */
export interface LootService {
  randomEquip(level: number, mfRate: number, position?: string): LootSlot;
  generateEquip(kind: string, level: number, quality: number, legend?: string): LootSlot;
  getDecomposeMaterials(slot: LootSlot): Record<string, number>;
}

/** 原版 `game.endlessTicketRate`（`game.js`，不在本任务范围内）。 */
const DEFAULT_ENDLESS_TICKET_RATE = 0;

export interface WorldStateLike {
  map?: string;
  endlessLevel?: number;
  pendingMaps?: Array<string | [string, number]>;
  enemyBorn?: unknown;
  units?: Array<Record<string, unknown> & { type?: string; unit?: Unit }>;
}

export interface BattleWorldOptions {
  /** 世界时钟（原版 `world.timeline`）。 */
  clock: Clock;
  tables: DataTables;
  rng: Rng;
  sink: BattleSink;
  logger?: Logger;
  player?: PlayerLike | null;
  map?: string;
  endlessLevel?: number;
  /** 离线快进倍率（原版 `world.updateRate`，作用于经验与掉落数量）。 */
  updateRate?: number;
  lootService?: LootService;
  /** 原版 `game.medicineLevel.get(type)`。 */
  medicineLevel?: (type: string) => number;
  /** 原版 `game.onEnemyKilled(type, count, role)`。 */
  onEnemyKilled?: (type: string, count: number, role?: string) => void;
  /** 原版 `game.endlessTicketRate`。 */
  endlessTicketRate?: number;
}

/**
 * 显式技能调度队列（替代 MobX `reaction(this.canUseSkill, this.tryUseSkill)`）。
 *
 * 语义见 `Unit.evaluateSkills()` 的对照注释：入队只表示「可能发生了变化」，
 * 真正的引用比较与门槛判定都发生在 `Unit.evaluateSkills()` 内，因此重复入队安全。
 * 用 `setTimeout(…, 0)` 保证同一虚拟时刻内消费，不引入可观测的战斗时序漂移。
 */
export class SkillScheduler {
  private readonly clock: Clock;
  private readonly queue = new Set<Unit>();
  private handle: TimerHandle | null = null;
  private disposed = false;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  enqueue(unit: Unit): void {
    if (this.disposed) {
      return;
    }
    this.queue.add(unit);
    if (!this.handle) {
      this.handle = this.clock.setTimeout(this.flush, 0);
    }
  }

  flush = (): void => {
    this.handle = null;
    if (this.disposed) {
      return;
    }
    const units = Array.from(this.queue);
    this.queue.clear();
    for (const unit of units) {
      unit.evaluateSkills();
    }
  };

  get pending(): number {
    return this.queue.size;
  }

  dispose(): void {
    this.disposed = true;
    this.queue.clear();
    if (this.handle) {
      this.clock.clearTimeout(this.handle);
      this.handle = null;
    }
  }
}

export class BattleWorld {
  readonly clock: Clock;
  readonly logicClock: Clock;
  readonly tables: DataTables;
  readonly rng: CombatRngStreams;
  readonly sink: BattleSink;
  readonly logger: Logger;
  readonly scheduler: SkillScheduler;

  units: Unit[] = [];
  player: PlayerLike | null = null;
  playerUnit: PlayerUnit | null = null;

  enemyBorn: EnemyBorn | null = null;

  updateRate = 1;
  endlessLevel = 0;

  pendingMaps: Array<[string, number]> = [];

  /** 原版 `world._map`。 */
  private _map = 'home';

  private readonly lootService: LootService | null;
  private readonly medicineLevel: (type: string) => number;
  private readonly onEnemyKilledHook: (type: string, count: number, role?: string) => void;
  readonly endlessTicketRate: number;

  private disposed = false;

  /** 世界内单位 id 序列（替代原版模块级 `keyGenerator`，见 `Unit` 构造器注释）。 */
  private unitKeySeq = 0;

  nextUnitKey(): number {
    return (this.unitKeySeq += 1);
  }

  constructor(options: BattleWorldOptions) {
    this.clock = options.clock;
    this.logicClock = new Timeline(options.clock);
    this.tables = options.tables;
    this.sink = options.sink;
    this.logger = options.logger ?? {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.scheduler = new SkillScheduler(this.logicClock);
    this.player = options.player ?? null;
    this._map = options.map ?? 'home';
    this.endlessLevel = options.endlessLevel ?? 0;
    this.updateRate = options.updateRate ?? 1;
    this.lootService = options.lootService ?? null;
    this.medicineLevel = options.medicineLevel ?? (() => 0);
    this.onEnemyKilledHook = options.onEnemyKilled ?? (() => {});
    this.endlessTicketRate = options.endlessTicketRate ?? DEFAULT_ENDLESS_TICKET_RATE;

    const root = options.rng;
    this.rng = {
      target: root.fork('target'),
      crit: root.fork('crit'),
      dodge: root.fork('dodge'),
      stun: root.fork('stun'),
      break: root.fork('break'),
      affix: root.fork('affix'),
      spawn: root.fork('spawn'),
      loot: root.fork('loot'),
      skill: root.fork('skill'),
    };
  }

  // ────────────────────────────── 地图 ──────────────────────────────

  get map(): string {
    return this._map;
  }

  set map(map: string) {
    this._map = map;
    this.endlessLevel = 0;
    this.onMapChanged();
  }

  get mapData(): MapData | undefined {
    return this.tables.maps[this._map];
  }

  /**
   * 切到 `pendingMaps` 里的下一张图（原版在 `EnemyBorn` 里直接写
   * `world._map` / `world._endlessLevel` 再手动 `onMapChanged()`）。
   * 这里收敛成世界自己的方法，避免外部改私有字段。
   */
  enterPendingMap(map: string, level: number): void {
    this._map = map;
    this.endlessLevel = level;
    this.onMapChanged();
  }

  getMedicineLevel(type: string): number {
    return this.medicineLevel(type);
  }

  onEnemyKilled(type: string, count: number): void {
    this.onEnemyKilledHook(type, count, this.player?.careerData?.key);
  }

  // ────────────────────────────── 单位表 ──────────────────────────────

  addUnit(unit: Unit, randomPosition?: boolean): void {
    if (randomPosition) {
      const pos = this.rng.spawn.int(this.units.length + 1);
      this.units.splice(pos, 0, unit);
    } else {
      this.units.push(unit);
    }
    unit.runAttrHooks(null, 'appeared');
  }

  /**
   * 「第一次施法机会」的显式入口（原版在 `world.load` / `world.addEnemy` 末尾调用
   * `unit.tryUseSkill(unit.canUseSkill())`）。同时记录 `lastSkillTrigger`，使后续
   * 显式调度沿用 MobX reaction 的引用比较语义。
   */
  activateUnit(unit: Unit): void {
    const skill = unit.canUseSkill();
    unit.lastSkillTrigger = skill;
    unit.tryUseSkill(skill);
  }

  addPlayer(player: PlayerLike, savedState?: ConstructorParameters<typeof PlayerUnit>[2]): PlayerUnit {
    this.player = this.player ?? player;
    const unit = new PlayerUnit(this, player, savedState ?? null);
    unit.initKeepAlives();
    this.playerUnit = unit;
    this.addUnit(unit);
    return unit;
  }

  addEnemy(
    type: string,
    borner: Born | null,
    quality = 0,
    summoner?: Unit | null,
    skillState?: SkillState | null,
  ): EnemyUnit {
    const unit = new EnemyUnit(this, type, quality);
    unit.initKeepAlives();
    unit.borner = borner;
    unit.summoner = summoner ?? null;
    unit.summonSkill = skillState ?? null;
    unit.hp = unit.maxHp;
    unit.mp = unit.maxMp;

    // 契约 `BattleSink` 没有 `enemyAppear`，用 `general` 事件承载（见交付报告差异清单）。
    this.sink.general({ text: `enemy.appear:${unit.displayName}` });
    this.addUnit(unit, !!borner?.config?.randomPosition);

    this.units.forEach((v) => {
      if (v.target === null && v.willAttack(unit)) {
        v.setTarget(unit);
      }
    });
    unit.findTarget();
    this.activateUnit(unit);
    return unit;
  }

  addEnemySaved(saved: Record<string, unknown> & { type?: string; quality?: number }): EnemyUnit {
    const unit = new EnemyUnit(this, saved.type ?? '', saved.quality ?? 0, saved as never);
    unit.initKeepAlives();
    this.addUnit(unit);
    return unit;
  }

  removeUnit(unit: Unit): void {
    const id = this.units.indexOf(unit);
    if (id < 0) {
      return;
    }
    this.units.splice(id, 1);
    unit.dispose();

    this.units.forEach((v) => {
      if (v.target === unit) {
        v.setTarget(null);
        v.findTarget();
      }
    });
  }

  /** 替代原版第三个 autorun：目标进入 ghost 后其它单位重新选目标。 */
  retargetAwayFrom(unit: Unit): void {
    for (const v of this.units) {
      if (v !== unit && v.target === unit) {
        v.findTarget();
      }
    }
  }

  onMapChanged(mapState?: { enemyBorn?: unknown }): void {
    // 改变敌人生成器
    if (this.enemyBorn) {
      this.enemyBorn.dispose();
      this.enemyBorn = null;
    }

    // 移除所有敌人（保留玩家及其召唤链）
    for (;;) {
      const willRemove = this.units.find((v) => {
        // 沿召唤链上溯：链上出现玩家单位则保留。
        // ⚠️ 原版 `for (; v; v = v.summoner)` 在召唤链成环时会**死循环**；
        // 这里加 visited 集合做环检测（见交付报告「语义差异清单」）。
        const visited = new Set<Unit>();
        for (let u: Unit | null = v; u; u = u.summoner ?? null) {
          if (visited.has(u)) {
            break;
          }
          visited.add(u);
          if (u === this.playerUnit) {
            return false;
          }
        }
        return true;
      });
      if (!willRemove) {
        break;
      }
      this.removeUnit(willRemove);
    }

    const md = this.mapData;
    this.sink.mapEnter(this._map, md?.name ?? this._map);

    if (md?.isDungeon) {
      this.enemyBorn = new DungeonState(
        this,
        this.logicClock,
        this._map,
        (mapState?.enemyBorn ?? null) as DungeonSavedState | null,
      );
    } else {
      this.enemyBorn = new EnemyBorn(
        this,
        this.logicClock,
        this._map,
        (mapState?.enemyBorn ?? null) as { borns?: BornSavedState[] } | null,
      );
    }
  }

  focusEnemy(target: EnemyUnit): void {
    if (target.enemyData && target.enemyData.onPress) {
      if (target.camp === Camps.ghost) {
        return;
      }
      if (!(target.enemyData.onPress.call(target, this) as unknown)) {
        return;
      }
    }
    this.units.forEach((v) => {
      if (v.camp === Camps.player && v.canAttack(target)) {
        v.setTarget(target);
      }
    });
  }

  // ────────────────────────────── 事件 ──────────────────────────────

  sendBuffState(unit: Unit, type: string, on: boolean): void {
    this.sink.buff({
      unitId: unit.id,
      buffKey: type,
      name: this.tables.buffs[type]?.name ?? type,
      on,
    });
  }

  sendBreakCasting(unit: Unit, casting: SkillState | BuffState): void {
    // 契约没有 breakCasting 事件；用 general 承载，保留可观测性（见差异清单）。
    const name = casting instanceof SkillState ? casting.skillData.name : casting.buffData.name;
    this.sink.general({ text: `breakCasting:${unit.displayName}:${name}` });
  }

  // ────────────────────────────── 伤害 / 治疗 / 经验 ──────────────────────────────

  testDodge(from: Unit | null, to: Unit, skill: SkillState | null): boolean {
    if (to.testDodge()) {
      this.sink.dodge({
        fromId: from ? from.id : '',
        toId: to.id,
        skill: skill ? skill.type : '',
      });
      return true;
    }
    return false;
  }

  sendDamage(
    damageType: string,
    from: Unit | null,
    to: Unit,
    skill: SkillState | null,
    v: number,
    isCrit: boolean,
  ): number {
    let value = v;
    let absorbed = 0;
    // ① 反射（`runAttrHooks(false, 'shieldReflect', damageType)`）
    const reflectRate = to.runAttrHooks(false as unknown as number, 'shieldReflect', damageType);
    if (from && from !== to && reflectRate) {
      if (this.testDodge(from, from, skill)) {
        return 0;
      }
      return this.sendDamage(damageType, from, from, skill, v * reflectRate, isCrit);
    }
    // ② 进攻方增伤 → 防守方减伤
    value = from ? from.runAttrHooks(value, 'willDamage', to, damageType) : value;
    value = to.runAttrHooks(value, 'willDamaged', from, damageType);

    // ③ 吸收百分比
    absorbed = value * (readAttr(to, camelCase(damageType + '-absorb')) || 0);

    // ④ 护甲 / 抗性
    switch (damageType) {
      case 'melee':
        value = (value - absorbed) / (1 + to.def / 200);
        break;
      default: {
        value =
          (value - absorbed) /
          (1 + (readAttr(to, camelCase(damageType + '-resist')) || 0) / 200);
        break;
      }
    }
    // ⑤ 护盾吸收量
    const realValue = to.runAttrHooks<number>(value, 'absorbed', damageType);
    absorbed += value - realValue;
    value = realValue;

    value = to.runAttrHooks<number>(value, 'damaged', from);
    // 原版 `message.sendDamage` 在 `!skill` 时直接 return（不发事件）。
    if (skill) {
      this.sink.damage({
        fromId: from ? from.id : '',
        toId: to.id,
        damageType,
        skill: skill.type,
        value,
        crit: isCrit,
        absorbed,
      });
    }
    to.damage(damageType, from, value);
    return value;
  }

  sendHeal(from: Unit | null, to: Unit, skill: SkillState | null, value: number): void {
    this.sink.heal({
      fromId: from ? from.id : '',
      toId: to.id,
      skill: skill ? skill.type : '',
      value,
    });
    to.hp += value;
  }

  gotExp(exp: number, level: number): void {
    const receivers = this.units.filter((v) => v.canGetExp);
    if (receivers.length > 0) {
      const avgexp = (exp * this.updateRate) / receivers.length;
      receivers.forEach((v) => v.gotExp(avgexp, level));
    }
  }

  // ────────────────────────────── 掉落 ──────────────────────────────

  /**
   * 拾取判定：**委托 `rules/loot-rule.ts` 的唯一定义**。
   *
   * 这里曾经自己读 `lootRule.get(class)` 再 `rule[quality]`，与面板侧写入的
   * `c:${class}:${quality}` 编码不匹配 → 永远返回 0，面板设置静默失效。
   * 不要再在本地复制判定逻辑。
   */
  getLootRule(clazz: string, quality: number, level: number): number {
    return lootRuleActionOf(this.player, clazz, quality, level);
  }

  lootGood(slot: LootSlot): void {
    this.sink.loot({
      key: slot.key ?? '',
      count: slot.count,
      quality: slot.quality ?? 0,
      handled: slot.handled ?? 'pickup',
      gold: slot.handled === 'sell' ? slot.count : undefined,
    });
    this.player?.loot?.(slot);
    if (slot.count === 0) {
      slot.key = null;
    }
  }

  lootGoods(slots: LootSlot[]): LootSlot[] {
    const ret: LootSlot[] = [];
    for (const slot of slots) {
      this.lootGood(slot);
      if (slot.key) {
        ret.push(slot);
      }
    }
    return ret;
  }

  loots(
    loots: LootEntry[],
    level: number,
    quality: number,
    _showToast = false,
    noUpdateRate = false,
  ): LootSlot[] | undefined {
    const slots: LootSlot[] = [];
    const qualityRate = 1 << quality;
    if (!this.player || !this.playerUnit) {
      return undefined;
    }
    const updateRate = noUpdateRate ? 1 : this.updateRate;

    if (this.endlessLevel) {
      level += 35 * (this.endlessLevel - 1);
    }

    for (const rawEntry of loots) {
      // 判别联合太窄，这里用宽松形状读取（原版就是解构 + 逐字段判断）。
      const entry = rawEntry as unknown as {
        key?: string;
        type?: string;
        count?: [number, number] | number;
        rate?: number;
        mfRate?: number;
        dungeons?: Record<string, number>;
        value?: number;
        position?: string;
        items?: string[];
      };
      const countSpec = entry.count;
      const [min, max] = Array.isArray(countSpec) ? countSpec : [0, 0];
      const rate = entry.rate ?? 0;
      const mfRate = entry.mfRate ?? 1;
      const count =
        entry.type === 'maxLevel' ? 1 : Math.ceil(rate * updateRate - this.rng.loot.next());
      for (let i = 0; i < count; i++) {
        if (entry.type === 'ticket') {
          if (entry.dungeons) {
            const keys = Object.keys(entry.dungeons);
            const totalWeight = keys.reduce((v, key) => v + entry.dungeons![key]!, 0);
            let dice = this.rng.loot.next() * totalWeight;
            const result = keys.find((key) => {
              const weight = entry.dungeons![key]!;
              if (dice < weight) {
                return true;
              }
              dice -= weight;
              return false;
            });
            slots.push({
              key: 'ticket',
              count: 1,
              quality: 0,
              dungeonKey: result,
              kind: 'loot',
              handled: 'pickup',
            });
          }
        } else if (entry.type === 'equip' || entry.type === 'specialEquip') {
          if (!this.lootService) {
            this.logger.warn('[combat] loots: equip entry skipped, no LootService injected', {
              level,
            });
            continue;
          }
          const minLevel = Math.max(1, Math.min(level - 15, level * 0.8));
          let eLevel = Math.ceil(minLevel + this.rng.loot.next() * (level - minLevel));
          let slot: LootSlot;

          if (entry.type === 'specialEquip') {
            eLevel = untransformEquipLevel(this.player.level);
            const items = entry.items ?? [];
            const legendType = items[this.rng.loot.int(items.length)];
            if (!legendType) {
              continue;
            }
            const legend = this.tables.legends[legendType];
            slot = this.lootService.generateEquip(
              legend?.type ?? legendType,
              eLevel,
              4,
              legendType,
            );
          } else {
            const mf = this.playerUnit ? this.playerUnit.mf : 1;
            slot = this.lootService.randomEquip(eLevel, mfRate * mf * qualityRate, entry.position);
          }
          const rule = this.getLootRule(
            (slot as unknown as { goodData?: { class?: string } }).goodData?.class ?? '',
            slot.quality ?? 0,
            level,
          );

          switch (rule) {
            case 1:
              slots.push({
                key: 'gold',
                count: slot.price ?? 0,
                quality: 0,
                kind: 'loot',
                handled: 'sell',
              });
              break;
            case 2: {
              const materials = this.lootService.getDecomposeMaterials(slot);
              for (const key of Object.keys(materials)) {
                slots.push({
                  key,
                  count: materials[key]!,
                  quality: 0,
                  kind: 'build',
                  handled: 'decompose',
                });
              }
              break;
            }
            case 0:
            default:
              slot.handled = 'pickup';
              slot.kind = 'loot';
              slots.push(slot);
              break;
          }
        } else if (entry.type === 'maxLevel') {
          // 最高等级提升。
          const value = entry.value ?? 0;
          if (this.player.maxLevel < value) {
            this.player.maxLevel = value;
            this.sink.general({ text: `maxLevel:${this.player.name}:${value}` });
          }
        } else if (entry.key) {
          let total = (this.rng.loot.next() * (max - min + 1) + min) * count;
          if (entry.key === 'gold') {
            total *= this.playerUnit.gf;
            total *= this.endlessLevel ? Math.pow(1.5, this.endlessLevel) : 1;
          }
          slots.push({
            key: entry.key,
            count: total | 0,
            quality: 0,
            kind: 'loot',
            handled: 'pickup',
          });
          i = count; // 避免多次发送
        }
      }
    }

    return this.lootGoods(slots);
  }

  lootEndless(_showToast = false): LootSlot[] | undefined {
    if (this.endlessLevel > 0) {
      if (this.rng.loot.next() < this.endlessTicketRate) {
        return this.lootGoods([
          {
            key: 'ticket',
            count: 1,
            quality: 0,
            dungeonKey: 'nightmare.' + (this.endlessLevel + 1),
            kind: 'loot',
            handled: 'pickup',
          },
        ]);
      }
    }
    return undefined;
  }

  // ────────────────────────────── 存档 ──────────────────────────────

  dumpState(): Record<string, unknown> {
    return {
      map: this._map,
      pendingMaps: this.pendingMaps.map((v) => [v[0], v[1]]),
      endlessLevel: this.endlessLevel,
      updateRate: this.updateRate,
      enemyBorn: this.enemyBorn ? this.enemyBorn.dumpState() : undefined,
      units: this.units.map((v) => v.dumpState()),
      // 定时器句柄不入快照；恢复时按剩余时间重新 setTimeout（见 load）。
    };
  }

  load(player: PlayerLike, worldState: WorldStateLike): void {
    this.player = player;
    this._map = worldState.map ?? 'home';
    this.endlessLevel = worldState.endlessLevel ?? 0;

    if (worldState.pendingMaps) {
      this.pendingMaps = worldState.pendingMaps.map((v) =>
        typeof v === 'string' ? [v, 0] : [v[0], v[1]],
      );
    }

    if (!this.tables.maps[this._map]) {
      this._map = 'home';
      this.endlessLevel = 0;
    }
    this.onMapChanged(worldState as { enemyBorn?: unknown });

    // 恢复对象
    if (worldState.units) {
      for (const unit of worldState.units) {
        if (unit.type === 'player') {
          unit.unit = this.addPlayer(player, unit as never);
        } else if (this.tables.enemies[unit.type ?? '']) {
          unit.unit = this.addEnemySaved(unit as never);
        }
      }

      // 恢复目标与召唤者（所有对象本身已恢复好之后）
      for (const unit of worldState.units) {
        const u = unit.unit;
        if (!u) {
          continue;
        }
        if (typeof unit.target === 'number' && unit.target >= 0) {
          const origin = worldState.units[unit.target];
          u.target = (origin && origin.unit) || null;
        }
        if (!u.target) {
          u.findTarget();
        }
        if (typeof unit.summoner === 'number') {
          const origin = worldState.units[unit.summoner];
          u.summoner = (origin && origin.unit) || null;
          if (u.summoner && typeof unit.summonSkill === 'number') {
            u.summonSkill = u.summoner.skills[unit.summonSkill] ?? null;
          }
        }

        // 重新给一遍 hp/mp，因为召唤物可能血量受主角影响。
        u.hp = toNumber(unit.hp, u.hp);
        u.mp = toNumber(unit.mp, u.mp);
        u.rp = toNumber(unit.rp, u.rp);
        u.ep = toNumber(unit.ep, u.ep);
      }
    }

    if (!this.playerUnit) {
      this.addPlayer(player);
    }

    for (const unit of this.units) {
      this.activateUnit(unit);
    }
  }

  dispose(): void {
    while (this.units.length > 0) {
      this.removeUnit(this.units[this.units.length - 1]!);
    }

    if (this.enemyBorn) {
      this.enemyBorn.dispose();
      this.enemyBorn = null;
    }

    this.scheduler.dispose();
    this.logger.debug('[combat] world disposed');
    this.disposed = true;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
