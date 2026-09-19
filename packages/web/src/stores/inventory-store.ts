/**
 * InventoryStore —— 包裹 / 装备栏 / 建造背包 / 奖励背包 + 自动拾取规则。
 *
 * 服务端权威：`(inventory, list)` 返回**全量格子**（`position` 区分容器），本 Store 原样保存，
 * 只提供**只读筛选**（背包 / 装备栏 / 建造 / 奖励）供面板渲染；任何操作成功后
 * 都用服务端返回的最新格子**整体替换**，绝不本地增删。
 */
import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { EquipPosition, InventorySlotDto, LootRuleStateDto } from '@idle-dark/protocol';
import { INVENTORY_CMD } from '@idle-dark/protocol';
import { toastFailure } from '../services/game-client.js';
import { LoadGuard } from './load-guard.js';
import type { StoreContext } from './store-context.js';

/** 装备栏固定 4 槽的展示顺序（顺序是表现，不是数值推导）。 */
export const EQUIP_POSITIONS: readonly EquipPosition[] = ['weapon', 'plastron', 'gaiter', 'ornament'];

export const EQUIP_POSITION_NAMES: Record<EquipPosition, string> = {
  weapon: '武器',
  plastron: '胸甲',
  gaiter: '护腿',
  ornament: '饰品',
};

export class InventoryStore {
  /** 服务端下发的全量格子。 */
  slots: InventorySlotDto[] = [];
  /** 当前选中的物品实例 id（物品详情面板用）。 */
  selectedId: string | null = null;
  /** 自动拾取规则（`(lootrule, get)`）。 */
  lootRule: LootRuleStateDto | null = null;
  loading = false;
  error: string | null = null;
  /** 最近一次分解结果。 */
  lastDecompose: import('@idle-dark/protocol').DecomposeResultDto | null = null;

  private readonly guard = new LoadGuard();

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard'>(
      this,
      { ctx: false, guard: false, slots: observable.shallow },
      { autoBind: true },
    );
  }

  // ── 只读筛选（按服务端 `position` 字段分组） ──

  get inventory(): InventorySlotDto[] {
    return this.slots.filter((slot) => slot.position === 'inventory');
  }

  get buildInventory(): InventorySlotDto[] {
    return this.slots.filter((slot) => slot.position === 'build');
  }

  get awardInventory(): InventorySlotDto[] {
    return this.slots.filter((slot) => slot.position === 'award');
  }

  /** 装备栏 4 槽（`equipPosition` 定位；缺失即为空槽）。 */
  get equipments(): Array<{ position: EquipPosition; slot: InventorySlotDto | null }> {
    const equipped = this.slots.filter((slot) => slot.position === 'equip');
    return EQUIP_POSITIONS.map((position) => ({
      position,
      slot: equipped.find((slot) => slot.equipPosition === position) ?? null,
    }));
  }

  get selected(): InventorySlotDto | null {
    if (this.selectedId === null) return null;
    return this.slots.find((slot) => slot.id === this.selectedId) ?? null;
  }

  /** 包裹容量（服务端权威：`slots.length` 只能反映当前格子，容量由角色态提供）。 */
  get size(): number {
    return this.ctx.root().player.state?.inventorySize ?? this.inventory.length;
  }

  select(id: string | null): void {
    runInAction(() => {
      this.selectedId = id;
    });
  }

  // ── 加载 ──

  async load(): Promise<void> {
    const token = this.guard.next();
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    try {
      const result = await this.ctx.api.inventory.list();
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '包裹加载失败');
        return;
      }
      const slots = result.data ?? [];
      runInAction(() => {
        this.applySlots(slots);
      });
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      this.ctx.toast.fromError(error, '包裹加载失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  // ── 操作（成功即用服务端返回的格子整体替换） ──

  async equip(id: string): Promise<void> {
    await this.mutate(() => this.ctx.api.inventory.equip({ id }), '装备失败');
  }

  async unequip(id: string): Promise<void> {
    await this.mutate(() => this.ctx.api.inventory.unequip({ id }), '卸下失败');
  }

  async sell(id: string, count?: number): Promise<void> {
    await this.mutate(
      () => this.ctx.api.inventory.sell({ id, ...(count === undefined ? {} : { count }) }),
      '出售失败',
    );
  }

  async toggleLock(id: string, locked: boolean): Promise<void> {
    await this.mutate(() => this.ctx.api.inventory.lock({ id, locked }), '锁定操作失败');
  }

  async sort(): Promise<void> {
    await this.mutate(() => this.ctx.api.inventory.sort(), '整理失败');
  }

  async usePackage(id: string): Promise<void> {
    await this.mutate(() => this.ctx.api.inventory.usePackage({ id }), '开包失败');
  }

  async expand(count: number): Promise<void> {
    await this.mutate(() => this.ctx.api.inventory.expand({ count }), '扩容失败');
  }

  // ── 拾取规则 ──

  async loadLootRule(): Promise<void> {
    try {
      const result = await this.ctx.api.lootrule.get();
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '拾取规则加载失败');
        return;
      }
      runInAction(() => {
        this.lootRule = result.data ?? null;
      });
    } catch (error) {
      this.ctx.toast.fromError(error, '拾取规则加载失败');
    }
  }

  async updateLootRule(input: import('@idle-dark/ionet-transport').LootRuleUpdateInput): Promise<void> {
    try {
      const result = await this.ctx.api.lootrule.update(input);
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '拾取规则更新失败');
        return;
      }
      runInAction(() => {
        this.lootRule = result.data ?? this.lootRule;
      });
      this.ctx.toast.success('拾取规则已更新');
    } catch (error) {
      this.ctx.toast.fromError(error, '拾取规则更新失败');
    }
  }

  async setLootMinLevel(minLevel: number): Promise<void> {
    try {
      const result = await this.ctx.api.lootrule.setMinLevel({ minLevel });
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '拾取等级更新失败');
        return;
      }
      runInAction(() => {
        this.lootRule = result.data ?? this.lootRule;
      });
    } catch (error) {
      this.ctx.toast.fromError(error, '拾取等级更新失败');
    }
  }

  /** `(inventory, changed)` 推送：整体替换（服务端权威）。 */
  handleNotification(frame: unknown): void {
    const notification = frame as { cmd?: number; subCmd?: number; data?: unknown };
    if (notification.cmd !== INVENTORY_CMD.cmd || notification.subCmd !== INVENTORY_CMD.changed) return;
    const data = notification.data;
    if (Array.isArray(data)) {
      runInAction(() => {
        this.applySlots(data as InventorySlotDto[]);
      });
      return;
    }
    // 载荷形状不识别时：只标记，由下一次显式刷新补齐（不猜字段）。
    void this.load();
  }

  /** 复用的「写操作 → 服务端返回格子 → 整体替换」流程。 */
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
      const slots = result.data;
      if (Array.isArray(slots)) {
        runInAction(() => {
          this.applySlots(slots);
        });
      }
    } catch (error) {
      this.ctx.toast.fromError(error, fallback);
    }
  }

  private applySlots(slots: InventorySlotDto[]): void {
    this.slots = slots;
    // 选中的物品已被消耗/转移时取消选择，避免详情面板悬空。
    if (this.selectedId !== null && !slots.some((slot) => slot.id === this.selectedId)) {
      this.selectedId = null;
    }
  }
}
