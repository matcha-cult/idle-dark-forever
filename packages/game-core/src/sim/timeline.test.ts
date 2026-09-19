import { describe, expect, it } from 'vitest';

import { DEFAULT_STEP_BUDGET, Timeline } from './timeline.js';
import { VirtualClock } from './clocks.js';

/**
 * 子时钟通过 `parent.setTimeout(onWake, (at - now)/rate + 0.01)` 唤醒父时钟，
 * 因此边界断言要带上原版的 +0.01 对齐量。
 */
const WAKE_EPSILON = 0.01;

function makePair(): { root: VirtualClock; clock: Timeline } {
  const root = new VirtualClock();
  return { root, clock: new Timeline(root) };
}

describe('Timeline（子时钟）', () => {
  it('初始虚拟时间为 0', () => {
    const { clock } = makePair();
    expect(clock.getTime()).toBe(0);
    expect(clock.getRate()).toBe(1);
    expect(clock.isPaused()).toBe(false);
    expect(clock.pendingCount()).toBe(0);
  });

  it('到期回调按虚拟时间触发，且不会提前', () => {
    const { root, clock } = makePair();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('a'), 1000);

    root.advanceBy(1000);
    expect(fired).toEqual([]);

    root.advanceBy(WAKE_EPSILON);
    expect(fired).toEqual(['a']);
  });

  it('多个定时器按到期顺序触发', () => {
    const { root, clock } = makePair();
    const order: number[] = [];
    clock.setTimeout(() => order.push(30), 30);
    clock.setTimeout(() => order.push(10), 10);
    clock.setTimeout(() => order.push(20), 20);

    root.advanceBy(1000);
    expect(order).toEqual([10, 20, 30]);
  });

  it('回调内读到的时间 = 到期时刻（原版 current 语义）', () => {
    const { root, clock } = makePair();
    const seen: number[] = [];
    clock.setTimeout(() => seen.push(clock.getTime()), 500);
    root.advanceBy(1000);
    expect(seen).toEqual([500]);
  });

  it('回调内新增的、当轮已到期的定时器会被同一轮消费（原版 for(;;) 语义）', () => {
    const { root, clock } = makePair();
    const order: string[] = [];
    clock.setTimeout(() => {
      order.push('first');
      clock.setTimeout(() => order.push('nested'), 0);
    }, 100);
    root.advanceBy(1000);
    expect(order).toEqual(['first', 'nested']);
  });

  it('回调内新增的、超出本轮 end 的定时器留到下一轮', () => {
    const { root, clock } = makePair();
    const order: string[] = [];
    clock.setTimeout(() => {
      order.push('first');
      clock.setTimeout(() => order.push('later'), 10000);
    }, 100);
    root.advanceBy(1000);
    expect(order).toEqual(['first']);
    root.advanceBy(20000);
    expect(order).toEqual(['first', 'later']);
  });

  it('rate 缩放推进速度（rate=2 → 500 源毫秒推进 1000 虚拟毫秒）', () => {
    const { root, clock } = makePair();
    const fired: number[] = [];
    clock.setRate(2);
    clock.setTimeout(() => fired.push(clock.getTime()), 1000);

    root.advanceBy(500);
    expect(fired).toEqual([]);
    root.advanceBy(WAKE_EPSILON);
    expect(fired).toEqual([1000]);
  });

  it('rate 变化立即生效并重排唤醒', () => {
    const { root, clock } = makePair();
    const fired: number[] = [];
    clock.setRate(4);
    clock.setTimeout(() => fired.push(1), 4000);
    root.advanceBy(1000 + WAKE_EPSILON);
    expect(fired).toEqual([1]);
  });

  it('rate <= 0 不排唤醒（避免 Infinity/负延迟）且不报错', () => {
    const { root, clock } = makePair();
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(1), 100);
    clock.setRate(0);
    root.advanceBy(100000);
    expect(fired).toEqual([]);
    expect(clock.getRate()).toBe(0);
  });

  it('pause 冻结虚拟时间；resume 从冻结处继续', () => {
    const { root, clock } = makePair();
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(1), 100);

    root.advanceBy(50);
    clock.pause();
    expect(clock.isPaused()).toBe(true);
    expect(clock.getTime()).toBe(50);

    root.advanceBy(10000);
    expect(clock.getTime()).toBe(50);
    expect(fired).toEqual([]);

    clock.resume();
    expect(clock.isPaused()).toBe(false);
    root.advanceBy(50 + WAKE_EPSILON);
    expect(fired).toEqual([1]);
    // 原版 `resetTimer` 的 +0.01 对齐量会累积进虚拟时间
    expect(clock.getTime()).toBeCloseTo(100 + WAKE_EPSILON, 5);
  });

  it('重复 pause / resume 是幂等的', () => {
    const { root, clock } = makePair();
    root.advanceBy(10);
    clock.pause();
    clock.pause();
    expect(clock.getTime()).toBe(10);
    clock.resume();
    clock.resume();
    expect(clock.isPaused()).toBe(false);
    root.advanceBy(10);
    expect(clock.getTime()).toBe(20);
  });

  it('暂停态 setRate 不会偷偷推进时间', () => {
    const { root, clock } = makePair();
    root.advanceBy(100);
    clock.pause();
    root.advanceBy(100000);
    clock.setRate(2);
    expect(clock.getTime()).toBe(100);
  });

  it('嵌套两级时钟：父 rate 影响子时钟推进', () => {
    const root = new VirtualClock();
    const world = new Timeline(root);
    const logic = new Timeline(world);

    const fired: number[] = [];
    logic.setTimeout(() => fired.push(logic.getTime()), 1000);

    root.advanceBy(1000);
    expect(fired).toEqual([]);
    root.advanceBy(WAKE_EPSILON * 2 + 1);
    expect(fired).toEqual([1000]);
  });

  it('clearTimeout 取消后不再触发', () => {
    const { root, clock } = makePair();
    const fired: string[] = [];
    const handle = clock.setTimeout(() => fired.push('a'), 10);
    clock.clearTimeout(handle);
    expect(handle.removed).toBe(true);
    root.advanceBy(1000);
    expect(fired).toEqual([]);
  });

  it('clearTimeout 取消堆顶后，次早的定时器仍按时触发', () => {
    const { root, clock } = makePair();
    const fired: string[] = [];
    const h1 = clock.setTimeout(() => fired.push('a'), 10);
    clock.setTimeout(() => fired.push('b'), 20);
    clock.clearTimeout(h1);
    root.advanceBy(1000);
    expect(fired).toEqual(['b']);
  });

  it('dispose 之后不再触发任何回调', () => {
    const { root, clock } = makePair();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('a'), 10);
    clock.dispose();
    expect(clock.isDisposed()).toBe(true);
    root.advanceBy(1000);
    expect(fired).toEqual([]);
    expect(clock.pendingCount()).toBe(0);
  });

  it('dispose 幂等', () => {
    const { clock } = makePair();
    clock.dispose();
    clock.dispose();
    expect(clock.isDisposed()).toBe(true);
  });
});

describe('Timeline.setTimeout 入参校验', () => {
  it('NaN 延迟抛错（原版行为）', () => {
    const { clock } = makePair();
    expect(() => clock.setTimeout(() => {}, Number.NaN)).toThrow('Invalid delay.');
  });

  it('非数字延迟抛错', () => {
    const { clock } = makePair();
    expect(() => clock.setTimeout(() => {}, 'abc' as unknown as number)).toThrow('Invalid delay.');
  });

  it('0 与负延迟都立即到期', () => {
    const { root, clock } = makePair();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('zero'), 0);
    clock.setTimeout(() => fired.push('neg'), -5);
    clock.tryUpdate();
    expect(fired).toEqual(['zero', 'neg']);
  });

  it('Infinity 延迟永不触发（原版语义）', () => {
    const { root, clock } = makePair();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('inf'), Number.POSITIVE_INFINITY);
    root.advanceBy(1e9);
    expect(fired).toEqual([]);
  });
});

describe('Timeline.stepPaused（离线快进 + 事件预算）', () => {
  it('未 pause 时抛错', () => {
    const { clock } = makePair();
    expect(() => clock.stepPaused(100)).toThrow(/paused clock/);
  });

  it('预算 1 时逐次推进并返回剩余毫秒', () => {
    const { clock } = makePair();
    clock.pause();
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(10), 10);
    clock.setTimeout(() => fired.push(20), 20);
    clock.setTimeout(() => fired.push(30), 30);

    let rest = clock.stepPaused(100, 1);
    expect(fired).toEqual([10]);
    expect(rest).toBe(90);

    rest = clock.stepPaused(rest, 1);
    expect(fired).toEqual([10, 20]);
    expect(rest).toBe(80);

    rest = clock.stepPaused(rest);
    expect(fired).toEqual([10, 20, 30]);
    expect(rest).toBe(0);
    expect(clock.getTime()).toBe(100);
  });

  it('预算 0 时不执行任何回调，返回全部剩余', () => {
    const { clock } = makePair();
    clock.pause();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('a'), 1);
    expect(clock.stepPaused(100, 0)).toBe(100);
    expect(fired).toEqual([]);
  });

  it('预算为非法值（NaN / Infinity / 负数）时回退为默认预算', () => {
    const { clock } = makePair();
    clock.pause();
    const fired: string[] = [];
    for (let i = 1; i <= 3; i++) {
      clock.setTimeout(() => fired.push(i), i);
    }
    expect(clock.stepPaused(100, Number.NaN)).toBe(0);
    expect(fired).toEqual([1, 2, 3]);
    expect(DEFAULT_STEP_BUDGET).toBeGreaterThan(0);
  });

  it('预算超过实际回调数时一次推完', () => {
    const { clock } = makePair();
    clock.pause();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push(1), 1);
    expect(clock.stepPaused(100, DEFAULT_STEP_BUDGET)).toBe(0);
    expect(fired).toEqual([1]);
  });

  it('回调内新增的、当轮已到期的定时器会被同一轮消费', () => {
    const { clock } = makePair();
    clock.pause();
    const order: string[] = [];
    clock.setTimeout(() => {
      order.push('first');
      clock.setTimeout(() => order.push('nested'), 5);
    }, 1);
    const rest = clock.stepPaused(100, 5);
    expect(rest).toBe(0);
    expect(order).toEqual(['first', 'nested']);
  });

  it('被取消的定时器不占预算但会被跳过', () => {
    const { clock } = makePair();
    clock.pause();
    const fired: string[] = [];
    const h = clock.setTimeout(() => fired.push('cancel'), 1);
    clock.clearTimeout(h);
    clock.setTimeout(() => fired.push('ok'), 2);
    expect(clock.stepPaused(100, 1)).toBe(0);
    expect(fired).toEqual(['ok']);
  });

  it('分片推进的总效果与一次推完一致', () => {
    const { clock } = makePair();
    clock.pause();
    const a: number[] = [];
    for (let i = 1; i <= 20; i++) {
      clock.setTimeout(() => a.push(i), i * 10);
    }
    let rest = 200;
    let guard = 0;
    while (rest > 0 && guard++ < 100) {
      rest = clock.stepPaused(rest, 3);
    }
    expect(rest).toBe(0);
    expect(a).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(clock.getTime()).toBe(200);
  });
});
