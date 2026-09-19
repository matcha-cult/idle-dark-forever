/**
 * IdleStore —— 离线结算报告与领取。
 *
 * 服务端权威：报告（`(idle, report)`）与领取结果（`(idle, claim)`）都由服务端算好；
 * 前端只决定「要不要弹窗」。是否待领取以角色态 `pendingOfflineMs > 0` 为准。
 */
import { makeAutoObservable, runInAction } from 'mobx';
import { IDLE_CMD, type OfflineReportDto } from '@idle-dark/protocol';
import { toastFailure } from '../services/game-client.js';
import { LoadGuard } from './load-guard.js';
import type { StoreContext } from './store-context.js';

export class IdleStore {
  report: OfflineReportDto | null = null;
  loading = false;
  claiming = false;
  error: string | null = null;
  /** 报告弹窗是否已关闭（本次会话；服务端再次下发待领取时会重置）。 */
  dismissed = false;

  private readonly guard = new LoadGuard();

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard'>(
      this,
      { ctx: false, guard: false, report: observable.ref },
      { autoBind: true },
    );
  }

  /** 存在待结算离线收益（服务端字段）。 */
  get hasPending(): boolean {
    return this.ctx.root().player.pendingOfflineMs > 0;
  }

  /** 是否应弹结算报告。 */
  get shouldShowReport(): boolean {
    return this.report !== null && !this.dismissed && this.hasPending;
  }

  async load(): Promise<void> {
    const token = this.guard.next();
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    try {
      const result = await this.ctx.api.idle.report();
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '离线报告加载失败');
        return;
      }
      const report = result.data ?? null;
      runInAction(() => {
        this.report = report;
        this.dismissed = false;
      });
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      this.ctx.toast.fromError(error, '离线报告加载失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  /** 领取离线收益（服务端返回结算后的报告）。 */
  async claim(): Promise<void> {
    runInAction(() => {
      this.claiming = true;
    });
    try {
      const result = await this.ctx.api.idle.claim();
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '领取离线收益失败');
        return;
      }
      runInAction(() => {
        this.report = result.data ?? this.report;
        this.dismissed = true;
      });
      this.ctx.toast.success('离线收益已领取');
      await this.ctx.root().player.load();
    } catch (error) {
      this.ctx.toast.fromError(error, '领取离线收益失败');
    } finally {
      runInAction(() => {
        this.claiming = false;
      });
    }
  }

  /** 仅仅关闭弹窗（不领取）。 */
  dismiss(): void {
    runInAction(() => {
      this.dismissed = true;
    });
  }

  /** `(idle, *)` 推送：重新拉取报告（服务端可能刚结算完离线收益）。 */
  handleNotification(frame: unknown): void {
    const notification = frame as { cmd?: number; subCmd?: number };
    if (notification.cmd !== IDLE_CMD.cmd) return;
    void this.load();
  }
}
