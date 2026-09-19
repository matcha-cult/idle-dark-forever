/**
 * ThemeStore —— 主题态持久化（**只有 light / dark 两态**，默认 dark：暗黑奇幻题材）。
 *
 * 纪律：
 * - **构造函数零副作用**：只保存依赖，不读也不写存储；恢复走显式 `hydrate()`
 *   （`main.tsx` 在首次渲染前调用，与 `index.html` 的首帧防闪烁脚本配合）；
 * - 状态写入一律 `runInAction`；存储写入失败不影响内存态（隐私模式不致命）。
 */
import { makeAutoObservable, runInAction } from 'mobx';
import { safeGet, safeSet, type StorageLike } from '../services/storage.js';

/** 主题持久化键（与 `index.html` 的防闪烁内联脚本共用，改动需同步）。 */
export const THEME_STORAGE_KEY = 'idle-dark:theme';

/** 只有两态；`null` 也归入 dark（默认暗黑）。 */
export type ThemeMode = 'light' | 'dark';

/** 解析持久化值：非法/缺失一律回退 dark（不做 OS 偏好推断）。 */
export function parseThemeMode(raw: string | null | undefined): ThemeMode {
  return raw === 'light' ? 'light' : 'dark';
}

export class ThemeStore {
  /** 当前主题态；默认 dark（`hydrate()` 前）。 */
  mode: ThemeMode = 'dark';

  constructor(private readonly storage: StorageLike) {
    makeAutoObservable<this, 'storage'>(this, { storage: false }, { autoBind: true });
  }

  get isDark(): boolean {
    return this.mode === 'dark';
  }

  /** 从存储恢复并返回结果（显式调用，避免构造函数副作用）。 */
  hydrate(): ThemeMode {
    const mode = parseThemeMode(safeGet(this.storage, THEME_STORAGE_KEY));
    runInAction(() => {
      this.mode = mode;
    });
    this.applyDocumentMark(mode);
    return mode;
  }

  /** 设置主题态（同值幂等，但仍会补写存储与 document 标记）。 */
  setMode(mode: ThemeMode): void {
    if (this.mode !== mode) {
      runInAction(() => {
        this.mode = mode;
      });
    }
    safeSet(this.storage, THEME_STORAGE_KEY, mode);
    this.applyDocumentMark(mode);
  }

  /** 一键切换：亮 ↔ 暗。 */
  toggle(): void {
    this.setMode(this.mode === 'dark' ? 'light' : 'dark');
  }

  /**
   * `data-theme` **不是样式来源**（避免出现双主题系统）：它只用于原生控件配色与
   * 调试可读性；真正的颜色一律来自 ui-kit 的 ThemeProvider / antd token。
   */
  private applyDocumentMark(mode: ThemeMode): void {
    try {
      if (typeof document === 'undefined') return;
      document.documentElement.setAttribute('data-theme', mode);
      document.documentElement.style.colorScheme = mode;
    } catch {
      /* 无 DOM 环境（单测）忽略 */
    }
  }
}
