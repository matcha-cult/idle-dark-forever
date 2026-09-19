/**
 * 最小二叉堆（原版 `src/logics/PrivQueue.js` 的逐行移植）。
 *
 * 保留原版语义：
 * - `add` 返回被插入元素最终停留的下标（调用方用它判断「是否成为堆顶」——原版
 *   `Timeline.setTimeout` 正是靠 `add(...) === 0` 决定要不要重排宿主定时器）；
 * - 比较函数可注入（堆只关心「谁更小」，不关心业务字段）；
 * - `removeMin` 用「弹出末元素再下沉」的经典写法，避免额外的对象移动。
 *
 * 相对原版的两点加固（不改变堆序语义）：
 * - 空堆调用 `removeMin()` 返回 `undefined`（原版会 `bubbleDown(0, undefined)` 写入脏值）；
 * - 新增 `size` / `clear`（服务端需要能释放队列）。
 */

export type PrivQueueCompare<T> = (a: T, b: T) => boolean;

export class PrivQueue<T> {
  private readonly items: T[] = [];
  private readonly compare: PrivQueueCompare<T>;

  constructor(compare: PrivQueueCompare<T>) {
    this.compare = compare;
  }

  get size(): number {
    return this.items.length;
  }

  /** 插入并返回元素最终下标（0 表示它现在是堆顶）。 */
  add(item: T): number {
    return this.bubbleUp(this.items.length, item);
  }

  /** 堆顶（最小元素），空堆返回 undefined。 */
  minimum(): T | undefined {
    return this.items[0];
  }

  /** 弹出堆顶并返回它，空堆返回 undefined。 */
  removeMin(): T | undefined {
    const size = this.items.length;
    if (size === 0) {
      return undefined;
    }
    const min = this.items[0];
    const last = this.items.pop()!;
    if (size > 1) {
      this.bubbleDown(0, last);
    }
    return min;
  }

  clear(): void {
    this.items.length = 0;
  }

  private bubbleUp(pos: number, item: T): number {
    let position = pos;
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (this.compare(item, this.items[parent]!)) {
        this.items[position] = this.items[parent]!;
        position = parent;
      } else {
        break;
      }
    }
    this.items[position] = item;
    return position;
  }

  private bubbleDown(pos: number, item: T): number {
    let position = pos;
    for (;;) {
      let left = (position << 1) + 1;
      if (left >= this.items.length) {
        break;
      }
      if (
        left + 1 < this.items.length &&
        this.compare(this.items[left + 1]!, this.items[left]!)
      ) {
        left += 1;
      }
      if (this.compare(this.items[left]!, item)) {
        this.items[position] = this.items[left]!;
        position = left;
      } else {
        break;
      }
    }
    this.items[position] = item;
    return position;
  }
}
