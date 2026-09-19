/**
 * 技能状态（原版 `src/logics/unit.js` 的 `class SkillState`，第 90–286 行）。
 *
 * ## 与原版的对应关系
 *
 * | 原版 | 本移植 |
 * |---|---|
 * | `this.timeline` = 单位自己的 Timeline | `this.clock`（`Unit.clock`） |
 * | `skills[this.type]` 全局数据表 | `world.tables.skills[this.type]`（构造器注入） |
 * | `world` 模块级单例 | `this.world`（显式引用） |
 * | `@observable/@computed` | 普通字段 + 纯 getter |
 * | 冷却到期由 MobX 广播给 `reaction` | `setupCoolDown` / `onCoolDown` 显式调用 `unit.scheduleSkillEvaluation()` |
 *
 * 冷却剩余时间的读取不再访问定时器句柄的内部字段（`TimerHandle` 契约里没有 `at`），
 * 而是统一用 `coolDownAt - clock.getTime()`；对本工程的 `ClockBase` 两者恒等：
 * `setTimeout` 以 `current + delay` 入堆，`getTime()` 返回 `current`。
 */

import type { Clock, TimerHandle } from '../contracts/ports.js';
import type { SkillData } from '../contracts/data.js';
import type { Unit, ResourceKey } from './unit.js';
import type { BattleWorld } from './battle-world.js';
import { camelCase } from './util.js';

const RESOURCE_KEYS: ResourceKey[] = ['hp', 'mp', 'rp', 'ep', 'comboPoint'];

/** 原版 `skillData.cost` 的运行时形状（契约把它标为 object | function，这里全部兼容）。 */
type CostValue = number | ((self: Unit) => number) | undefined;
type CostTable = Partial<Record<ResourceKey, CostValue>>;

export class SkillState {
  /** 技能数据表的键（原版 `type`）。 */
  readonly type: string;
  /** 释放该技能所依附的单位。 */
  readonly unit: Unit;
  /** 单位自身的时钟（原版 `this.timeline`）：冷却与读条都在它上面计时。 */
  readonly clock: Clock;
  readonly world: BattleWorld;

  coolDownTimer: TimerHandle | null = null;
  cooleddown = true;
  coolDownAt = 0;

  constructor(world: BattleWorld, unit: Unit, type: string, savedState?: { coolDown?: number } | null) {
    this.world = world;
    this.unit = unit;
    this.clock = unit.clock;
    this.type = type;

    if (savedState) {
      if (savedState.coolDown) {
        this.setupCoolDown(savedState.coolDown);
      }
    } else {
      this.setupCoolDown();
    }
  }

  /** 原版 `getLevel()`：PlayerUnit 覆盖为玩家技能等级，EnemyUnit 覆盖为固定等级。 */
  getLevel(): number {
    return 0;
  }

  /** 原版 `addSkillExp()`：仅 PlayerUnit 覆盖。 */
  addSkillExp(): void {
    // Be overrided later.
  }

  /** 技能数据。缺失即数据错误（原版会 `alert` 后抛 TypeError）。 */
  get skillData(): SkillData {
    const data = this.world.tables.skills[this.type];
    if (!data) {
      throw new Error(`[combat] unknown skill: ${this.type}`);
    }
    return data;
  }

  get name(): string {
    return this.skillData.name;
  }

  /** 原版 `reduceCoolDown`。 */
  reduceCoolDown(time: number, force = false): void {
    if (!this.cooleddown) {
      this.setupCoolDown(this.coolDownAt - this.clock.getTime() - time, force);
    }
  }

  /** 原版 `setupCoolDown`（第 135–161 行），逐行对齐。 */
  setupCoolDown(cd?: number, force = false): void {
    const { skillData } = this;
    const coolDown =
      cd ||
      (typeof skillData.coolDown === 'function'
        ? (skillData.coolDown as (level: number, unit: Unit) => number)(this.getLevel(), this.unit)
        : skillData.coolDown);
    if (!force && this.coolDownAt - this.clock.getTime() >= coolDown) {
      // 如果由于打断等原因重复叠加冷却，选择最长的
      return;
    }
    if (this.coolDownTimer) {
      this.clock.clearTimeout(this.coolDownTimer);
      this.coolDownTimer = null;
    }
    if (coolDown && coolDown > 0) {
      this.coolDownAt = this.clock.getTime() + coolDown;
      this.cooleddown = false;
      this.coolDownTimer = this.clock.setTimeout(this.onCoolDown, coolDown);
    } else {
      this.cooleddown = true;
    }
    // MobX 原版：以上字段都是 observable，reaction 会在这之后重新求值。
    this.unit.scheduleSkillEvaluation();
  }

  /** 原版 `effect`（第 163–194 行），逐行对齐。 */
  effect = (): void => {
    const { skillData } = this;

    skillData.effect.call(this, this.world, this.unit, this.getLevel());

    if (skillData.isAttack) {
      this.unit.setAttackCoolDown();
    }

    if (skillData.cost) {
      const rawCost = skillData.cost;
      const costTable: CostTable =
        typeof rawCost === 'function' ? (rawCost(this.getLevel()) as CostTable) : (rawCost as CostTable);
      for (const k of RESOURCE_KEYS) {
        let cost = costTable[k];
        if (typeof cost === 'function') {
          cost = cost(this.unit);
        }
        if (cost) {
          if (k === 'rp') {
            this.unit.hp += cost * (this.unit.rpRecHp || 0);
          }
          this.unit.setResource(k, this.unit.getResource(k) - cost);
          this.unit.runAttrHooks(cost, camelCase('postCost-' + k));
        }
      }
    }
    this.setupCoolDown();
    this.addSkillExp();
  };

  /** 原版 `onCoolDown`。 */
  onCoolDown = (): void => {
    this.coolDownTimer = null;
    this.coolDownAt = 0;
    this.cooleddown = true;
    this.unit.scheduleSkillEvaluation();
  };

  /** 原版 `shouldUse`。 */
  get shouldUse(): boolean {
    if (!this.canUse) {
      return false;
    }
    const { skillData } = this;
    if (skillData.shouldUse) {
      return skillData.shouldUse.call(this, this.world, this.unit, this.getLevel());
    }
    return true;
  }

  /** 原版 `canUse`（第 215–244 行），逐行对齐。 */
  get canUse(): boolean {
    if (!this.cooleddown) {
      return false;
    }
    const { skillData } = this;
    if (skillData.isAttack && !this.unit.attackCooledDown) {
      return false;
    }
    if (skillData.cost) {
      const rawCost = skillData.cost;
      const costTable: CostTable =
        typeof rawCost === 'function' ? (rawCost(this.getLevel()) as CostTable) : (rawCost as CostTable);
      if (
        RESOURCE_KEYS.some((k) => {
          let cost = costTable[k];
          if (typeof cost === 'function') {
            cost = cost(this.unit);
          }
          return cost && cost > this.unit.getResource(k);
        })
      ) {
        return false;
      }
    }
    if (skillData.canUse && !skillData.canUse.call(this, this.world, this.unit, this.getLevel())) {
      return false;
    }
    return true;
  }

  get notBreakable(): boolean {
    return !!this.skillData.notBreakable;
  }

  /** 原版 `dispose`：清冷却，并连带击杀由本技能召唤出来的单位。 */
  dispose(): void {
    if (this.coolDownTimer) {
      this.clock.clearTimeout(this.coolDownTimer);
      this.coolDownTimer = null;
    }
    for (const unit of this.world.units.filter((v) => v.summonSkill === this)) {
      unit.kill();
    }
  }

  /** 原版 `dumpState`：只保存剩余冷却（不含定时器句柄）。 */
  dumpState(): { coolDown?: number } {
    const ret: { coolDown?: number } = {};
    if (!this.cooleddown) {
      ret.coolDown = this.coolDownAt - this.clock.getTime();
    }
    return ret;
  }

  /** 原版 `testBreak`：`Math.random() < 1 - antiBreak`。 */
  testBreak(): boolean {
    const { antiBreak } = this.skillData;
    if (!antiBreak) {
      return true;
    }
    return this.world.rng.break.next() < 1 - (antiBreak as unknown as number);
  }
}
