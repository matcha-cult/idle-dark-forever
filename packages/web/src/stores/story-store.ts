/**
 * StoryStore —— 剧情列表与播放（DSL 节点逐句播放）。
 *
 * 服务端权威：剧情状态（未开启 / 进行中 / 已完成）、开启条件、任务进度全部来自
 * `(story, list)`；剧本节点来自 `(story, play)`。**前端只负责播放游标**（第几句），
 * 不推导任何任务数值；`finish` 的奖励以服务端返回为准。
 */
import { makeAutoObservable, observable, runInAction } from 'mobx';
import { STORY_CMD, type StoryDto, type StoryPlayDto } from '@idle-dark/protocol';
import { toastFailure } from '../services/game-client.js';
import { LoadGuard } from './load-guard.js';
import type { StoreContext } from './store-context.js';

export class StoryStore {
  stories: StoryDto[] = [];
  /** 当前打开的剧本（null = 未打开）。 */
  play: StoryPlayDto | null = null;
  /** 播放游标（第几个节点，0 起）。纯 UI 状态。 */
  cursor = 0;
  loading = false;
  playing = false;
  error: string | null = null;

  private readonly guard = new LoadGuard();

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard'>(
      this,
      { ctx: false, guard: false, stories: observable.shallow, play: observable.ref },
      { autoBind: true },
    );
  }

  get current(): StoryDto | null {
    if (this.play === null) return null;
    return this.stories.find((story) => story.key === this.play?.key) ?? null;
  }

  get nodes(): StoryPlayDto['nodes'] {
    return this.play?.nodes ?? [];
  }

  get currentNode(): { type: string; args: string[] } | null {
    return this.nodes[this.cursor] ?? null;
  }

  get isLastNode(): boolean {
    return this.cursor >= this.nodes.length - 1;
  }

  async load(): Promise<void> {
    const token = this.guard.next();
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    try {
      const result = await this.ctx.api.story.list();
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '剧情列表加载失败');
        return;
      }
      const stories = result.data ?? [];
      runInAction(() => {
        this.stories = stories;
      });
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      this.ctx.toast.fromError(error, '剧情列表加载失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  /** 打开剧本（拉 DSL 节点并复位游标）。 */
  async open(key: string): Promise<void> {
    runInAction(() => {
      this.playing = true;
    });
    try {
      const result = await this.ctx.api.story.play({ key });
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '剧本加载失败');
        return;
      }
      runInAction(() => {
        this.play = result.data ?? null;
        this.cursor = 0;
      });
    } catch (error) {
      this.ctx.toast.fromError(error, '剧本加载失败');
    } finally {
      runInAction(() => {
        this.playing = false;
      });
    }
  }

  close(): void {
    runInAction(() => {
      this.play = null;
      this.cursor = 0;
    });
  }

  /** 下一句（越界时幂等停在最后一句）。 */
  next(): void {
    runInAction(() => {
      if (this.cursor < this.nodes.length) this.cursor += 1;
    });
  }

  prev(): void {
    runInAction(() => {
      if (this.cursor > 0) this.cursor -= 1;
    });
  }

  seek(index: number): void {
    if (!Number.isFinite(index) || index < 0) return;
    runInAction(() => {
      this.cursor = Math.min(Math.floor(index), Math.max(0, this.nodes.length - 1));
    });
  }

  /** 完成剧情（服务端结算奖励并返回更新后的剧情状态）。 */
  async finish(key: string): Promise<void> {
    try {
      const result = await this.ctx.api.story.finish({ key });
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '剧情结算失败');
        return;
      }
      const updated = result.data;
      if (updated !== undefined) {
        runInAction(() => {
          this.stories = this.stories.map((story) => (story.key === updated.key ? updated : story));
        });
      }
      this.ctx.toast.success('剧情已完成');
      await this.load();
      void this.ctx.root().player.load();
    } catch (error) {
      this.ctx.toast.fromError(error, '剧情结算失败');
    }
  }

  /** `(story, unlock)` 推送：有新剧情可开启 → 提示 + 刷新列表。 */
  handleNotification(frame: unknown): void {
    const notification = frame as { cmd?: number; subCmd?: number; data?: unknown };
    if (notification.cmd !== STORY_CMD.cmd || notification.subCmd !== STORY_CMD.unlock) return;
    const data = notification.data as { name?: string; key?: string } | undefined;
    this.ctx.toast.info('有新剧情可开启', data?.name);
    void this.load();
  }
}
