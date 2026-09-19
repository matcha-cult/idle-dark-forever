/**
 * `rng/` —— 可重放伪随机源。
 *
 * 导出面：
 * - `Mulberry32Rng`      `Rng` 端口实现
 * - `SeededRngFactory`   `RngFactory` 端口实现（`nextSeed()` 是唯一真随机入口）
 * - `hashLabel` / `mixSeed`  供存档审计复算使用的稳定哈希原语
 */

export * from './mulberry32.js';
export * from './factory.js';
