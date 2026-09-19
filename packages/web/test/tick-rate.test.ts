/**
 * `(world, tick)` 频率自检的汇总逻辑单测（纯函数，无 DOM）。
 *
 * 覆盖边界：空数组、单帧、乱序、同一时刻、`serverTime` 全重复、
 * 窗口为 0/NaN、以及「频率正常但重复投递」与「不重复但过快」两种结论分流。
 */
import { describe, expect, it } from 'vitest';
import { installDevProbe, summarizeTickRate, type TickSample } from '../src/services/tick-rate.js';

function series(count: number, stepMs = 200, startAt = 0, serverTimeOf?: (i: number) => number): TickSample[] {
  return Array.from({ length: count }, (_, i) => ({
    at: startAt + i * stepMs,
    serverTime: serverTimeOf === undefined ? startAt + i * stepMs : serverTimeOf(i),
  }));
}

describe('summarizeTickRate', () => {
  it('空样本：不抛错，给出「没收到推送」的结论', () => {
    const report = summarizeTickRate([], 10_000);
    expect(report.frames).toBe(0);
    expect(report.perSecond).toBe(0);
    expect(report.gapMs).toEqual({ min: 0, p50: 0, p90: 0, max: 0 });
    expect(report.verdict).toContain('没有收到');
  });

  it('单帧：无间隔可算（全 0），但仍计频率', () => {
    const report = summarizeTickRate([{ at: 0, serverTime: 1 }], 1_000);
    expect(report.frames).toBe(1);
    expect(report.perSecond).toBe(1);
    expect(report.gapMs).toEqual({ min: 0, p50: 0, p90: 0, max: 0 });
    expect(report.duplicatedFrames).toBe(0);
  });

  it('设计频率 5Hz（200ms）：间隔中位数 200、无重复 → 判定正常', () => {
    const report = summarizeTickRate(series(50, 200), 10_000);
    expect(report.frames).toBe(50);
    expect(report.perSecond).toBe(5);
    expect(report.gapMs.min).toBe(200);
    expect(report.gapMs.p50).toBe(200);
    expect(report.gapMs.max).toBe(200);
    expect(report.duplicatedFrames).toBe(0);
    expect(report.verdict).toContain('正常');
  });

  it('乱序输入：内部排序后再算间隔（不会算出负间隔）', () => {
    const shuffled = series(10, 200).reverse();
    const report = summarizeTickRate(shuffled, 2_000);
    expect(report.gapMs.min).toBe(200);
    expect(report.gapMs.max).toBe(200);
  });

  it('同一 serverTime 重复到达 → 判定为「重复投递」并给出帧数', () => {
    // 5 帧/秒的 tick，但每帧到达两次（两个 WS 连接）
    const doubled = series(25, 200, 0, (i) => i).flatMap((sample) => [sample, { ...sample, at: sample.at + 1 }]);
    const report = summarizeTickRate(doubled, 5_000);
    expect(report.frames).toBe(50);
    expect(report.uniqueServerTimes).toBe(25);
    expect(report.duplicatedFrames).toBe(25);
    expect(report.verdict).toContain('重复投递');
  });

  it('serverTime 缺失（-1）也算重复：只在有 tick 时出现', () => {
    const report = summarizeTickRate([
      { at: 0, serverTime: -1 },
      { at: 200, serverTime: -1 },
    ], 1_000);
    expect(report.duplicatedFrames).toBe(1);
  });

  it('不重复但明显快于设计（100ms → 10Hz）→ 判定服务端过快', () => {
    const report = summarizeTickRate(series(50, 100), 5_000);
    expect(report.perSecond).toBe(10);
    expect(report.duplicatedFrames).toBe(0);
    expect(report.verdict).toContain('快于设计');
  });

  it('窗口非法（0 / NaN / 负数）不产生 NaN 频率', () => {
    for (const bad of [0, Number.NaN, -1000]) {
      const report = summarizeTickRate(series(5, 200), bad);
      expect(Number.isFinite(report.perSecond)).toBe(true);
      expect(report.perSecond).toBe(5);
    }
  });
});

// ────────────────────────── installDevProbe（浏览器侧探针） ──────────────────────────

function makeSource(): {
  source: { notifications: { onAny(handler: (frame: unknown) => void): () => void } };
  emit(frame: unknown): void;
  handlerCount(): number;
} {
  const handlers = new Set<(frame: unknown) => void>();
  return {
    source: {
      notifications: {
        onAny(handler) {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
      },
    },
    emit: (frame) => handlers.forEach((handler) => handler(frame)),
    handlerCount: () => handlers.size,
  };
}

describe('installDevProbe', () => {
  it('挂上 __IDLE_DARK__ 与 __idleDarkTickRate，卸载时清干净', () => {
    const host: Record<string, unknown> = {};
    const { source } = makeSource();
    const uninstall = installDevProbe({ tag: 'root' }, host, source);

    expect(host['__IDLE_DARK__']).toEqual({ tag: 'root' });
    expect(typeof host['__idleDarkTickRate']).toBe('function');

    uninstall();
    expect('__IDLE_DARK__' in host).toBe(false);
    expect('__idleDarkTickRate' in host).toBe(false);
  });

  it('只统计 kind=notification 且 (cmd,subCmd)=(30,5) 的帧，并识别重复 serverTime', async () => {
    const host: Record<string, unknown> = {};
    const { source, emit, handlerCount } = makeSource();
    installDevProbe({}, host, source);
    const rate = (host['__idleDarkTickRate'] as (ms?: number) => Promise<ReturnType<typeof summarizeTickRate>>)(30);

    emit({ kind: 'notification', cmd: 30, subCmd: 5, data: { serverTime: 1 } });
    emit({ kind: 'response', cmd: 30, subCmd: 5, data: { serverTime: 2 } }); // 非推送 → 忽略
    emit({ kind: 'notification', cmd: 30, subCmd: 1, data: { serverTime: 3 } }); // 别的路由 → 忽略
    emit({ kind: 'notification', cmd: 30, subCmd: 5, data: {} }); // 缺 serverTime → 记 -1
    emit({ kind: 'notification', cmd: 30, subCmd: 5, data: { serverTime: 1 } }); // 重复

    const report = await rate;
    expect(report.frames).toBe(3);
    expect(report.duplicatedFrames).toBe(1);
    expect(handlerCount()).toBe(0); // 采样结束必退订
  });

  it('同一时刻并发调用 → 直接抛错（避免两段采样互相污染）', async () => {
    const host: Record<string, unknown> = {};
    const { source } = makeSource();
    installDevProbe({}, host, source);
    const call = host['__idleDarkTickRate'] as (ms?: number) => Promise<unknown>;
    const first = call(40);
    await expect(call(10)).rejects.toThrow('上一个采样还没结束');
    await first;
  });
});
