/**
 * 关联逻辑单测：reqId 精确配对 / 无 reqId 的 FIFO 回退 / 无匹配不回退 FIFO。
 * 算法本体来自 `@nbb-ionet/client-protocol`（此处只验证本包的门面与策略语义）。
 */
import { describe, expect, it } from 'vitest';
import { Correlation } from '../client/correlation.js';

describe('Correlation —— reqId 策略（默认）', () => {
  it('每个请求生成唯一 reqId', () => {
    let n = 0;
    const correlation = new Correlation('reqId', () => `r-${++n}`);
    const a = correlation.begin();
    const b = correlation.begin();
    expect(a.reqId).toBe('r-1');
    expect(b.reqId).toBe('r-2');
    expect(a.pending.seq).toBe(1);
    expect(b.pending.seq).toBe(2);
    expect(correlation.pendingCount).toBe(2);
  });

  it('携带 reqId 的响应精确配对（与到达顺序无关）', () => {
    let n = 0;
    const correlation = new Correlation('reqId', () => `r-${++n}`);
    const first = correlation.begin();
    const second = correlation.begin();

    // 后发的先回：
    const hitSecond = correlation.associate({ reqId: second.reqId });
    expect(hitSecond.ok).toBe(true);
    if (!hitSecond.ok) return;
    expect(hitSecond.pending.seq).toBe(second.pending.seq);
    expect(hitSecond.by).toBe('reqId');

    const hitFirst = correlation.associate({ reqId: first.reqId });
    expect(hitFirst.ok).toBe(true);
    if (!hitFirst.ok) return;
    expect(hitFirst.pending.seq).toBe(first.pending.seq);
    expect(correlation.pendingCount).toBe(0);
  });

  it('reqId 无匹配 → miss，且**不**回退 FIFO（避免错配）', () => {
    const correlation = new Correlation('reqId', () => 'r-known');
    const pending = correlation.begin();
    const miss = correlation.associate({ reqId: 'r-unknown' });
    expect(miss.ok).toBe(false);
    if (miss.ok) return;
    expect(miss.reason).toBe('no-reqid-match');
    expect(correlation.pendingCount).toBe(1);
    // 原有在途仍可被自己的 reqId 命中：
    const hit = correlation.associate({ reqId: pending.reqId });
    expect(hit.ok).toBe(true);
  });

  it('无在途请求时回响应 → no-pending', () => {
    const correlation = new Correlation('reqId', () => 'r-1');
    const miss = correlation.associate({ data: {} });
    expect(miss.ok).toBe(false);
    if (miss.ok) return;
    expect(miss.reason).toBe('no-pending');
  });
});

describe('Correlation —— serial 策略（无 reqId 的 FIFO 回退）', () => {
  it('请求不带 reqId，响应按最早在途 FIFO 消费', () => {
    const correlation = new Correlation('serial');
    const a = correlation.begin();
    const b = correlation.begin();
    expect(a.reqId).toBeUndefined();
    expect(b.reqId).toBeUndefined();

    const first = correlation.associate({ data: { n: 1 } });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.by).toBe('fifo');
    expect(first.pending.seq).toBe(a.pending.seq);

    const second = correlation.associate({ data: { n: 2 } });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.pending.seq).toBe(b.pending.seq);
    expect(correlation.pendingCount).toBe(0);
  });

  it('未决集合被 drain 后，响应无法关联', () => {
    const correlation = new Correlation('serial');
    correlation.begin();
    const drained = correlation.drain();
    expect(drained).toHaveLength(1);
    expect(correlation.pendingCount).toBe(0);
    const miss = correlation.associate({ data: {} });
    expect(miss.ok).toBe(false);
  });
});

describe('Correlation —— drain（连接断开时清空全部在途）', () => {
  it('drain 返回全部在途并清空', () => {
    let n = 0;
    const correlation = new Correlation('reqId', () => `r-${++n}`);
    correlation.begin();
    correlation.begin();
    const drained = correlation.drain();
    expect(drained.map((p) => p.seq)).toEqual([1, 2]);
    expect(correlation.pendingCount).toBe(0);
    // 再次 begin 后 seq 继续递增（不会被 drain 重置，避免句柄复用）：
    expect(correlation.begin().pending.seq).toBe(3);
  });
});
