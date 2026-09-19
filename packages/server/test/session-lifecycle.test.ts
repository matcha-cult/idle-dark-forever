/**
 * 世界会话生命周期纯函数单测（09 §7 R1）
 *
 * 覆盖状态机迁移、终态幂等、空闲回收判定的全部边界（0 / 负数 / NaN / 时钟回拨 / 恰好等于）。
 */
import { describe, expect, it } from 'vitest';
import {
  beginClose,
  createLifecycle,
  isDestroyed,
  markDestroyed,
  markOnline,
  shouldReap,
} from '../src/modules/logic/world/internal/session-lifecycle.js';

describe('会话状态机', () => {
  it('createLifecycle：active + 时间；NaN → 0', () => {
    expect(createLifecycle(1_000)).toEqual({ state: 'active', lastOnlineAt: 1_000 });
    expect(createLifecycle(Number.NaN)).toEqual({ state: 'active', lastOnlineAt: 0 });
    expect(createLifecycle(Number.POSITIVE_INFINITY).lastOnlineAt).toBe(0);
  });

  it('markOnline：刷新时间且不回退；非 active 保持不变', () => {
    let l = createLifecycle(1_000);
    l = markOnline(l, 2_000);
    expect(l.lastOnlineAt).toBe(2_000);
    // 时钟回拨不后退
    l = markOnline(l, 500);
    expect(l.lastOnlineAt).toBe(2_000);
    // NaN 不破坏已有值
    expect(markOnline(l, Number.NaN).lastOnlineAt).toBe(2_000);
    // closing 后不再刷新
    const closing = beginClose(l);
    expect(markOnline(closing, 9_999).lastOnlineAt).toBe(2_000);
  });

  it('beginClose / markDestroyed：终态不可逆，destroyed 幂等', () => {
    const active = createLifecycle(0);
    const closing = beginClose(active);
    expect(closing.state).toBe('closing');
    const destroyed = markDestroyed(closing);
    expect(isDestroyed(destroyed)).toBe(true);
    // destroyed 再 close / destroy 不变
    expect(beginClose(destroyed).state).toBe('destroyed');
    expect(markDestroyed(destroyed).state).toBe('destroyed');
  });
});

describe('shouldReap', () => {
  it('阈值 <= 0 / NaN → 关闭回收（恒 false）', () => {
    expect(shouldReap(0, 10_000_000, 0)).toBe(false);
    expect(shouldReap(0, 10_000_000, -1)).toBe(false);
    expect(shouldReap(0, 10_000_000, Number.NaN)).toBe(false);
  });

  it('未达阈值 → false；恰好等于 / 超过 → true', () => {
    expect(shouldReap(1_000, 1_999, 1_000)).toBe(false);
    expect(shouldReap(1_000, 2_000, 1_000)).toBe(true);
    expect(shouldReap(1_000, 2_001, 1_000)).toBe(true);
  });

  it('时钟回拨（now < lastOnlineAt）→ false（不误回收）', () => {
    expect(shouldReap(2_000, 1_000, 1_000)).toBe(false);
  });

  it('NaN 输入 → 不崩且不误回收', () => {
    expect(shouldReap(Number.NaN, 1_000_000, 1_000)).toBe(false); // last 回落 now → elapsed 0
    expect(shouldReap(0, Number.NaN, 1_000)).toBe(false); // now 回落 last → elapsed 0
    expect(shouldReap(0, Number.POSITIVE_INFINITY, 1_000)).toBe(false);
  });
});
