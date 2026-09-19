/**
 * 随机源工厂。
 *
 * `nextSeed()` 是整个 game-core 里**唯一**允许使用真随机的地方：
 * 它是「新一场战斗 / 新一次掉落的种子从哪来」的入口，必须真随机；
 * 一旦种子确定，后续所有随机都走 `Mulberry32Rng`，保证可重放。
 */

import type { Rng, RngFactory } from '../contracts/ports.js';
import { Mulberry32Rng } from './mulberry32.js';

/** 浏览器 / Node 20+ 都存在的 WebCrypto 形状（只取用得到的部分，避免依赖 DOM lib）。 */
interface CryptoLike {
  getRandomValues?: (array: Uint32Array) => Uint32Array;
}

export class SeededRngFactory implements RngFactory {
  /** 固定种子工厂（测试 / 复算用）：同一个 seed 必然产生同一序列。 */
  create(seed: number): Rng {
    return new Mulberry32Rng(seed);
  }

  /**
   * 生成新的战斗种子。
   *
   * 真随机来源优先级：
   * 1. `globalThis.crypto.getRandomValues`（密码学安全，Node 20+ / 浏览器都有）；
   * 2. 回退 `Math.random()`——本行是 game-core 中**唯一**被允许的裸随机调用，
   *    因为它只负责「产生种子」，不参与任何可重放的数值计算。若回退被使用，
   *    等价于牺牲「服务端可预测审计」而非正确性。
   */
  nextSeed(): number {
    const cryptoLike = (globalThis as { crypto?: CryptoLike }).crypto;
    if (cryptoLike && typeof cryptoLike.getRandomValues === 'function') {
      const buf = new Uint32Array(1);
      cryptoLike.getRandomValues(buf);
      const v = buf[0];
      if (typeof v === 'number' && Number.isFinite(v)) {
        return v >>> 0;
      }
    }
    return Math.floor(Math.random() * 0x100000000) >>> 0;
  }

  /**
   * 由一段文本派生确定性种子（替代原版 `md5(Date.now() + '.' + Math.random())` 的确定性版本）。
   * 用于「同一份存档导入两次必须得到同样的掉落复算」这类场景。
   */
  seedFromText(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
}
