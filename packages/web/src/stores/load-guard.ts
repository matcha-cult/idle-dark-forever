/**
 * 异步竞态守卫。
 *
 * 场景：用户快速连点「刷新」或切换分页/角色，先后发出两次请求；若**先发后到**（响应乱序），
 * 旧数据会覆盖新数据。MobX 侧的中间态本身由 `runInAction` 收敛，但「过期响应回写」必须显式拦。
 *
 * 用法（每个会发起加载的 action）：
 * ```ts
 * const token = this.guard.next();
 * const result = await ...;
 * if (!this.guard.isCurrent(token)) return;   // 已有更新的加载，丢弃本次结果
 * runInAction(() => { ... });
 * ```
 * `finally` 里清理 loading 也要判 `isCurrent`，否则过期的收尾会把最新一次的 loading 关掉。
 */
export class LoadGuard {
  private seq = 0;

  /** 开始一次加载，返回本次令牌。 */
  next(): number {
    this.seq += 1;
    return this.seq;
  }

  /** 令牌是否仍为最新：false 表示应丢弃本次响应。 */
  isCurrent(token: number): boolean {
    return token === this.seq;
  }

  /** 当前序号（诊断/测试用）。 */
  get current(): number {
    return this.seq;
  }
}
