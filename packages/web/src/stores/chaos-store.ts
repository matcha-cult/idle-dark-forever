/**
 * ChaosStore —— 混沌仪（无尽，W6）。
 *
 * 服务端权威：T 阶 / 等级 / 钥石持有量 / 当前阶 / 连续失败数全部来自 `ChaosStateDto`；
 * 前端只维护「正在编辑的钥石序列草稿」这一份纯 UI 意图，保存时原样交给服务端校验。
 * 行为（消耗钥石、进度推进、离线推进）一律由服务端结算。
 */
import { makeAutoObservable, observable, runInAction } from 'mobx';
import { CHAOS_CMD, type ChaosFailMode, type ChaosStateDto } from '@idle-dark/protocol';
import { toastFailure } from '../services/game-client.js';
import { LoadGuard } from './load-guard.js';
import type { StoreContext } from './store-context.js';

export class ChaosStore {
  state: ChaosStateDto | null = null;
  /** 正在编辑的钥石序列（未保存）；`load` / 保存成功后与服务端对齐。 */
  sequenceDraft: string[] = [];
  /** 草稿是否有未保存的改动。 */
  dirty = false;
  loading = false;
  saving = false;
  busy = false;
  error: string | null = null;

  private readonly guard = new LoadGuard();

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard'>(
      this,
      { ctx: false, guard: false, state: observable.ref, sequenceDraft: observable.ref },
      { autoBind: true },
    );
  }

  get unlocked(): boolean {
    return this.state?.unlocked === true;
  }

  get active(): boolean {
    return this.state?.active === true;
  }

  get failMode(): ChaosFailMode {
    return this.state?.failMode ?? 'normal';
  }

  /** 序列上限（= 阶位数，服务端下发；前端不硬编码 16）。 */
  get maxSequenceLength(): number {
    return this.state?.tiers.length ?? 0;
  }

  get canAddMore(): boolean {
    return this.sequenceDraft.length < this.maxSequenceLength;
  }

  async load(): Promise<void> {
    const token = this.guard.next();
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    try {
      const result = await this.ctx.api.chaos.state();
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '混沌仪状态加载失败');
        return;
      }
      this.applyState(result.data ?? null);
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      this.ctx.toast.fromError(error, '混沌仪状态加载失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  /** 追加一把钥石到草稿末尾（允许重复；受服务端下发的阶位数上限约束）。 */
  addToSequence(keystoneKey: string): void {
    if (typeof keystoneKey !== 'string' || keystoneKey === '') return;
    if (!this.canAddMore) return;
    runInAction(() => {
      this.sequenceDraft = [...this.sequenceDraft, keystoneKey];
      this.dirty = true;
    });
  }

  removeFromSequence(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.sequenceDraft.length) return;
    runInAction(() => {
      this.sequenceDraft = this.sequenceDraft.filter((_, i) => i !== index);
      this.dirty = true;
    });
  }

  moveInSequence(index: number, delta: number): void {
    const target = index + delta;
    if (!Number.isInteger(index) || !Number.isInteger(target)) return;
    if (index < 0 || index >= this.sequenceDraft.length) return;
    if (target < 0 || target >= this.sequenceDraft.length) return;
    runInAction(() => {
      const next = [...this.sequenceDraft];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      this.sequenceDraft = next;
      this.dirty = true;
    });
  }

  clearSequence(): void {
    runInAction(() => {
      this.sequenceDraft = [];
      this.dirty = true;
    });
  }

  /** 保存序列（服务端校验非法 key / 超长）。 */
  async saveSequence(): Promise<void> {
    runInAction(() => {
      this.saving = true;
    });
    try {
      const result = await this.ctx.api.chaos.setSequence({ sequence: this.sequenceDraft });
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '保存钥石序列失败');
        return;
      }
      this.applyState(result.data ?? null);
      this.ctx.toast.success('钥石序列已保存');
    } catch (error) {
      this.ctx.toast.fromError(error, '保存钥石序列失败');
    } finally {
      runInAction(() => {
        this.saving = false;
      });
    }
  }

  async setFailMode(failMode: ChaosFailMode): Promise<void> {
    try {
      const result = await this.ctx.api.chaos.setFailMode({ failMode });
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '设置失败选项失败');
        return;
      }
      this.applyState(result.data ?? null);
    } catch (error) {
      this.ctx.toast.fromError(error, '设置失败选项失败');
    }
  }

  async start(): Promise<void> {
    await this.mutate(() => this.ctx.api.chaos.start(), '启动混沌仪失败');
  }

  async stop(): Promise<void> {
    await this.mutate(() => this.ctx.api.chaos.stop(), '停止混沌仪失败');
  }

  /** `(chaos, *)` 推送：重新拉取状态（当前无推送，保留统一路由形状）。 */
  handleNotification(frame: unknown): void {
    const notification = frame as { cmd?: number };
    if (notification.cmd !== CHAOS_CMD.cmd) return;
    void this.load();
  }

  private async mutate(
    action: () => Promise<import('@idle-dark/ionet-transport').ActionResult<ChaosStateDto>>,
    fallback: string,
  ): Promise<void> {
    runInAction(() => {
      this.busy = true;
    });
    try {
      const result = await action();
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, fallback);
        return;
      }
      this.applyState(result.data ?? null);
    } catch (error) {
      this.ctx.toast.fromError(error, fallback);
    } finally {
      runInAction(() => {
        this.busy = false;
      });
    }
  }

  private applyState(state: ChaosStateDto | null): void {
    runInAction(() => {
      this.state = state;
      this.sequenceDraft = state === null ? [] : [...state.sequence];
      this.dirty = false;
    });
  }
}
