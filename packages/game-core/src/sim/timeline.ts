/**
 * 虚拟时钟核心（原版 `src/logics/Timeline.js` 的移植）。
 *
 * ## 与原版的关系
 *
 * 原版 `Timeline` 是「基于最小堆、无累加误差、可集体倍率加速的 setTimeout 实现」，
 * 时间公式为 `now = (parent.now - parentCurrent) * rate + current`。本文件把三件
 * 与平台绑定的东西拆出去，其余逐行对齐：
 *
 * 1. **MobX**（`@observable` / `@action`）→ 普通字段 + 显式方法；
 * 2. **根时间源**（`mobx-utils` 的 `now('frame')`）→ 子类通过 `getSource()` 注入
 *    （`RealClock` 注入 `() => number`；子时钟注入父 `Clock`）；
 * 3. **宿主定时器**（`window.setTimeout`）→ 子类实现 `scheduleWake` / `cancelWake`。
 *
 * ## 两种「推进」语义
 *
 * - `sync()`：把虚拟时间推进到源时间轴的**当前**值（在线玩法，「到点就跑」）；
 * - `stepPaused(rest, budget)`：暂停态下**手动**推进 `rest` 虚拟毫秒（离线快进）。
 *   原版用「每 48ms 让出事件循环」的浏览器分批策略；服务端改为**事件预算**：
 *   单次调用最多消费 `budget` 个到期回调，返回**仍未推进完的剩余毫秒**（0 = 推完）。
 *   调用方循环 `rest = clock.stepPaused(rest)` 即可在不阻塞事件循环的前提下推完。
 *
 * ## 一处刻意的语义收紧（见交付报告）
 *
 * 原版 `stepPaused` 只在 `__DEV__` 下断言「必须先 pause」；本实现**始终**抛错。
 * 原版 `setRate` 在暂停态会顺带把 `current` 推到当前时间（等于偷偷解除暂停的效果）；
 * 本实现让 `sync()` 在暂停态直接返回，保持暂停不变量。
 */

import type { Clock, TimerHandle } from '../contracts/ports.js';
import { PrivQueue } from './priv-queue.js';

/** `stepPaused` 的默认事件预算（单次调用最多执行的回调数）。 */
export const DEFAULT_STEP_BUDGET = 5000;

/**
 * 堆内定时器记录。
 *
 * 注意：契约里的 `TimerHandle.removed` 是 `readonly`（对调用方只读），
 * 但内部必须能写；因此这里用「可变属性实现只读接口」的方式（结构类型允许）。
 */
export interface TimerRecord extends TimerHandle {
  readonly id: number;
  /** 到期时刻（本时钟的虚拟时间轴）。 */
  at: number;
  func: () => void;
  removed: boolean;
}

function compareByAt(a: TimerRecord, b: TimerRecord): boolean {
  return a.at < b.at;
}

let nextTimerId = 1;

/** 进程内单调递增的定时器 id（仅用于标识，不参与时间计算）。 */
export function nextTimerIdValue(): number {
  return nextTimerId++;
}

/** 源时间轴：只有「现在几点」这一个能力。 */
export interface TimeAxis {
  getTime(): number;
}

export abstract class ClockBase implements Clock {
  private readonly tree: PrivQueue<TimerRecord>;
  private rate = 1;
  private paused = false;
  /** 虚拟时间基准（原版 `current`）。 */
  private current = 0;
  /** 上一次同步时源时间轴的值（原版 `parentCurrent`）；null = 尚未初始化。 */
  private sourceAt: number | null = null;
  private updating = false;
  private wake: TimerHandle | null = null;
  private disposed = false;

  protected constructor() {
    this.tree = new PrivQueue<TimerRecord>(compareByAt);
  }

  // ───────────────────────── 子类扩展点 ─────────────────────────

  /** 驱动本时钟的源时间轴。 */
  protected abstract getSource(): TimeAxis;

  /** 请求宿主在 `delay`（**源时间轴**毫秒）后回调 `this.onWake`。 */
  protected abstract scheduleWake(delay: number): TimerHandle;

  /** 取消 `scheduleWake` 返回的句柄。 */
  protected abstract cancelWake(handle: TimerHandle): void;

  /**
   * 宿主定时器回调。绑定为实例字段（而非原型方法），
   * 因为句柄会被交给宿主、脱离 `this`。
   */
  protected readonly onWake = (): void => {
    this.wake = null;
    this.sync();
    this.resetWake();
  };

  // ───────────────────────── Clock 实现 ─────────────────────────

  getTime(): number {
    if (this.paused) {
      return this.current;
    }
    return this.current + (this.getSource().getTime() - this.initSource()) * this.rate;
  }

  getRate(): number {
    return this.rate;
  }

  isPaused(): boolean {
    return this.paused;
  }

  setTimeout(fn: () => void, delay: number): TimerHandle {
    if (typeof delay !== 'number' || Number.isNaN(delay)) {
      // 与原版一致：NaN 延迟直接抛错（Infinity 允许，代表「永不」）
      throw new Error('Invalid delay.');
    }
    this.tryUpdate();
    const timer: TimerRecord = {
      id: nextTimerIdValue(),
      at: this.current + delay,
      func: fn,
      removed: false,
    };
    const pos = this.tree.add(timer);
    if (pos === 0 && !this.updating && !this.paused) {
      this.clearWake();
      this.resetWake();
    }
    return timer;
  }

  clearTimeout(handle: TimerHandle): void {
    // 只有本时钟产出的 TimerRecord 才会被传进来；外部伪造的句柄会被忽略。
    (handle as TimerRecord).removed = true;
  }

  pause(): void {
    if (this.paused) {
      return;
    }
    if (!this.updating) {
      this.clearWake();
      this.sync();
    }
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    // 暂停期间源时间轴可能已经走了很远，重新对齐基准 → 虚拟时间从冻结处继续。
    this.sourceAt = this.getSource().getTime();
    if (!this.updating) {
      this.sync();
      this.resetWake();
    }
  }

  setRate(rate: number): void {
    if (this.rate === rate) {
      return;
    }
    if (!this.updating) {
      this.clearWake();
      this.sync();
    }
    this.rate = rate;
    if (!this.updating) {
      this.resetWake();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.clearWake();
    this.tree.clear();
    this.disposed = true;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /** 队列中待执行的定时器数量（诊断 / 测试用）。 */
  pendingCount(): number {
    return this.tree.size;
  }

  // ───────────────────────── 推进 ─────────────────────────

  /** 把虚拟时间推进到源时间轴的当前值，并执行所有到期回调（幂等、可重入安全）。 */
  tryUpdate(): void {
    if (this.updating || this.paused) {
      return;
    }
    this.sync();
  }

  /** 同 `tryUpdate`，但忽略暂停/重入保护（供内部与离线推进使用）。 */
  sync(): void {
    if (this.paused) {
      return;
    }
    const sourceEnd = this.getSource().getTime();
    const end = this.current + (sourceEnd - this.initSource()) * this.rate;
    this.runDue(end, sourceEnd, null);
  }

  /**
   * 暂停态下推进 `rest` 虚拟毫秒。
   *
   * @param rest   要推进的虚拟毫秒
   * @param budget 单次调用最多执行的到期回调数（默认 {@link DEFAULT_STEP_BUDGET}）
   * @returns 仍未推进完的剩余毫秒；`0` 表示已推完
   */
  stepPaused(rest: number, budget: number = DEFAULT_STEP_BUDGET): number {
    if (!this.paused) {
      throw new Error('stepPaused requires a paused clock (call pause() first)');
    }
    const limit =
      typeof budget === 'number' && Number.isFinite(budget) && budget >= 0
        ? Math.floor(budget)
        : DEFAULT_STEP_BUDGET;
    const end = this.current + rest;
    const sourceEnd = this.getSource().getTime();
    return this.runDue(end, sourceEnd, limit);
  }

  /**
   * 执行 `at <= end` 的全部到期回调，并把 `current` 推到 `end`。
   *
   * 与原版 `update()` 的关键细节对齐：
   * - 回调执行期间 `current = 该定时器的 at`，因此回调里 `setTimeout` 以「到期时刻」为基准；
   * - 回调中新增的、`at <= end` 的定时器会被**本轮**继续消费（原版同一个 `for(;;)`）；
   * - 已取消（`removed`）的堆项同样会被弹出并推进 `current`（原版行为），但不计预算。
   *
   * @returns 剩余虚拟毫秒（0 = 推完）
   */
  private runDue(end: number, sourceEnd: number, budget: number | null): number {
    this.updating = true;
    try {
      let executed = 0;
      for (;;) {
        const min = this.tree.minimum();
        if (!min || min.at > end) {
          this.current = end;
          this.sourceAt = sourceEnd;
          return 0;
        }
        if (budget !== null && executed >= budget) {
          // 预算耗尽：停在最后一个已执行回调的 at 上，剩余时间交给下一次调用。
          return end - this.current;
        }
        this.current = min.at;
        this.tree.removeMin();
        if (!min.removed) {
          min.removed = true;
          executed += 1;
          min.func();
        }
      }
    } finally {
      this.updating = false;
    }
  }

  // ───────────────────────── 内部 ─────────────────────────

  private initSource(): number {
    if (this.sourceAt === null) {
      this.sourceAt = this.getSource().getTime();
    }
    return this.sourceAt;
  }

  private resetWake(): void {
    if (this.disposed || this.paused) {
      return;
    }
    const min = this.tree.minimum();
    if (!min) {
      return;
    }
    // 速率为 0（或负）时虚拟时间不再前进，无需唤醒；否则会得到 Infinity 延迟。
    if (!(this.rate > 0)) {
      return;
    }
    // 原版 `resetTimer`：+0.01 避免与宿主定时器同一 tick 的对齐误差。
    const delay = (min.at - this.getTime()) / this.rate + 0.01;
    this.wake = this.scheduleWake(delay);
  }

  private clearWake(): void {
    if (this.wake) {
      const handle = this.wake;
      this.wake = null;
      this.cancelWake(handle);
    }
  }
}

/**
 * 以另一时钟为父的从属时钟（原版 `new Timeline(parent)`）。
 *
 * 父时钟提供两件事：绝对时间轴（`getTime`）与唤醒能力（`setTimeout`）。
 * 因此 `Timeline` 本身不需要任何宿主 API。
 */
export class Timeline extends ClockBase {
  private readonly parent: Clock;

  constructor(parent: Clock) {
    super();
    this.parent = parent;
  }

  protected override getSource(): TimeAxis {
    return this.parent;
  }

  protected override scheduleWake(delay: number): TimerHandle {
    return this.parent.setTimeout(this.onWake, delay);
  }

  protected override cancelWake(handle: TimerHandle): void {
    this.parent.clearTimeout(handle);
  }
}
