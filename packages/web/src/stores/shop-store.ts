/**
 * ShopStore —— 神力商店（原内购页）：角色栏位扩容 + 神力搬运。
 *
 * 服务端权威：所有价格、可兑换项、当前神力都由 `(shop, state)` 下发；写操作返回同一状态体。
 */
import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { ShopStateDto } from '@idle-dark/protocol';
import { toastFailure } from '../services/game-client.js';
import { LoadGuard } from './load-guard.js';
import type { StoreContext } from './store-context.js';

export class ShopStore {
  state: ShopStateDto | null = null;
  loading = false;
  error: string | null = null;

  private readonly guard = new LoadGuard();

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard'>(
      this,
      { ctx: false, guard: false, state: observable.ref },
      { autoBind: true },
    );
  }

  async load(): Promise<void> {
    const token = this.guard.next();
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    try {
      const result = await this.ctx.api.shop.state();
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '商店状态加载失败');
        return;
      }
      const state = result.data ?? null;
      runInAction(() => {
        this.state = state;
      });
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      this.ctx.toast.fromError(error, '商店状态加载失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  async buyPlayerSlot(): Promise<void> {
    await this.mutate(() => this.ctx.api.shop.buyPlayerSlot(), '购买角色栏位失败', '已购买角色栏位');
  }

  async exchange(from: string, to: string, count?: number): Promise<void> {
    await this.mutate(
      () => this.ctx.api.shop.exchange({ from, to, ...(count === undefined ? {} : { count }) }),
      '兑换失败',
      '兑换完成',
    );
  }

  private async mutate(
    action: () => Promise<import('@idle-dark/ionet-transport').ActionResult<ShopStateDto>>,
    fallback: string,
    successTitle: string,
  ): Promise<void> {
    try {
      const result = await action();
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, fallback);
        return;
      }
      runInAction(() => {
        this.state = result.data ?? this.state;
      });
      this.ctx.toast.success(successTitle);
      // 神力是账号级资源，角色态里的副本需要同步。
      void this.ctx.root().player.load();
      void this.ctx.root().session.loadMe();
    } catch (error) {
      this.ctx.toast.fromError(error, fallback);
    }
  }
}
