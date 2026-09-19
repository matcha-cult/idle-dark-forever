/**
 * Buff 状态（原版 `src/logics/unit.js` 的 `class BuffState`，第 288–450 行）。
 *
 * ## 与原版的对应关系
 *
 * | 原版 | 本移植 |
 * |---|---|
 * | `this.timeline`（构造时注入：读条用单位时钟，常规 Buff 用世界逻辑时钟） | `this.clock` |
 * | `buffs[this.type]` 全局数据表 | `world.tables.buffs[this.type]` |
 * | `unit.addAttrHook` 的返回值（dispose 函数） | 原样保留 `hookDisposes` |
 * | `runInAction` | 已删除（无 MobX）；改为在状态变更处显式通知单位 |
 *
 * 周期效果（`effectInterval`）与原版一样是「先排下一次、再执行本次」：
 * `effect()` 第一件事就是 `setTimeout(this.effect, effectInterval)`，因此
 * 即使 `effect` 回调里移除 Buff，也已经被 `didRemove` 里的 `clearTimeout` 取消。
 */

import type { Clock, TimerHandle } from '../contracts/ports.js';
import type { BuffData } from '../contracts/data.js';
import type { Unit } from './unit.js';
import type { BattleWorld } from './battle-world.js';

export class BuffState {
  readonly world: BattleWorld;
  readonly clock: Clock;
  readonly unit: Unit;
  readonly type: string;

  /** 叠加组（无 group = 无限叠加）。 */
  group: string | null = null;

  /** 外部传入的参数（原版 `arg`）。 */
  arg: unknown = null;

  stack = 1;

  expireAt: number | null = null;
  totalTime: number | null = null;
  timer: TimerHandle | null = null;
  effectTimer: TimerHandle | null = null;

  hookDisposes: Array<() => void> | null = [];

  /** 读条来源技能（原版 `startRead` 会挂上）。 */
  skill: unknown = null;

  constructor(
    world: BattleWorld,
    clock: Clock,
    unit: Unit,
    type: string,
    time?: number | null,
    arg?: unknown,
    group?: string | null,
  ) {
    this.world = world;
    this.clock = clock;
    this.unit = unit;
    this.type = type;
    this.arg = arg ?? null;
    this.group = group ?? null;

    if (time) {
      this.totalTime = time;
      this.expireAt = clock.getTime() + time;
      this.timer = clock.setTimeout(this.over, time);
    }
  }

  resetTimer(time?: number | null): void {
    const { clock } = this;
    if (this.timer) {
      clock.clearTimeout(this.timer);
      this.timer = null;
    }
    if (time) {
      this.expireAt = clock.getTime() + time;
      this.timer = clock.setTimeout(this.over, time);
    } else {
      this.expireAt = null;
    }
  }

  effect = (): void => {
    const interval = this.effectInterval;
    if (interval) {
      this.effectTimer = this.clock.setTimeout(this.effect, interval);
    }
    this.buffData.effect?.call(this, this.world);
  };

  over = (): void => {
    this.timer = null;
    this.unit.removeBuff(this);
  };

  get buffData(): BuffData {
    const data = this.world.tables.buffs[this.type];
    if (!data) {
      throw new Error(`[combat] unknown buff: ${this.type}`);
    }
    return data;
  }

  get effectInterval(): number {
    const { effectInterval } = this.buffData;
    if (typeof effectInterval === 'function') {
      // 契约把 effectInterval 标为 `(level) => number`，原版实际以 0 参调用。
      return (effectInterval as (level?: number) => number).call(this);
    }
    return effectInterval ?? 0;
  }

  dispose(): void {
    this.didRemove();
  }

  runAttrHook(val: number, key: string): number {
    const {
      buffData: { hooks },
    } = this;
    if (hooks && hooks[key]) {
      return hooks[key]!.call(this, val);
    }
    return val;
  }

  willAppear(): boolean {
    const { willAppear } = this.buffData;
    if (willAppear) {
      // 契约把返回类型标为 void，但原版数据用 `return false` 否决附加。
      return (willAppear.call(this, this.world) as unknown) !== false;
    }
    return true;
  }

  didAppear(): void {
    const { clock, unit } = this;
    const { didAppear, hooks } = this.buffData;
    const effectInterval = this.effectInterval;

    if (effectInterval) {
      this.effectTimer = clock.setTimeout(this.effect, effectInterval);
    }

    if (hooks) {
      for (const key of Object.keys(hooks)) {
        this.hookDisposes!.push(unit.addAttrHook(key, hooks[key]!.bind(this)));
      }
    }
    if (didAppear) {
      didAppear.call(this, this.world);
    }
  }

  willRemove(): void {
    const { willRemove } = this.buffData;
    if (willRemove) {
      willRemove.call(this, this.world);
    }
  }

  didRemove(): void {
    const { didRemove } = this.buffData;
    if (didRemove) {
      didRemove.call(this, this.world);
    }
    if (this.timer) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.effectTimer) {
      this.clock.clearTimeout(this.effectTimer);
      this.effectTimer = null;
    }
    const { buffData } = this;
    if (buffData.onOver) {
      buffData.onOver.call(this, this.world);
    }
    if (this.hookDisposes) {
      this.hookDisposes.forEach((v) => v());
      this.hookDisposes = null;
    }
    if (this.unit.reading === this) {
      this.unit.reading = null;
    }
  }

  dumpState(): { type: string; group: string | null; arg: unknown; time?: number } | undefined {
    if (this.buffData.notSave) {
      return undefined;
    }
    const ret: { type: string; group: string | null; arg: unknown; time?: number } = {
      type: this.type,
      group: this.group,
      arg: this.arg,
    };
    if (this.expireAt !== null) {
      ret.time = this.expireAt - this.clock.getTime();
    }
    return ret;
  }
}
