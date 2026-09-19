/**
 * ProduceStore —— 生产四子页：附魔 / 重铸 / 分解 / 炼金（药剂）。
 *
 * 服务端权威：费用预览（`enchantCosts`）、执行结果（`enchant` / `rebuild` / `decompose`）、
 * 炼金状态（`medicineState`）全部以服务端返回为准；本 Store 不做任何费用计算。
 */
import { makeAutoObservable, runInAction } from 'mobx';
import type { DecomposeResultDto, EnchantCostsDto, InventorySlotDto, MedicineStateDto } from '@idle-dark/protocol';
import { toastFailure } from '../services/game-client.js';
import { LoadGuard } from './load-guard.js';
import type { StoreContext } from './store-context.js';

export type ProduceSubPage = 'enchant' | 'rebuild' | 'decompose' | 'medicine';

export class ProduceStore {
  subPage: ProduceSubPage = 'enchant';
  /** 费用预览（附魔/重铸同一入口；null = 未请求或已失效）。 */
  enchantCosts: EnchantCostsDto | null = null;
  /** 炼金状态。 */
  medicineState: MedicineStateDto | null = null;
  /** 最近一次分解结果。 */
  lastDecompose: DecomposeResultDto | null = null;
  loading = false;
  error: string | null = null;

  private readonly guard = new LoadGuard();

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard'>(this, { ctx: false, guard: false }, { autoBind: true });
  }

  setSubPage(subPage: ProduceSubPage): void {
    runInAction(() => {
      this.subPage = subPage;
    });
  }

  /** 拉取炼金状态（生产面板的基础数据）。 */
  async load(): Promise<void> {
    const token = this.guard.next();
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    try {
      const result = await this.ctx.api.produce.medicineState();
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '炼金状态加载失败');
        return;
      }
      const state = result.data ?? null;
      runInAction(() => {
        this.medicineState = state;
      });
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      this.ctx.toast.fromError(error, '炼金状态加载失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  /** 附魔费用预览（选定装备后调用；锁定词缀会改变费用）。 */
  async loadEnchantCosts(id: string): Promise<void> {
    try {
      const result = await this.ctx.api.produce.enchantCosts({ id });
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '费用预览失败');
        return;
      }
      runInAction(() => {
        this.enchantCosts = result.data ?? null;
      });
    } catch (error) {
      this.ctx.toast.fromError(error, '费用预览失败');
    }
  }

  clearCosts(): void {
    runInAction(() => {
      this.enchantCosts = null;
    });
  }

  /** 附魔（重掷词缀，可锁定）。 */
  async enchant(id: string, lockedAffixKeys?: string[]): Promise<void> {
    await this.mutateItem(
      () =>
        this.ctx.api.produce.enchant({
          id,
          ...(lockedAffixKeys === undefined ? {} : { lockedAffixKeys }),
        }),
      '附魔失败',
    );
  }

  /** 重铸单条词缀。 */
  async rebuild(id: string, affixKey: string): Promise<void> {
    await this.mutateItem(() => this.ctx.api.produce.rebuild({ id, affixKey }), '重铸失败');
  }

  /** 分解（单件 `id` 或整批 `ids`）。 */
  async decompose(input: { id?: string; ids?: string[] }): Promise<void> {
    try {
      const result = await this.ctx.api.produce.decompose(input);
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '分解失败');
        return;
      }
      const data = result.data ?? null;
      runInAction(() => {
        this.lastDecompose = data;
      });
      const materials = data?.materials ?? [];
      this.ctx.toast.success(
        '分解完成',
        materials.length === 0 ? undefined : materials.map((m) => `${m.key}×${m.count}`).join('、'),
      );
      await this.ctx.root().inventory.load();
    } catch (error) {
      this.ctx.toast.fromError(error, '分解失败');
    }
  }

  /** 投入能量材料（炼金）。 */
  async medicineUse(material: string, count?: number): Promise<void> {
    try {
      const result = await this.ctx.api.produce.medicineUse({
        material,
        ...(count === undefined ? {} : { count }),
      });
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '投入材料失败');
        return;
      }
      runInAction(() => {
        this.medicineState = result.data ?? this.medicineState;
      });
    } catch (error) {
      this.ctx.toast.fromError(error, '投入材料失败');
    }
  }

  /** 药剂重置：金币或神力。 */
  async medicineReset(currency: 'gold' | 'diamonds'): Promise<void> {
    try {
      const result = await this.ctx.api.produce.medicineReset({ currency });
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '药剂重置失败');
        return;
      }
      runInAction(() => {
        this.medicineState = result.data ?? this.medicineState;
      });
      this.ctx.toast.success('药剂已重置');
    } catch (error) {
      this.ctx.toast.fromError(error, '药剂重置失败');
    }
  }

  private async mutateItem(
    action: () => Promise<import('@idle-dark/ionet-transport').ActionResult<InventorySlotDto>>,
    fallback: string,
  ): Promise<void> {
    try {
      const result = await action();
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, fallback);
        return;
      }
      // 物品被改动：刷新背包（服务端权威），并让费用预览按新状态重算。
      await this.ctx.root().inventory.load();
      const id = result.data?.id;
      if (typeof id === 'string') await this.loadEnchantCosts(id);
    } catch (error) {
      this.ctx.toast.fromError(error, fallback);
    }
  }
}
