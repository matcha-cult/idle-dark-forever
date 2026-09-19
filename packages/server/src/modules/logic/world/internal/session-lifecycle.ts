/**
 * 世界会话生命周期（**纯函数**，09 §7 R1）
 *
 * 背景：会话是 `(userId, characterId)` 的内存运行时（`BattleWorld` + `Clock` + `Collector`）。
 * 玩家直接关掉浏览器后 `OnlineSessionService` 会判定离线，但**会话不会被自动释放**
 * （05 §8）—— 长期积累会一直占内存，且每轮 tick 都要遍历到它们。
 *
 * 本模块给出：
 * - **状态机**：`active → closing → destroyed`（`destroyed` 为终态，用于 dispose 幂等）；
 * - **空闲回收判定** `shouldReap`：仅当离线且空闲时长 ≥ 阈值时回收（**先 flush 再删**，
 *   绝不丢脏数据 —— 调用方负责 flush）。
 *
 * 边界：`NaN / Infinity / 负数 / 时钟回拨` 一律不误判（回拨视为空闲 0）。
 */

export type WorldSessionState = 'active' | 'closing' | 'destroyed';

export interface SessionLifecycle {
  readonly state: WorldSessionState;
  /** 最近一次确认「在线」的真实墙钟（ms）。 */
  readonly lastOnlineAt: number;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 新建会话的生命周期（`now` 非有限时按 0）。 */
export function createLifecycle(now: number): SessionLifecycle {
  return { state: 'active', lastOnlineAt: finite(now, 0) };
}

/** 确认在线：刷新 `lastOnlineAt`。终态会话保持不变。 */
export function markOnline(lifecycle: SessionLifecycle, now: number): SessionLifecycle {
  if (lifecycle.state !== 'active') return lifecycle;
  const at = finite(now, lifecycle.lastOnlineAt);
  return { state: 'active', lastOnlineAt: Math.max(lifecycle.lastOnlineAt, at) };
}

/** 进入关闭流程（`stop` 开始）。 */
export function beginClose(lifecycle: SessionLifecycle): SessionLifecycle {
  if (lifecycle.state === 'destroyed') return lifecycle;
  return { state: 'closing', lastOnlineAt: lifecycle.lastOnlineAt };
}

/** 已销毁（终态）。 */
export function markDestroyed(lifecycle: SessionLifecycle): SessionLifecycle {
  return { state: 'destroyed', lastOnlineAt: lifecycle.lastOnlineAt };
}

/** 是否终态（用于 dispose 幂等）。 */
export function isDestroyed(lifecycle: SessionLifecycle): boolean {
  return lifecycle.state === 'destroyed';
}

/**
 * 是否应回收该会话。
 *
 * @param lastOnlineAt 最近一次确认在线的时间
 * @param now 当前墙钟
 * @param idleMs 空闲阈值；`<= 0`（含 `NaN` / 负数）表示**关闭回收**
 */
export function shouldReap(lastOnlineAt: number, now: number, idleMs: number): boolean {
  const idle = finite(idleMs, 0);
  if (idle <= 0) return false;
  const last = finite(lastOnlineAt, now);
  const at = finite(now, last);
  const elapsed = at - last; // 时钟回拨 → 负数 → false
  return elapsed >= idle;
}
