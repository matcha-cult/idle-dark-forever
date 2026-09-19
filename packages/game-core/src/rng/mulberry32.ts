/**
 * 可重放伪随机源：mulberry32。
 *
 * 为什么不是 `Math.random()`：原版《永夜》全仓库直接调用 `Math.random()`
 * （掉落品质、词缀、暴击、闪避、刷怪位置、炼金随机…）。服务端权威化之后必须
 * 「同样的种子 → 同样的序列」，否则离线结算无法审计、单测无法稳定、作弊无法复算。
 *
 * 选择 mulberry32 的理由：
 * - 状态只有一个 32 位整数 → 存档 / 审计 / 快照成本为零；
 * - 全部运算基于 `Math.imul` 与位运算，**在任何 JS 引擎上都逐位一致**（不依赖浮点 sin/cos）；
 * - 周期 2^32、分布质量足够掉落/暴击这类用途。
 *
 * ⚠️ 本文件**禁止**出现 `Math.random()` / `Date.now()`。
 */

import type { Rng } from '../contracts/ports.js';

/** FNV-1a 32 位：把 fork 标签映射成稳定整数（不受 locale / 编码环境影响）。 */
export function hashLabel(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    // h *= 16777619，用 imul 保证 32 位精确
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 由（父种子, 标签哈希）派生子种子。
 *
 * 用 splitmix32 风格的两轮 avalanche，保证相邻标签 / 相邻种子不会产生相关的子序列。
 */
export function mixSeed(seed: number, labelHash: number): number {
  let h = (seed ^ Math.imul(labelHash, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export class Mulberry32Rng implements Rng {
  /** 内部状态：始终是无符号 32 位。 */
  private state: number;

  constructor(seed: number) {
    // `>>> 0` 同时把 NaN / Infinity / 负数 规整为确定的 uint32（NaN → 0）
    this.state = Number.isFinite(seed) ? seed >>> 0 : 0;
  }

  next(): number {
    let a = (this.state + 0x6d2b79f5) >>> 0;
    this.state = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) —— 与原版 `Math.random() * (max - min) + min` 的用法等价。 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [0, n) 整数；`n <= 0` 时返回 0（原版 `(Math.random() * n) | 0` 在 n<=0 时也是 0）。 */
  int(n: number): number {
    if (!(n > 0)) {
      return 0;
    }
    return Math.floor(this.next() * n);
  }

  /**
   * 派生独立子序列。**不推进父状态**——这是刻意的：
   * 同一父种子 + 同一标签必须永远得到同一段序列，这样「掉落 / 词缀 / 暴击 / 刷怪」
   * 可以各自独立重放，互不干扰。
   */
  fork(label: string): Rng {
    return new Mulberry32Rng(mixSeed(this.state, hashLabel(label)));
  }

  getSeed(): number {
    return this.state >>> 0;
  }
}
