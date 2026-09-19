/**
 * 角色经验倍率配置解析（`EXP_RATE` 环境变量）单测。
 *
 * 这个开关只该在**本地开发**生效（`dev.config.json` → `pnpm dev:server` 注入），
 * 所以必须保证：不设它就等于原版（1），并且任何写法错误都不会把数值体系打崩。
 */
import { describe, expect, it } from 'vitest';
import { EXP_RATE, EXP_RATE_MAX, parseExpRate } from '../src/modules/logic/world/world.config.js';

describe('parseExpRate', () => {
  it('缺省 / 空串 → 1（生产不设 EXP_RATE 即原版）', () => {
    expect(parseExpRate(undefined)).toBe(1);
    expect(parseExpRate(null)).toBe(1);
    expect(parseExpRate('')).toBe(1);
  });

  it('正常值：数字与字符串都接受，容许空白与小数', () => {
    expect(parseExpRate(10)).toBe(10);
    expect(parseExpRate('10')).toBe(10);
    expect(parseExpRate(' 2.5 ')).toBe(2.5);
    expect(parseExpRate(1)).toBe(1);
  });

  it('边界：上限内通过、超上限回落 1', () => {
    expect(parseExpRate(EXP_RATE_MAX)).toBe(EXP_RATE_MAX);
    expect(parseExpRate(EXP_RATE_MAX + 1)).toBe(1);
    expect(parseExpRate(Number.MAX_SAFE_INTEGER)).toBe(1);
  });

  it('非法值一律回落 1（0 / 负数 / NaN / Infinity / 非数字 / 结构化值）', () => {
    for (const bad of [0, -1, -0.5, Number.NaN, Infinity, -Infinity, 'abc', '0', '-3', {}, [], true]) {
      expect(parseExpRate(bad)).toBe(1);
    }
  });

  it('模块常量由同一函数派生（测试进程未设 EXP_RATE → 1）', () => {
    expect(EXP_RATE).toBe(parseExpRate(process.env.EXP_RATE));
    expect(EXP_RATE).toBe(1);
  });
});
