import { describe, expect, it } from 'vitest';

import { PrivQueue } from './priv-queue.js';

interface Item {
  at: number;
  tag: string;
}

const byAt = (a: Item, b: Item): boolean => a.at < b.at;

function drain(q: PrivQueue<Item>): string[] {
  const out: string[] = [];
  for (;;) {
    const min = q.removeMin();
    if (min === undefined) {
      break;
    }
    out.push(min.tag);
  }
  return out;
}

describe('PrivQueue', () => {
  it('空堆：minimum/removeMin 返回 undefined，size 为 0', () => {
    const q = new PrivQueue<Item>(byAt);
    expect(q.minimum()).toBeUndefined();
    expect(q.removeMin()).toBeUndefined();
    expect(q.size).toBe(0);
  });

  it('add 返回元素最终下标（首个元素为 0）', () => {
    const q = new PrivQueue<Item>(byAt);
    expect(q.add({ at: 5, tag: 'a' })).toBe(0);
    // 比堆顶大 → 停在下标 1
    expect(q.add({ at: 9, tag: 'b' })).toBe(1);
    // 比堆顶小 → 冒泡到 0
    expect(q.add({ at: 1, tag: 'c' })).toBe(0);
    expect(q.minimum()?.tag).toBe('c');
  });

  it('按比较器升序出堆', () => {
    const q = new PrivQueue<Item>(byAt);
    const input: Item[] = [
      { at: 30, tag: 'c' },
      { at: 10, tag: 'a' },
      { at: 40, tag: 'd' },
      { at: 20, tag: 'b' },
      { at: 5, tag: 'e' },
      { at: 20, tag: 'b2' },
    ];
    for (const item of input) {
      q.add(item);
    }
    expect(q.size).toBe(6);
    expect(drain(q).slice(0, 3)).toEqual(['e', 'a', 'b']);
    expect(q.size).toBe(0);
  });

  it('比较器可注入：反向比较即最大堆', () => {
    const q = new PrivQueue<Item>((a, b) => a.at > b.at);
    for (const at of [3, 9, 1, 7]) {
      q.add({ at, tag: `t${at}` });
    }
    expect(drain(q)).toEqual(['t9', 't7', 't3', 't1']);
  });

  it('交错增删保持堆序', () => {
    const q = new PrivQueue<Item>(byAt);
    q.add({ at: 10, tag: 'a' });
    q.add({ at: 20, tag: 'b' });
    q.add({ at: 30, tag: 'c' });
    expect(q.removeMin()?.tag).toBe('a');
    q.add({ at: 5, tag: 'd' });
    expect(q.removeMin()?.tag).toBe('d');
    expect(q.removeMin()?.tag).toBe('b');
    q.add({ at: 15, tag: 'e' });
    expect(drain(q)).toEqual(['e', 'c']);
  });

  it('大量元素出堆严格非递减（堆序正确性）', () => {
    const q = new PrivQueue<Item>(byAt);
    // 伪随机但确定的插入顺序（避免依赖 Math.random）
    let s = 12345;
    for (let i = 0; i < 500; i++) {
      s = (s * 1103515245 + 12345) % 2147483648;
      q.add({ at: s % 1000, tag: `t${i}` });
    }
    let prev = -Infinity;
    let count = 0;
    for (;;) {
      const min = q.removeMin();
      if (min === undefined) {
        break;
      }
      expect(min.at).toBeGreaterThanOrEqual(prev);
      prev = min.at;
      count += 1;
    }
    expect(count).toBe(500);
  });

  it('clear 清空堆', () => {
    const q = new PrivQueue<Item>(byAt);
    q.add({ at: 1, tag: 'a' });
    q.add({ at: 2, tag: 'b' });
    q.clear();
    expect(q.size).toBe(0);
    expect(q.minimum()).toBeUndefined();
  });

  it('单元素 removeMin 后堆为空（原版 length===1 分支）', () => {
    const q = new PrivQueue<Item>(byAt);
    q.add({ at: 7, tag: 'only' });
    expect(q.removeMin()?.tag).toBe('only');
    expect(q.size).toBe(0);
    expect(q.removeMin()).toBeUndefined();
  });
});
