import { describe, expect, it } from 'vitest';

import type { TimerHandle } from '../contracts/ports.js';
import { RealClock, SystemClockFactory, SystemTimerHost, VirtualClock, VirtualClockFactory } from './clocks.js';
import { Timeline } from './timeline.js';
import type { TimerHost } from './clocks.js';

interface FakeTimer {
  id: number;
  at: number;
  fn: () => void;
  removed: boolean;
}

/** 可控宿主：时间由测试手动推进，回调同步执行 → 确定性单测。 */
class FakeTimerHost implements TimerHost {
  private seq = 0;
  private timers: FakeTimer[] = [];
  private time = 0;

  get now(): number {
    return this.time;
  }

  get pending(): number {
    return this.timers.filter((t) => !t.removed).length;
  }

  setTimeout(fn: () => void, delay: number): TimerHandle {
    const delayMs = Number.isFinite(delay) ? Math.max(0, delay) : 0;
    const timer: FakeTimer = { id: this.seq++, at: this.time + delayMs, fn, removed: false };
    this.timers.push(timer);
    return timer;
  }

  clearTimeout(handle: TimerHandle): void {
    (handle as FakeTimer).removed = true;
  }

  /** 推进宿主时间并执行所有到期回调（回调中新排的定时器也会被同一轮消费）。 */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => !t.removed && t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) {
        break;
      }
      due.removed = true;
      this.time = due.at;
      due.fn();
    }
    this.time = target;
  }
}

describe('VirtualClock', () => {
  it('advanceBy 精确触发到期回调（边界含等号）', () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(100), 100);
    clock.advanceBy(99);
    expect(fired).toEqual([]);
    clock.advanceBy(1);
    expect(fired).toEqual([100]);
    expect(clock.getTime()).toBe(100);
  });

  it('advanceBy(0) 刷新当前时刻的到期回调', () => {
    const clock = new VirtualClock();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('a'), 0);
    clock.advanceBy(0);
    expect(fired).toEqual(['a']);
  });

  it('rate 缩放推进速度', () => {
    const clock = new VirtualClock();
    const seen: number[] = [];
    clock.setRate(3);
    clock.setTimeout(() => seen.push(clock.getTime()), 300);
    // `advanceBy(ms)` 的 ms 是**虚拟**毫秒，与 rate 无关
    clock.advanceBy(300);
    expect(seen).toEqual([300]);
    expect(clock.getTime()).toBe(300);
  });

  it('预算分片推进（返回剩余毫秒）', () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    for (let i = 1; i <= 5; i++) {
      clock.setTimeout(() => fired.push(i), i * 10);
    }
    let rest = clock.advanceBy(100, 2);
    expect(fired).toEqual([1, 2]);
    expect(rest).toBe(80);
    rest = clock.advanceBy(rest, 2);
    expect(fired).toEqual([1, 2, 3, 4]);
    expect(rest).toBe(60);
    rest = clock.advanceBy(rest);
    expect(fired).toEqual([1, 2, 3, 4, 5]);
    expect(rest).toBe(0);
    expect(clock.getTime()).toBe(100);
  });

  it('rate <= 0 时不推进（返回全部剩余）', () => {
    const clock = new VirtualClock();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('a'), 10);
    clock.setRate(0);
    expect(clock.advanceBy(100)).toBe(100);
    expect(fired).toEqual([]);
    expect(clock.getTime()).toBe(0);
  });

  it('负推进与 NaN 推进不产生异常', () => {
    const clock = new VirtualClock();
    expect(clock.advanceBy(-100)).toBe(0);
    expect(clock.getTime()).toBe(0);
    expect(clock.advanceBy(Number.NaN)).toBe(0);
    expect(clock.getTime()).toBe(0);
  });

  it('暂停态下 advanceBy 仍然手动推进', () => {
    const clock = new VirtualClock();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('a'), 10);
    clock.pause();
    clock.advanceBy(100);
    expect(fired).toEqual(['a']);
    expect(clock.getTime()).toBe(100);
  });

  it('isPaused / getRate / pendingCount / dispose', () => {
    const clock = new VirtualClock();
    expect(clock.isPaused()).toBe(false);
    expect(clock.getRate()).toBe(1);
    clock.setTimeout(() => {}, 10);
    expect(clock.pendingCount()).toBe(1);
    clock.dispose();
    expect(clock.isDisposed()).toBe(true);
    expect(clock.pendingCount()).toBe(0);
  });
});

describe('RealClock', () => {
  it('按注入的时间源推进，边界带 0.01 对齐量', () => {
    const host = new FakeTimerHost();
    const clock = new RealClock(() => host.now, host);
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(clock.getTime()), 100);

    host.advance(100);
    expect(fired).toEqual([]);
    host.advance(0.01);
    expect(fired).toHaveLength(1);
    // 回调执行期间「现在」= 该定时器的到期时刻（离散事件语义）
    expect(fired[0]).toBe(100);
    expect(clock.getTime()).toBeCloseTo(100.01, 6);
  });

  it('rate 缩放：rate=2 时 50 真实毫秒推进 100 虚拟毫秒', () => {
    const host = new FakeTimerHost();
    const clock = new RealClock(() => host.now, host);
    const fired: number[] = [];
    clock.setRate(2);
    clock.setTimeout(() => fired.push(clock.getTime()), 100);
    host.advance(50 + 0.01);
    expect(fired).toEqual([100]);
  });

  it('pause 冻结时间且不触发回调；resume 后按剩余延迟触发', () => {
    const host = new FakeTimerHost();
    const clock = new RealClock(() => host.now, host);
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('a'), 100);

    clock.pause();
    host.advance(1000);
    expect(fired).toEqual([]);
    expect(clock.getTime()).toBe(0);

    clock.resume();
    host.advance(100 + 0.01);
    expect(fired).toEqual(['a']);
    // 虚拟时间从冻结处（0）继续，而不是墙钟绝对时间
    expect(clock.getTime()).toBeCloseTo(100.01, 5);
  });

  it('stepPaused 在暂停态按预算快进', () => {
    const host = new FakeTimerHost();
    const clock = new RealClock(() => host.now, host);
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(1), 10);
    clock.setTimeout(() => fired.push(2), 20);
    clock.pause();

    let rest = clock.stepPaused(100, 1);
    expect(fired).toEqual([1]);
    expect(rest).toBe(90);
    rest = clock.stepPaused(rest);
    expect(fired).toEqual([1, 2]);
    expect(rest).toBe(0);
    expect(clock.getTime()).toBe(100);
  });

  it('取消唤醒后不再创建宿主定时器', () => {
    const host = new FakeTimerHost();
    const clock = new RealClock(() => host.now, host);
    const handle = clock.setTimeout(() => {}, 50);
    expect(host.pending).toBe(1);
    clock.clearTimeout(handle);
    // 取消的是「业务定时器」，唤醒宿主定时器仍在（会被 wake 回调清理）
    host.advance(1000);
    expect(clock.pendingCount()).toBe(0);
  });
});

describe('SystemTimerHost', () => {
  it('在真实定时器上触发并把句柄标记为已消费', async () => {
    const host = new SystemTimerHost();
    let firedTimes = 0;
    await new Promise<void>((resolve) => {
      const handle = host.setTimeout(() => {
        firedTimes += 1;
        resolve();
      }, 0);
      expect(handle.removed).toBe(false);
    });
    expect(firedTimes).toBe(1);
  });

  it('取消后不再触发', async () => {
    const host = new SystemTimerHost();
    let fired = false;
    const handle = host.setTimeout(() => {
      fired = true;
    }, 0);
    host.clearTimeout(handle);
    expect(handle.removed).toBe(true);
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 5);
    });
    expect(fired).toBe(false);
  });
});

describe('ClockFactory', () => {
  it('SystemClockFactory：根为 RealClock，子为 Timeline', () => {
    const host = new FakeTimerHost();
    const factory = new SystemClockFactory(() => host.now, host);
    const root = factory.createRoot();
    const child = factory.createChild(root);
    expect(root).toBeInstanceOf(RealClock);
    expect(child).toBeInstanceOf(Timeline);

    const fired: string[] = [];
    child.setTimeout(() => fired.push('a'), 10);
    host.advance(11);
    expect(fired).toEqual(['a']);
  });

  it('VirtualClockFactory：根可直接 advanceBy，子时钟跟随', () => {
    const factory = new VirtualClockFactory();
    const root = factory.createRoot();
    const child = factory.createChild(root);
    expect(root).toBe(factory.root);
    expect(child).toBeInstanceOf(Timeline);

    const fired: string[] = [];
    child.setTimeout(() => fired.push('a'), 10);
    factory.root.advanceBy(10.01);
    expect(fired).toEqual(['a']);
  });

  it('VirtualClockFactory 可注入已有根时钟', () => {
    const existing = new VirtualClock();
    const factory = new VirtualClockFactory(existing);
    expect(factory.root).toBe(existing);
  });
});
