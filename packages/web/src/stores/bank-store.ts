/**
 * BankStore —— 储藏箱（`bank` 段）。
 *
 * 服务端权威：读写接口都返回**全量格子**，本 Store 整体替换，不做本地增删。
 */
import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { InventorySlotDto } from '@idle-dark/protocol';
import { toastFailure } from '../services/game-client.js';
import { LoadGuard } from './load-guard.js';
import type { StoreContext } from './store-context.js';

export class BankStore {
  slots: InventorySlotDto[] = [];
  loading = false;
  error: string | null = null;

  private readonly guard = new LoadGuard();

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard'>(
      this,
      { ctx: false, guard: false, slots: observable.shallow },
      { autoBind: true },
    );
  }

  get size(): number {
    return this.slots.length;
  }

  async load(): Promise<void> {
    const token = this.guard.next();
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    try {
      const result = await this.ctx.api.bank.list();
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '储藏箱加载失败');
        return;
      }
      const slots = result.data ?? [];
      runInAction(() => {
        this.slots = slots;
      });
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      this.ctx.toast.fromError(error, '储藏箱加载失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  async deposit(id: string, count?: number): Promise<void> {
    await this.mutate(() => this.ctx.api.bank.deposit({ id, ...(count === undefined ? {} : { count }) }), '存入失败');
  }

  async withdraw(id: string, count?: number): Promise<void> {
    await this.mutate(() => this.ctx.api.bank.withdraw({ id, ...(count === undefined ? {} : { count }) }), '取出失败');
  }

  async expand(count: number): Promise<void> {
    await this.mutate(() => this.ctx.api.bank.expand({ count }), '储藏箱扩容失败');
  }

  private async mutate(
    action: () => Promise<import('@idle-dark/ionet-transport').ActionResult<InventorySlotDto[]>>,
    fallback: string,
  ): Promise<void> {
    try {
      const result = await action();
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, fallback);
        return;
      }
      if (Array.isArray(result.data)) {
        const slots = result.data;
        runInAction(() => {
          this.slots = slots;
        });
      }
    } catch (error) {
      this.ctx.toast.fromError(error, fallback);
    }
  }
}
