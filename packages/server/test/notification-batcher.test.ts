import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MAX_ROUTES_PER_USER,
  NotificationBatcher,
  type BatchFlushMeta,
  type PushFrame,
} from '../src/modules/game/notification-batcher.js';

interface Capture {
  userId: number;
  frames: PushFrame[];
  meta: BatchFlushMeta;
}

function makeBatcher(options?: { flushIntervalMs?: number; maxRoutesPerUser?: number }) {
  const calls: Capture[] = [];
  const batcher = new NotificationBatcher((userId, frames, meta) => {
    calls.push({ userId, frames, meta });
  }, options);
  return { batcher, calls };
}

describe('NotificationBatcher', () => {
  let batcher: NotificationBatcher;
  let calls: Capture[];

  beforeEach(() => {
    ({ batcher, calls } = makeBatcher());
  });

  afterEach(() => {
    batcher.stop();
    vi.useRealTimers();
  });

  describe('聚合与去重', () => {
    it('同一路由多帧在一个批次内只保留一帧（默认后者覆盖）', () => {
      batcher.enqueue(7, { cmd: 30, subCmd: 5, data: { hp: 1 } });
      batcher.enqueue(7, { cmd: 30, subCmd: 5, data: { hp: 2 } });
      const sent = batcher.flushUser(7);
      expect(sent).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.frames).toHaveLength(1);
      expect(calls[0]?.frames[0]?.data).toEqual({ hp: 2 });
    });

    it('不同路由各自保留一帧', () => {
      batcher.enqueue(7, { cmd: 30, subCmd: 5, data: 1 });
      batcher.enqueue(7, { cmd: 40, subCmd: 1, data: 2 });
      batcher.enqueue(7, { cmd: 40, subCmd: 2, data: 3 });
      expect(batcher.flushUser(7)).toBe(3);
      expect(calls[0]?.frames).toHaveLength(3);
    });

    it('不同用户互不干扰', () => {
      batcher.enqueue(1, { cmd: 30, subCmd: 5, data: 'a' });
      batcher.enqueue(2, { cmd: 30, subCmd: 5, data: 'b' });
      batcher.flushUser(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.userId).toBe(1);
      expect(calls[0]?.frames[0]?.data).toBe('a');
      expect(batcher.stats.pendingUsers).toBe(1);
    });

    it('注册的 merger 生效（累积而非覆盖）', () => {
      batcher.registerMerger(30, 5, (prev, next) => ({
        events: [...((prev as { events: number[] }).events ?? []), ...((next as { events: number[] }).events ?? [])],
      }));
      batcher.enqueue(7, { cmd: 30, subCmd: 5, data: { events: [1] } });
      batcher.enqueue(7, { cmd: 30, subCmd: 5, data: { events: [2, 3] } });
      batcher.flushUser(7);
      expect(calls[0]?.frames[0]?.data).toEqual({ events: [1, 2, 3] });
    });

    it('合并时保留最新帧的 type（信封字段随新帧）', () => {
      batcher.enqueue(7, { cmd: 30, subCmd: 5, type: 'old', data: 1 });
      batcher.enqueue(7, { cmd: 30, subCmd: 5, type: 'new', data: 2 });
      batcher.flushUser(7);
      expect(calls[0]?.frames[0]?.type).toBe('new');
    });
  });

  describe('溢出与 resync（丢帧必须可被客户端发现）', () => {
    it('路由数达到上限后，新路由帧被真正丢弃且不占内存', () => {
      const { batcher: b, calls: c } = makeBatcher({ maxRoutesPerUser: 2 });
      expect(b.enqueue(7, { cmd: 30, subCmd: 1 })).toBe(true);
      expect(b.enqueue(7, { cmd: 30, subCmd: 2 })).toBe(true);
      expect(b.enqueue(7, { cmd: 30, subCmd: 3 })).toBe(false);
      expect(b.stats.pendingFrames).toBe(2); // 丢弃的帧没有进队列
      expect(b.stats.pendingOverflow).toBe(1);
      b.flushUser(7);
      expect(c[0]?.frames).toHaveLength(2);
      expect(c[0]?.meta).toEqual({ resync: true, dropped: 1 });
      b.stop();
    });

    it('已存在的路由在满队列时仍可合并（不触发溢出）', () => {
      const { batcher: b } = makeBatcher({ maxRoutesPerUser: 1 });
      b.enqueue(7, { cmd: 30, subCmd: 1, data: 1 });
      expect(b.enqueue(7, { cmd: 30, subCmd: 1, data: 2 })).toBe(true);
      expect(b.stats.dropped).toBe(0);
      b.stop();
    });

    it('溢出后 flush 报告 resync=true，且未被丢弃的帧照常投递', () => {
      const { batcher: b, calls: c } = makeBatcher({ maxRoutesPerUser: 1 });
      b.enqueue(9, { cmd: 1, subCmd: 1, data: 'kept' });
      b.enqueue(9, { cmd: 2, subCmd: 1, data: 'dropped' }); // 溢出
      b.flushUser(9);
      expect(c).toHaveLength(1);
      expect(c[0]?.frames.map((f) => f.data)).toEqual(['kept']);
      expect(c[0]?.meta).toEqual({ resync: true, dropped: 1 });
      b.stop();
    });

    it('无溢出时 meta.resync 为 false', () => {
      batcher.enqueue(7, { cmd: 30, subCmd: 1 });
      batcher.flushUser(7);
      expect(calls[0]?.meta).toEqual({ resync: false, dropped: 0 });
    });

    it('累计 stats 正确', () => {
      const { batcher: b } = makeBatcher({ maxRoutesPerUser: 1 });
      b.enqueue(7, { cmd: 1, subCmd: 1 });
      b.enqueue(7, { cmd: 2, subCmd: 1 });
      b.flushUser(7);
      expect(b.stats).toMatchObject({ flushed: 1, dropped: 1, resyncs: 1 });
      b.stop();
    });
  });

  describe('flush 语义', () => {
    it('flushUser 对空用户返回 0 且不回调', () => {
      expect(batcher.flushUser(999)).toBe(0);
      expect(calls).toHaveLength(0);
    });

    it('flushAll 汇总用户数与帧数，且清空队列', () => {
      batcher.enqueue(1, { cmd: 1, subCmd: 1 });
      batcher.enqueue(2, { cmd: 1, subCmd: 1 });
      batcher.enqueue(2, { cmd: 2, subCmd: 1 });
      expect(batcher.flushAll()).toEqual({ users: 2, frames: 3 });
      expect(batcher.stats.pendingUsers).toBe(0);
      expect(batcher.flushAll()).toEqual({ users: 0, frames: 0 });
    });

    it('flush 后同一路由可以重新入队（不残留旧帧）', () => {
      batcher.enqueue(1, { cmd: 1, subCmd: 1, data: 'old' });
      batcher.flushUser(1);
      batcher.enqueue(1, { cmd: 1, subCmd: 1, data: 'new' });
      batcher.flushUser(1);
      expect(calls[1]?.frames[0]?.data).toBe('new');
    });
  });

  describe('定时器', () => {
    it('start 后按周期自动 flush；stop 会先 flush 剩余帧', () => {
      vi.useFakeTimers();
      const { batcher: b, calls: c } = makeBatcher({ flushIntervalMs: 100 });
      b.start();
      b.enqueue(5, { cmd: 1, subCmd: 1, data: 'x' });
      expect(c).toHaveLength(0);
      vi.advanceTimersByTime(100);
      expect(c).toHaveLength(1);

      b.enqueue(5, { cmd: 1, subCmd: 2, data: 'y' });
      b.stop();
      expect(c).toHaveLength(2); // stop 前 flush 了剩余帧
      b.stop();
    });

    it('重复 start 不会叠加定时器', () => {
      vi.useFakeTimers();
      const { batcher: b, calls: c } = makeBatcher({ flushIntervalMs: 100 });
      b.start();
      b.start();
      b.enqueue(5, { cmd: 1, subCmd: 1 });
      vi.advanceTimersByTime(100);
      expect(c).toHaveLength(1);
      b.stop();
    });
  });

  describe('默认值边界', () => {
    it('非法的 flushIntervalMs / maxRoutesPerUser 回落到默认值', () => {
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const { batcher: b } = makeBatcher({ flushIntervalMs: bad, maxRoutesPerUser: bad });
        // 先用默认上限（32）灌满，确认 fallback 生效而不是「0 上限=全部丢弃」
        for (let i = 1; i <= DEFAULT_MAX_ROUTES_PER_USER; i++) {
          expect(b.enqueue(1, { cmd: 1, subCmd: i }), `bad=${String(bad)} i=${i}`).toBe(true);
        }
        expect(b.enqueue(1, { cmd: 1, subCmd: DEFAULT_MAX_ROUTES_PER_USER + 1 })).toBe(false);
        b.stop();
      }
    });

    it('userId 为 0 / 负数也不抛错（由调用方决定是否投递）', () => {
      expect(batcher.enqueue(0, { cmd: 1, subCmd: 1 })).toBe(true);
      expect(batcher.enqueue(-1, { cmd: 1, subCmd: 1 })).toBe(true);
      expect(batcher.flushAll()).toEqual({ users: 2, frames: 2 });
    });
  });
});
