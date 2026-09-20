/**
 * CareerStore —— 职业 / 主动技能 / 强化（被动）面板。
 *
 * 服务端权威：`(career, list)` 及所有写操作都返回完整 `CareerPanelDto`，本 Store 整体替换。
 * 「当前职业」从角色态读（`PlayerStore.currentCareer`），不在本 Store 重复保存。
 */
import { makeAutoObservable, observable, runInAction } from 'mobx';
import { CAREER_CMD, type CareerPanelDto } from '@idle-dark/protocol';
import { toastFailure } from '../services/game-client.js';
import { LoadGuard } from './load-guard.js';
import type { StoreContext } from './store-context.js';

export class CareerStore {
  panel: CareerPanelDto | null = null;
  loading = false;
  error: string | null = null;

  private readonly guard = new LoadGuard();

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard'>(
      this,
      { ctx: false, guard: false, panel: observable.ref },
      { autoBind: true },
    );
  }

  get currentCareer(): string {
    return this.ctx.root().player.currentCareer;
  }

  get careers(): CareerPanelDto['careers'] {
    return this.panel?.careers ?? [];
  }

  get skills(): CareerPanelDto['skills'] {
    return this.panel?.skills ?? [];
  }

  get enhances(): CareerPanelDto['enhances'] {
    return this.panel?.enhances ?? [];
  }

  /** 已选主动技能（按服务端 `selected` 标记筛选，槽位顺序读角色态 `selectedSkills`）。 */
  get selectedSkills(): string[] {
    return this.ctx.root().player.selectedSkills.slice();
  }

  get selectedEnhances(): string[] {
    return this.ctx.root().player.selectedEnhances.slice();
  }

  get maxSkillCount(): number {
    return this.panel?.maxSkillCount ?? this.ctx.root().player.state?.slotLimits.maxSkillCount ?? 0;
  }

  get maxEnhanceCount(): number {
    return this.panel?.maxEnhanceCount ?? this.ctx.root().player.state?.slotLimits.maxEnhanceCount ?? 0;
  }

  async load(): Promise<void> {
    const token = this.guard.next();
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    try {
      const result = await this.ctx.api.career.list();
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '职业面板加载失败');
        return;
      }
      const panel = result.data ?? null;
      runInAction(() => {
        this.panel = panel;
      });
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      this.ctx.toast.fromError(error, '职业面板加载失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  async switchCareer(career: string): Promise<void> {
    await this.mutate(() => this.ctx.api.career.switchCareer({ career }), '切换职业失败');
  }

  async selectSkill(skill: string): Promise<void> {
    await this.mutate(() => this.ctx.api.career.selectSkill({ skill }), '装备技能失败');
  }

  async unselectSkill(skill: string): Promise<void> {
    await this.mutate(() => this.ctx.api.career.unselectSkill({ skill }), '卸下技能失败');
  }

  async selectEnhance(enhance: string): Promise<void> {
    await this.mutate(() => this.ctx.api.career.selectEnhance({ enhance }), '装备强化失败');
  }

  async unselectEnhance(enhance: string): Promise<void> {
    await this.mutate(() => this.ctx.api.career.unselectEnhance({ enhance }), '卸下强化失败');
  }

  /** `(career, levelup)` 推送：升级事件 → 刷新面板 + 一次性提示。 */
  handleNotification(frame: unknown): void {
    const notification = frame as { cmd?: number; subCmd?: number; data?: unknown };
    if (notification.cmd !== CAREER_CMD.cmd || notification.subCmd !== CAREER_CMD.levelup) return;
    const data = notification.data as { level?: number; career?: string } | undefined;
    this.ctx.toast.info('等级提升', data?.level === undefined ? undefined : `Lv.${data.level}`);
    void this.load();
    void this.ctx.root().player.load();
  }

  private async mutate(
    action: () => Promise<import('@idle-dark/ionet-transport').ActionResult<CareerPanelDto>>,
    fallback: string,
  ): Promise<void> {
    try {
      const result = await action();
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, fallback);
        return;
      }
      if (result.data !== undefined) {
        runInAction(() => {
          this.panel = result.data ?? this.panel;
        });
      }
      // 选中技能/职业会改动角色态（selectedSkills / currentCareer），同步刷新角色态。
      void this.ctx.root().player.load();
    } catch (error) {
      this.ctx.toast.fromError(error, fallback);
    }
  }
}
