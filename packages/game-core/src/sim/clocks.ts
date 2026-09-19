/**
 * 时钟实现与工厂。
 *
 * 三种时钟，同一套引擎（`ClockBase`），差别只在「源时间轴从哪来、唤醒交给谁」：
 *
 * | 实现 | 源时间轴 | 唤醒宿主 | 用途 |
 * |---|---|---|---|
 * | `RealClock` | 注入的 `() => number`（典型是 `Date.now`） | 真实定时器 | 服务端在线主循环 |
 * | `VirtualClock` | 手动 `advanceBy(ms)` 推进的内部轴 | 无需唤醒（手动驱动） | 离线结算 / 单测 |
 * | `Timeline` | 父 `Clock` | 父 `Clock` | 两级时钟（世界轴 + 战斗逻辑轴） |
 *
 * ⚠️ 本文件**禁止**直接写 `Date.now()`：真实时间必须由组合根（服务端 main / 单测）
 * 通过构造函数注入，这样离线结算与单测可以随时替换成虚拟时间。
 */

import type { Clock, ClockFactory, TimerHandle } from '../contracts/ports.js';
import { ClockBase, Timeline, nextTimerIdValue, type TimeAxis } from './timeline.js';

/** 真实时间源（毫秒）。组合根注入 `() => Date.now()`。 */
export type NowSource = () => number;

/** 宿主定时器（真实 `setTimeout` / `clearTimeout` 的最小抽象，便于单测替身）。 */
export interface TimerHost {
  setTimeout(fn: () => void, delay: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** 由 `SystemTimerHost` 产出的句柄；`native` 保存平台定时器句柄。 */
export class SystemTimerHandle implements TimerHandle {
  readonly id: number = nextTimerIdValue();
  removed = false;
  native: unknown = undefined;
}

/**
 * 默认宿主：把唤醒交给平台 `setTimeout`。
 *
 * 注意：这里**不涉及** `Date.now()`（时间读数由 `RealClock` 的 `NowSource` 注入），
 * 只借用平台的定时器能力，因此不违反「禁止裸 Date.now()」的约束。
 */
export class SystemTimerHost implements TimerHost {
  setTimeout(fn: () => void, delay: number): TimerHandle {
    const handle = new SystemTimerHandle();
    const delayMs = Number.isFinite(delay) ? Math.max(0, delay) : 0;
    handle.native = globalThis.setTimeout(() => {
      // 触发即视为「已消费」，之后取消无效（与原版 `globalTimeline` 的一次性语义一致）
      handle.removed = true;
      fn();
    }, delayMs);
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    if (handle.removed) {
      return;
    }
    if (!(handle instanceof SystemTimerHandle)) {
      return;
    }
    // 收窄到 SystemTimerHandle 之后 `removed` 是可写的（实现可变属性以满足只读接口）
    handle.removed = true;
    if (handle.native !== undefined) {
      globalThis.clearTimeout(handle.native as Parameters<typeof globalThis.clearTimeout>[0]);
    }
  }
}

/**
 * 真实时间时钟：根时间轴来自注入的 `NowSource`，唤醒走 `TimerHost`。
 *
 * 语义与根 `Timeline` 完全一致（同属 `ClockBase`）：`rate` 缩放推进速度，
 * `pause()` 冻结虚拟时间，`stepPaused()` 可在暂停态手动快进。
 */
export class RealClock extends ClockBase {
  private readonly axis: TimeAxis;
  private readonly host: TimerHost;

  constructor(nowSource: NowSource, host?: TimerHost) {
    super();
    this.axis = { getTime: nowSource };
    this.host = host ?? new SystemTimerHost();
    this.captureSource();
  }

  protected override getSource(): TimeAxis {
    return this.axis;
  }

  protected override scheduleWake(delay: number): TimerHandle {
    return this.host.setTimeout(this.onWake, delay);
  }

  protected override cancelWake(handle: TimerHandle): void {
    this.host.clearTimeout(handle);
  }
}

/**
 * 虚拟时钟（手动推进）。离线结算与单测的主力：
 *
 * - `advanceBy(ms)` 手动推进 `ms` **虚拟毫秒**，并执行所有到期回调；
 * - 可选 `budget` 限制单次执行的回调数，返回**仍未推进完的虚拟毫秒**（0 = 推完），
 *   调用方循环 `left = clock.advanceBy(left, budget)` 即可分片推完；
 * - 不需要任何宿主定时器，因此完全确定、无异步。
 */
export class VirtualClock extends ClockBase {
  private readonly axis = { value: 0 };
  private readonly source: TimeAxis;

  constructor() {
    super();
    this.source = { getTime: () => this.axis.value };
    this.captureSource();
  }

  protected override getSource(): TimeAxis {
    return this.source;
  }

  /** 虚拟时钟没有宿主，scheduleWake 永不被调用（`resetWake` 已被基类统一管理）。 */
  protected override scheduleWake(): TimerHandle {
    return new SystemTimerHandle();
  }

  protected override cancelWake(): void {
    // 无宿主，无需取消。
  }

  /**
   * 手动推进 `ms` 虚拟毫秒。
   *
   * @param budget 单次调用最多执行的回调数；省略表示不限制
   * @returns 仍未推进完的虚拟毫秒（0 = 推完）
   */
  advanceBy(ms: number, budget?: number): number {
    // 速率为 0/负 等价于「冻结」：不推进（与基类 resetWake 的约定一致）。
    if (!(this.getRate() > 0)) {
      return ms > 0 ? ms : 0;
    }
    if (!(ms >= 0)) {
      return 0;
    }
    const end = this.getTime() + ms;
    // 让源轴与虚拟轴的换算关系保持自洽（rate 缩放推进速度）
    this.axis.value += ms / this.getRate();
    const limit =
      budget === undefined
        ? null
        : Number.isFinite(budget) && budget >= 0
          ? Math.floor(budget)
          : null;
    return this.runDue(end, this.axis.value, limit);
  }
}

/** 真实时间工厂：根 = `RealClock`，子 = `Timeline`。 */
export class SystemClockFactory implements ClockFactory {
  private readonly nowSource: NowSource;
  private readonly host: TimerHost | undefined;

  constructor(nowSource: NowSource, host?: TimerHost) {
    this.nowSource = nowSource;
    this.host = host;
  }

  createRoot(): Clock {
    return new RealClock(this.nowSource, this.host);
  }

  createChild(parent: Clock): Clock {
    return new Timeline(parent);
  }
}

/** 虚拟时间工厂：根 = `VirtualClock`（可直接 `advanceBy`），子 = `Timeline`。 */
export class VirtualClockFactory implements ClockFactory {
  readonly root: VirtualClock;

  constructor(root?: VirtualClock) {
    this.root = root ?? new VirtualClock();
  }

  createRoot(): Clock {
    return this.root;
  }

  createChild(parent: Clock): Clock {
    return new Timeline(parent);
  }
}
