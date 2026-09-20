/**
 * PlayerStore —— **服务端权威的角色态**（`PlayerStateDto` 的唯一前端持有者）。
 *
 * 纪律（工程硬约束）：本 Store 只做三件事 ——
 * 1. 保存服务端下发的 `PlayerStateDto`（整体替换，绝不字段级推算）；
 * 2. 提供只读展示用 getter（读的是服务端字段，不是计算值）；
 * 3. 转发「意图」给 typed API（刷新 / 离开角色）。
 *
 * `gainedExp` / `gainedGold` 来自世界 tick，只作为 **HUD 增量角标**展示，
 * **不写回** `state.gold` / `state.exp` —— 权威数值只认服务端下一次下发。
 */
import { makeAutoObservable, runInAction } from 'mobx';
import type { PlayerStateDto } from '@idle-dark/protocol';
import { toastFailure } from '../services/game-client.js';
import { LoadGuard } from './load-guard.js';
import type { StoreContext } from './store-context.js';

export class PlayerStore {
  /** 当前角色完整状态（未进入角色时 null）。 */
  state: PlayerStateDto | null = null;
  loading = false;
  error: string | null = null;
  /** 最近一次世界 tick 的增量（仅展示，不回写）。 */
  lastGain: { exp: number; gold: number; at: number } | null = null;

  private readonly guard = new LoadGuard();

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard'>(this, { ctx: false, guard: false }, { autoBind: true });
  }

  // ── 只读展示面（全部直接读服务端字段） ──

  get name(): string {
    return this.state?.name ?? '—';
  }

  get roleName(): string {
    return this.state?.roleName ?? '—';
  }

  get level(): number {
    return this.state?.level ?? 0;
  }

  get gold(): number {
    return this.state?.gold ?? 0;
  }

  get diamonds(): number {
    return this.state?.diamonds ?? 0;
  }

  get currentCareer(): string {
    return this.state?.currentCareer ?? '';
  }

  get map(): string {
    return this.state?.map ?? '';
  }

  /** 离线待结算时长（>0 表示需要弹结算报告）。 */
  get pendingOfflineMs(): number {
    return this.state?.pendingOfflineMs ?? 0;
  }

  get exp(): number {
    return this.state?.exp ?? 0;
  }

  get maxExp(): number {
    return this.state?.maxExp ?? 0;
  }

  get selectedSkills(): readonly string[] {
    return this.state?.selectedSkills ?? [];
  }

  get selectedEnhances(): readonly string[] {
    return this.state?.selectedEnhances ?? [];
  }

  /** 应用服务端下发的完整状态（选择角色 / 推送 / 刷新统一入口）。 */
  applyState(state: PlayerStateDto): void {
    runInAction(() => {
      this.state = state;
      this.error = null;
    });
  }

  /** 由世界 tick 记录增量角标（不写回权威字段）。 */
  noteTickGain(exp: number, gold: number, at: number): void {
    if (exp === 0 && gold === 0) return;
    runInAction(() => {
      this.lastGain = { exp, gold, at };
    });
  }

  clearGain(): void {
    runInAction(() => {
      this.lastGain = null;
    });
  }

  /** 退出角色 / 登出：清空权威态（下一次 `select` 会重建）。 */
  reset(): void {
    runInAction(() => {
      this.state = null;
      this.lastGain = null;
      this.error = null;
    });
  }

  /** 重新拉取当前角色全量状态（服务端权威，唯一刷新通道）。 */
  async load(): Promise<void> {
    const key = this.ctx.session.activePlayerKey;
    if (key === null) return;
    const token = this.guard.next();
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    try {
      const result = await this.ctx.api.player.select({ key });
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '角色状态刷新失败');
        return;
      }
      const data = result.data;
      if (data === undefined) throw new Error('角色状态响应缺少 data');
      runInAction(() => {
        this.state = data;
      });
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      this.ctx.toast.fromError(error, '角色状态刷新失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }
}
