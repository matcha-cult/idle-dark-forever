/**
 * 单位基类（原版 `src/logics/unit.js` 的 `class Unit`，第 452–1071 行）。
 *
 * ## 去 MobX 的三处关键改写（方案 §7.1 / §7.2）
 *
 * 1. `reaction(this.canUseSkill, this.tryUseSkill)`（第 458 行）→ **显式调度队列**。
 *    见 `evaluateSkills()` / `scheduleSkillEvaluation()` 的对照注释。
 * 2. `autorun(() => this.timeline.setRate(this.speedRate))`（第 459 行）→
 *    `refreshSpeedRate()`：在所有「可能改变 `speedRate` 的点」显式调用
 *    （hook 增删、Buff 增删、装备/被动/强化重绑）。
 * 3. `autorun(() => { if (target && target.camp === ghost) findTarget(); })`（第 462–469 行）
 *    → 在 `kill()` 里显式 `world.retargetAwayFrom(this)`，并在 `setTarget` 里对 ghost 目标补一次 `findTarget()`。
 *
 * 属性系统仍然是 **hook 链**：`Map<hookKey, Map<id, fn>>` + 插入序执行（原版第 856–890 行）。
 */

import type { Clock, TimerHandle } from '../contracts/ports.js';
import type { AttrHook } from '../contracts/data.js';
import { Timeline } from '../sim/index.js';
import { Camps, type Camp, assistsCamp, canAttackCamp, hatesCamp } from './camps.js';
import type { BattleWorld } from './battle-world.js';
import { BuffState } from './buff-state.js';
import { SkillState } from './skill-state.js';
import { camelCase, clampResource } from './util.js';

export type ResourceKey = 'hp' | 'mp' | 'rp' | 'ep' | 'comboPoint';

const RECOVERY_RATE = 0.5;

let keyGenerator = 0;

/**
 * 原版 `addAttrHook` 用的全局 id 生成器（第 862–871 行）。
 * 跨单位共享，保证同一单位内 id 唯一即可；这里逐行照抄（含 10 万回绕）。
 */
let globalCounter = 0;

export interface UnitSavedState {
  camp?: Camp;
  hp?: number;
  mp?: number;
  rp?: number;
  ep?: number;
  target?: number;
  skills?: Record<string, { coolDown?: number } | undefined>;
  buffs?: Array<{ type: string; time?: number; arg?: unknown; group?: string | null } | undefined>;
  casting?: number;
  castingTimer?: number;
  reading?: number;
  [k: string]: unknown;
}

export class Unit {
  readonly world: BattleWorld;
  /** 原版 `this.timeline`（单位自身时钟，受攻速缩放）。 */
  readonly clock: Clock;
  /** 原版 `this.timeline.parent`（世界逻辑时钟）。 */
  readonly logicClock: Clock;

  key: number;

  private _hp = 0;
  private _mp = 0;
  private _rp = 0;
  private _ep = 0;
  comboPoint = 0;

  // 阵营
  camp: Camp = Camps.ghost;

  // 攻击目标
  target: Unit | null = null;

  /** 召唤者（原版 `Unit` 基类即可空字段，`EnemyUnit` 会写入）。 */
  summoner: Unit | null = null;
  /** 召唤来源技能（用于 `SkillState.dispose` 连带击杀）。 */
  summonSkill: SkillState | null = null;

  skills: SkillState[] = [];
  buffs: BuffState[] = [];
  combos: unknown[] = [];

  hooks = new Map<string, Map<number, AttrHook>>();

  /** 自动恢复计时器（挂在世界逻辑时钟上）。 */
  recoveryTimer: TimerHandle | null = null;

  attackCooledDown = false;
  attackCoolDownTimer: TimerHandle | null = null;

  casting: SkillState | null = null;
  castingTimer: TimerHandle | null = null;

  reading: BuffState | null = null;

  /** 原版 `mobx-utils` 的 keepAlive 句柄：无 MobX 后无实际作用，保留字段以对齐 dump/dispose 结构。 */
  keepAlives: Array<() => void> = [];

  /**
   * 显式调度用的「上一次反应式结果」。
   *
   * MobX `reaction` 只在表达式结果**引用变化**时触发 effect（默认 comparer 是 identity）。
   * 移植后我们保留这个判据：只有 `canUseSkill()` 找到的技能对象与上次不同，才调用
   * `tryUseSkill`，从而避免把 `preskill` 这类有副作用的 hook 多调一次。
   */
  lastSkillTrigger: SkillState | null = null;

  constructor(world: BattleWorld, _savedState?: UnitSavedState | null) {
    this.world = world;
    this.logicClock = world.logicClock;
    // 原版 `this.timeline = new TimeLine(timeline)`：每个单位一棵子时钟（攻速作用于它）。
    this.clock = new Timeline(world.logicClock);
    this.key = (keyGenerator += 1);
  }

  /** 事件里使用的稳定 id。 */
  get id(): string {
    return String(this.key);
  }

  /**
   * 原版 `initKeepAlives()`：`mobx-utils.keepAlive` 只影响计算属性的缓存生命周期，
   * 移植后计算属性就是普通 getter，无需保活。保留空实现以便子类覆写链不变。
   */
  initKeepAlives(): void {
    // no-op：无 MobX 计算属性缓存。
  }

  // ────────────────────────────── 资源 ──────────────────────────────

  get hp(): number {
    return this._hp;
  }
  set hp(value: number) {
    const next = clampResource(value, this.maxHp);
    if (next !== this._hp) {
      this._hp = next;
      this.scheduleSkillEvaluation();
    }
  }

  get mp(): number {
    return this._mp;
  }
  set mp(value: number) {
    const next = clampResource(value, this.maxMp);
    if (next !== this._mp) {
      this._mp = next;
      this.scheduleSkillEvaluation();
    }
  }

  get rp(): number {
    return this._rp;
  }
  set rp(value: number) {
    const next = clampResource(value, this.maxRp);
    if (next !== this._rp) {
      this._rp = next;
      this.scheduleSkillEvaluation();
    }
  }

  get ep(): number {
    return this._ep;
  }
  set ep(value: number) {
    const next = clampResource(value, this.maxEp);
    if (next !== this._ep) {
      this._ep = next;
      this.scheduleSkillEvaluation();
    }
  }

  getResource(key: ResourceKey): number {
    switch (key) {
      case 'hp':
        return this.hp;
      case 'mp':
        return this.mp;
      case 'rp':
        return this.rp;
      case 'ep':
        return this.ep;
      case 'comboPoint':
        return this.comboPoint;
    }
  }

  setResource(key: ResourceKey, value: number): void {
    switch (key) {
      case 'hp':
        this.hp = value;
        break;
      case 'mp':
        this.mp = value;
        break;
      case 'rp':
        this.rp = value;
        break;
      case 'ep':
        this.ep = value;
        break;
      case 'comboPoint':
        if (value !== this.comboPoint) {
          this.comboPoint = value;
          this.scheduleSkillEvaluation();
        }
        break;
    }
  }

  // ────────────────────────────── 基础属性（子类覆写） ──────────────────────────────

  get maxHp(): number {
    return 0;
  }
  get maxMp(): number {
    return 0;
  }
  get maxRp(): number {
    return 0;
  }
  get maxEp(): number {
    return 0;
  }
  get maxCombo(): number {
    return this.runAttrHooks(0, 'maxCombo');
  }
  get hpRecovery(): number {
    return 0;
  }
  get mpRecovery(): number {
    return 0;
  }
  get rpRecovery(): number {
    return 0;
  }
  get epRecovery(): number {
    return 0;
  }
  get rpOnAttack(): number {
    return 0;
  }
  get rpOnAttacked(): number {
    return 0;
  }
  get rpRecHp(): number {
    return this.runAttrHooks(0, 'rpRecHp');
  }
  get atk(): number {
    return 0;
  }
  get atkSpeed(): number {
    return 0;
  }
  get critRate(): number {
    return 0;
  }
  get critBonus(): number {
    return 1.5;
  }
  get leech(): number {
    return 0;
  }
  get def(): number {
    return 0;
  }
  get level(): number {
    return 0;
  }
  get name(): string {
    return '';
  }
  get displayName(): string {
    return this.runAttrHooks(this.name, 'displayName');
  }
  get dmgAdd(): number {
    return 1;
  }
  get expInc(): number {
    return 1;
  }
  get mf(): number {
    return 1;
  }
  get gf(): number {
    return 1;
  }
  get canGetExp(): boolean {
    return false;
  }
  get hpFromKill(): number {
    return 0;
  }
  get mpFromKill(): number {
    return 0;
  }
  get skillExpInc(): number {
    return 1;
  }

  /**
   * 结算经验。基类单位不收经验（原版只有 `PlayerUnit` 覆写）；
   * `world.gotExp` 会先按 `canGetExp` 过滤，因此基类实现是安全兜底。
   */
  gotExp(_v: number, _level: number): void {}

  get noDodgeRate(): number {
    return this.runAttrHooks(0.95, 'noDodgeRate');
  }
  get dodgeRate(): number {
    return 1 - this.noDodgeRate;
  }
  get stunResist(): number {
    return this.runAttrHooks(0, 'stunResist');
  }
  get allResist(): number {
    return 0;
  }
  get meleeAbsorb(): number {
    return 0;
  }
  get fireAbsorb(): number {
    return 0;
  }
  get fireResist(): number {
    return 0;
  }
  get darkAbsorb(): number {
    return 0;
  }
  get darkResist(): number {
    return 0;
  }
  get coldAbsorb(): number {
    return 0;
  }
  get coldResist(): number {
    return 0;
  }
  get lightningAbsorb(): number {
    return 0;
  }
  get lightningResist(): number {
    return 0;
  }

  // ────────────────────────────── 攻速 → 时钟倍率 ──────────────────────────────

  get speedRate(): number {
    let ret = 1;
    ret = this.runAttrHooks(ret, 'speedRate');
    ret = this.runAttrHooks(ret, 'speedRateMul');
    return ret;
  }

  /**
   * 原版 `autorun(() => this.timeline.setRate(this.speedRate))`。
   * 必须在所有会改变 `speedRate` 的位置显式调用（见文件头注释）。
   */
  refreshSpeedRate(): void {
    this.clock.setRate(this.speedRate);
  }

  // ────────────────────────────── 目标 ──────────────────────────────

  setTarget(unit: Unit | null): void {
    this.target = unit;
    if (unit) {
      unit.runAttrHooks(this, 'becomeTarget');
      // 原版第三个 autorun：目标若已进入 ghost，立刻换目标。
      if (unit.camp === Camps.ghost) {
        this.findTarget();
        return;
      }
    }
    this.scheduleSkillEvaluation();
  }

  /** 原版 `willAttack`。 */
  willAttack(target: Unit): boolean {
    return !!this.runAttrHooks(hatesCamp(this.camp, target.camp), 'willAttack', target);
  }

  /** 原版 `canAttack`。 */
  canAttack(target: Unit): boolean {
    return canAttackCamp(this.camp, target.camp);
  }

  /** 原版 `willAssist`。 */
  willAssist(target: Unit): boolean {
    return assistsCamp(this.camp, target.camp);
  }

  setCamp(camp: Camp): void {
    this.camp = camp;
    this.target = null;
    this.findTarget();
    for (const unit of this.world.units) {
      if (unit.target === this && !unit.canAttack(this)) {
        unit.target = null;
        unit.findTarget();
      }
    }
  }

  /** 原版 `findTarget`：`Math.random()` → `rng.target`。 */
  findTarget(): void {
    const targets = this.world.units.filter((v) => this.willAttack(v));
    const target = targets[this.world.rng.target.int(targets.length)];
    this.setTarget(target ?? null);
  }

  // ────────────────────────────── 读条 / 施法 ──────────────────────────────

  get castingName(): string {
    return (
      (this.casting && this.casting.skillData.name) ||
      (this.reading && this.reading.buffData.name) ||
      ''
    );
  }

  get castingTime(): number {
    if (this.casting) {
      return this.casting.skillData.castTime ?? 0;
    }
    if (this.reading) {
      return this.reading.totalTime ?? 0;
    }
    return 1;
  }

  get castingRest(): number {
    if (this.casting) {
      return this.castingTime + this.clock.getTime() - (this.castingTimer ? this.castingTimerStart! : 0);
    }
    if (this.reading) {
      return (this.reading.expireAt ?? 0) - this.clock.getTime();
    }
    return 0;
  }

  /** `castingRest` 需要的起始时刻；`TimerHandle` 契约不含 `at`，因此单独记录。 */
  castingTimerStart: number | null = null;

  startRead(type: string, time: number, arg?: unknown, skill?: unknown): void {
    if (this.camp === Camps.ghost) {
      return;
    }
    // 不同于 buff 使用世界时间轴，读条技能使用角色时间轴。
    const buff = new BuffState(this.world, this.clock, this, type, time, arg);
    buff.skill = skill ?? null;
    buff.willAppear();
    this.world.sendBuffState(this, type, true);
    this.buffs.push(buff);
    buff.didAppear();
    this.reading = buff;
  }

  setAttackCoolDown(): void {
    this.attackCooledDown = false;
    this.attackCoolDownTimer = this.clock.setTimeout(this.onAttackCoolDown, 1000 / this.atkSpeed);
    this.scheduleSkillEvaluation();
  }

  onAttackCoolDown = (): void => {
    this.attackCoolDownTimer = null;
    this.attackCooledDown = true;
    this.scheduleSkillEvaluation();
  };

  /**
   * 原版 `canUseSkill`（第 655–670 行）。返回值从 `SkillState | undefined` 规整为
   * `SkillState | null`，便于 `lastSkillTrigger` 用引用比较。
   */
  canUseSkill(): SkillState | null {
    if (this.camp === Camps.ghost) {
      return null;
    }
    if (this.casting || this.reading) {
      return null;
    }
    if (this.clock.isPaused()) {
      return null;
    }
    if (this.runAttrHooks(false, 'stunned')) {
      return null;
    }
    return this.skills.find((v) => v.shouldUse) ?? null;
  }

  /**
   * 显式调度队列的消费入口。
   *
   * ## 为什么与原版 `reaction(canUseSkill, tryUseSkill)` 等价
   *
   * - MobX 的 reaction 在**任一被追踪的 observable 变化**后重新求值 `canUseSkill`，
   *   若结果引用变化则调用 `tryUseSkill(结果)`；
   * - 本移植把「任一变化」显式化为 `scheduleSkillEvaluation()` 的调用点：
   *   冷却到期、普攻就绪、资源增减、目标变化、Buff 增删、技能表变化、读条结束；
   * - 结果引用比较完全保留（`lastSkillTrigger`），因此多排一次队不会多施放一次技能；
   * - `canUseSkill` 内部的全部门槛（冷却 / 普攻就绪 / 资源 / `canUse` 回调 / 眩晕 / 读条中）
   *   未做任何改动，仍由 `shouldUse` → `canUse` 判定。
   *
   * 唯一的语义差异是「求值时机」：MobX 在 action 批处理的边界同步求值，本实现经
   * `Clock.setTimeout(…, 0)` 在**同一虚拟时刻**的下一轮队列消费（见
   * `SkillScheduler`），在同一虚拟毫秒内完成，不改变可观测的战斗结果。
   */
  evaluateSkills(): void {
    if (this.camp === Camps.ghost) {
      return;
    }
    const next = this.canUseSkill();
    if (next === this.lastSkillTrigger) {
      return;
    }
    this.lastSkillTrigger = next;
    this.tryUseSkill(next);
  }

  /** 把本单位排进世界的显式技能调度队列（替代 MobX 依赖追踪）。 */
  scheduleSkillEvaluation(): void {
    if (this.camp === Camps.ghost) {
      return;
    }
    this.world.scheduler.enqueue(this);
  }

  breakCasting(coolDown: number | null, force = false): void {
    const { casting, reading } = this;
    if (casting && !casting.notBreakable) {
      if (!force && !casting.testBreak()) {
        return;
      }
      this.world.sendBreakCasting(this, casting);
      if (this.castingTimer) {
        this.clock.clearTimeout(this.castingTimer);
      }
      this.castingTimer = null;
      this.castingTimerStart = null;
      this.casting = null;
      if (coolDown) {
        casting.setupCoolDown(coolDown);
      }
    }
    if (reading && reading.skill && !(reading.skill as SkillState).notBreakable) {
      const skill = reading.skill as SkillState;
      if (!force && !skill.testBreak()) {
        return;
      }
      this.world.sendBreakCasting(this, reading);
      this.reading = null;
      this.removeBuff(reading);
      if (coolDown && reading.skill) {
        skill.setupCoolDown(coolDown);
      }
    }
    this.scheduleSkillEvaluation();
  }

  /** 原版 `tryUseSkill`（第 700–727 行）。 */
  tryUseSkill(skill: SkillState | null): void {
    this.runAttrHooks(skill, 'preskill', this.world);

    if (!this.casting && skill && skill.canUse) {
      const { castTime } = skill.skillData;
      if (castTime) {
        this.castingTimer = this.clock.setTimeout(() => {
          if (skill.canUse) {
            this.runAttrHooks(null, 'preSkillEffect');
            skill.effect();
            this.runAttrHooks(null, 'postSkillEffect');
          }

          this.castingTimer = null;
          this.castingTimerStart = null;
          this.casting = null;
          this.scheduleSkillEvaluation();
        }, castTime);
        this.castingTimerStart = this.clock.getTime();
        this.casting = skill;
      } else {
        this.runAttrHooks(null, 'preSkillEffect');
        skill.effect();
        this.runAttrHooks(null, 'postSkillEffect');
      }
    }
  }

  // ────────────────────────────── 伤害 / 死亡 ──────────────────────────────

  testDodge(): boolean {
    const { noDodgeRate } = this;
    return this.world.rng.dodge.next() > noDodgeRate;
  }

  /** 原版 `damage`：返回是否真正承伤（ghost 免疫）。 */
  damage(_type: string, from: Unit | null, v: number): boolean {
    if (this.camp === Camps.ghost) {
      return false;
    }
    this.hp -= v;
    if (this.hp <= 0) {
      this.kill();
    } else if (from && this.target === null && this.canAttack(from)) {
      // 无目标时受到攻击，则进入战斗。
      this.setTarget(from);
    }
    return true;
  }

  kill(): void {
    this.camp = Camps.ghost;
    this.target = null;
    this.rp = 0;
    this.mp = 0;
    this.ep = 0;
    this.comboPoint = 0;
    if (this.casting) {
      if (this.castingTimer) {
        this.clock.clearTimeout(this.castingTimer);
      }
      this.casting = null;
      this.castingTimer = null;
      this.castingTimerStart = null;
    }
    if (this.recoveryTimer) {
      this.logicClock.clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    for (const buff of this.buffs.slice(0)) {
      this.removeBuff(buff);
    }
    // 替代原版第三个 autorun：其它单位若仍以「已死亡的我」为目标，重新选目标。
    this.world.retargetAwayFrom(this);
  }

  // ────────────────────────────── 技能表 ──────────────────────────────

  /**
   * 向技能表插入技能。第二、三个参数是给子类解释的：
   * - `PlayerUnit.addSkill(type)`（技能等级从玩家取）；
   * - `EnemyUnit.addSkill(type, level, saved)`（原版第 2270 行）。
   */
  addSkill(type: string, a?: unknown, b?: unknown): void {
    this.skills.unshift(new SkillState(this.world, this, type, (b ?? a) as { coolDown?: number } | null));
    this.scheduleSkillEvaluation();
  }

  removeSkill(type: string): void {
    const id = this.skills.findIndex((v) => v.type === type);
    if (id < 0) {
      // 原版 `splice(-1, 1)` 会误删最后一个技能；这里有意收紧为 no-op（见交付报告差异清单）。
      return;
    }
    const state = this.skills.splice(id, 1);
    state[0]?.dispose();
    this.scheduleSkillEvaluation();
  }

  // ────────────────────────────── 恢复 ──────────────────────────────

  startRecovery(): void {
    if (!this.recoveryTimer) {
      this.recoveryTimer = this.logicClock.setTimeout(
        this.recovery,
        (1000 * RECOVERY_RATE) / this.speedRate,
      );
    }
  }

  recovery = (): void => {
    if (this.camp === Camps.ghost) {
      this.recoveryTimer = null;
      return;
    }
    if (this.hpRecovery) {
      this.hp += (this.hpRecovery || 0) * RECOVERY_RATE;
    }
    if (this.mpRecovery) {
      this.mp += (this.mpRecovery || 0) * RECOVERY_RATE;
    }
    if (this.rpRecovery) {
      this.rp += (this.rpRecovery || 0) * RECOVERY_RATE;
    }
    if (this.epRecovery) {
      this.ep += (this.epRecovery || 0) * RECOVERY_RATE;
    }
    this.recoveryTimer = null;
    this.startRecovery();
  };

  // ────────────────────────────── hook 链 ──────────────────────────────

  addAttrHook(key: string, replace: AttrHook): () => void {
    let hooks = this.hooks.get(key);
    if (!hooks) {
      hooks = new Map<number, AttrHook>();
      this.hooks.set(key, hooks);
    }
    let id = ++globalCounter;
    if (globalCounter >= 100000) {
      globalCounter = 0;
    }
    while (hooks.has(id)) {
      id = ++globalCounter;
      if (globalCounter >= 100000) {
        globalCounter = 0;
      }
    }

    hooks.set(id, replace);
    // 原版 `speedRate` 是计算属性，hook 变化会让 autorun 重跑；这里显式刷新。
    this.refreshSpeedRate();

    return () => {
      hooks.delete(id);
      this.refreshSpeedRate();
    };
  }

  /**
   * 属性 hook 链求值（原版第 880–890 行）。
   *
   * 泛型化：原版同一套 hook 也被用于非数字值（`displayName` 的字符串、
   * `stunned` / `willClean` 的布尔、`preskill` 的技能对象）。`contracts/data.ts`
   * 的 `AttrHook` 把 `effect/value` 标成 `number` 只是最常见的用法；这里的运行时
   * 行为与原版逐字一致（`ret = hook(ret, ...args)`），类型上放宽以免伪造转换。
   */
  runAttrHooks<T>(value: T, key: string, ...args: unknown[]): T {
    let ret = value;
    const hooks = this.hooks.get(key);
    if (hooks) {
      for (const v of hooks.values()) {
        ret = (v as unknown as (effect: T, ...extra: unknown[]) => T)(ret, ...args);
      }
    }
    return ret;
  }

  // ────────────────────────────── Buff ──────────────────────────────

  addBuff(
    type: string,
    time?: number | null,
    arg?: unknown,
    group?: string | null,
    maxStack = 1,
  ): BuffState | null {
    if (this.camp === Camps.ghost) {
      return null;
    }
    // 没有 group：无限叠加 buff
    // 有 group，maxStack 不提供：单次叠加 BUFF
    // 有 group，提供 maxStack：指定最大叠加次数的 BUFF
    if (group) {
      // 有限叠加 BUFF，移除超出的多余 buff
      const groupBuffs = this.buffs
        .filter((v) => v.group === group)
        .sort((a, b) => {
          let v = 0;
          if (a.buffData.compBuff) {
            v = (a.buffData.compBuff as unknown as (x: BuffState, y: BuffState) => number)(a, b);
          }
          if (!v) {
            return (a.expireAt ?? 0) - (b.expireAt ?? 0);
          }
          return v;
        });
      const removeBuffs = groupBuffs.slice(0, groupBuffs.length - maxStack + 1);
      const replaceBuff = removeBuffs.shift();
      if (replaceBuff && replaceBuff.type === type) {
        replaceBuff.arg = arg;
        replaceBuff.resetTimer(time);
        return replaceBuff;
      }
      const buff = new BuffState(this.world, this.logicClock, this, type, time, arg, group);
      if (!buff.willAppear()) {
        return null;
      }
      if (replaceBuff) {
        this.removeBuff(replaceBuff);
      }
      removeBuffs.forEach((v) => this.removeBuff(v));
      this.world.sendBuffState(this, type, true);
      this.buffs.push(buff);
      buff.didAppear();
      this.scheduleSkillEvaluation();
      return buff;
    }

    const buff = new BuffState(this.world, this.logicClock, this, type, time, arg, group);
    if (!buff.willAppear()) {
      return null;
    }
    this.world.sendBuffState(this, type, true);
    this.buffs.push(buff);
    buff.didAppear();
    this.scheduleSkillEvaluation();
    return buff;
  }

  removeBuff(buff: BuffState): void {
    const idx = this.buffs.indexOf(buff);
    if (idx < 0) {
      return;
    }
    this.world.sendBuffState(this, buff.type, false);
    buff.willRemove();
    this.buffs.splice(idx, 1);
    buff.didRemove();
    this.scheduleSkillEvaluation();
  }

  // ────────────────────────────── 状态 ──────────────────────────────

  dumpState(): Record<string, unknown> {
    const skills: Record<string, { coolDown?: number }> = {};
    for (const skill of this.skills) {
      skills[skill.type] = skill.dumpState();
    }
    return {
      camp: this.camp,
      hp: this.hp,
      rp: this.rp,
      ep: this.ep,
      mp: this.mp,
      target: this.target ? this.world.units.indexOf(this.target) : -1,
      skills,
      buffs: this.buffs.map((v) => v.dumpState()),
      casting: this.casting ? this.skills.indexOf(this.casting) : -1,
      castingTimer: this.casting && this.castingTimerStart !== null
        ? this.castingTime - (this.clock.getTime() - this.castingTimerStart)
        : undefined,
      reading: this.reading ? this.buffs.indexOf(this.reading) : -1,
    };
  }

  stun(power: number, type = 'stunned', force = false): boolean {
    const { casting, reading } = this;
    if (casting && casting.notBreakable && !force) {
      return false;
    }
    if (reading && reading.skill && !(reading.skill as SkillState).notBreakable && !force) {
      return false;
    }
    const { stunResist } = this;
    const dur = force ? power : power / (1 + stunResist / 100);
    let base = Math.floor(dur);
    const rest = dur - base;
    if (this.world.rng.stun.next() < rest) {
      base += 1;
    }
    if (base > 0) {
      this.breakCasting(null, true);
      this.addBuff(type, base * 1000);
      return true;
    }
    return false;
  }

  testCrit(critRate: number | null = null): number {
    if (critRate === null) {
      critRate = this.critRate;
    }
    let base = Math.floor(critRate);
    const rest = critRate - base;
    if (this.world.rng.crit.next() < rest) {
      ++base;
    }
    // 原版第 1061 行是 `this.runAttrHooks('testCrit', base)`——参数写反了，
    // 等价于 `hooks.get(<number>)`（永远 miss）→ 空操作。这里**原样保留**这个空操作，
    // 不做「修正」，以免与原版数值产生差异。
    this.runAttrHooks<string>('testCrit', base as unknown as string);
    return base;
  }

  getCritBonus(rate: number, baseBonus: number | null = null): number {
    if (baseBonus === null) {
      baseBonus = this.critBonus;
    }
    return 1 + baseBonus * rate;
  }

  dispose(): void {
    this.keepAlives.forEach((v) => v());
    this.keepAlives = [];
    this.skills.forEach((v) => v.dispose());
    this.skills.splice(0);

    const { casting, reading } = this;
    if (casting) {
      if (this.castingTimer) {
        this.clock.clearTimeout(this.castingTimer);
      }
      this.castingTimer = null;
      this.castingTimerStart = null;
      this.casting = null;
    }
    if (reading) {
      this.reading = null;
      this.removeBuff(reading);
    }

    if (this.attackCoolDownTimer) {
      this.clock.clearTimeout(this.attackCoolDownTimer);
      this.attackCoolDownTimer = null;
    }

    if (this.recoveryTimer) {
      this.logicClock.clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.clock.dispose();
  }

  /** 供 hook 使用的属性名工具（与 world 伤害管线同一实现）。 */
  static attrKey(base: string, suffix: string): string {
    return camelCase(base + '-' + suffix);
  }
}
