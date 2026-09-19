/**
 * 主题持久化 store（**构造零副作用**）。
 *
 * 设计要点：
 * - `createThemeStore()` 只捕获配置，**不读也不写** localStorage / 不注册全局监听，
 *   因此可在 SSR、单测、多实例场景安全构造（参考实现的教训：模块级副作用会让
 *   「导入即写盘」，测试无法隔离）。
 * - 存储通过 `ThemeModeStorage` 接口注入（结构化类型 = 浏览器 `localStorage` 直接可用），
 *   缺省惰性取 `globalThis.localStorage`；`storage: null` 表示显式关闭持久化。
 * - `hydrate()` 是**唯一**读存储的时机；`setMode()` 是**唯一**写存储的时机。
 * - 读取失败（隐私模式 / 配额 / JSON 脏数据）一律回退到当前 mode，绝不抛错。
 */
import { DEFAULT_THEME_MODE, parseThemeMode, type ThemeMode } from './types.js';

/** localStorage key（仅一处定义）。 */
export const THEME_STORAGE_KEY = 'idle-dark:theme-mode';

/** 最小存储契约（浏览器 `Storage` 结构上满足它）。 */
export interface ThemeModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeStore {
  /** 当前内存中的主题态。 */
  getMode(): ThemeMode;
  /** 设置主题态：更新内存 + 通知订阅者 + 尽力写存储。 */
  setMode(mode: ThemeMode): void;
  /** 订阅变更，返回退订函数。 */
  subscribe(listener: (mode: ThemeMode) => void): () => void;
  /** 从存储读取并应用，返回最终生效的 mode（无存储 / 脏数据 → 保持原值）。 */
  hydrate(): ThemeMode;
  /** 是否具备可用存储（诊断 / 测试用）。 */
  hasStorage(): boolean;
}

export interface CreateThemeStoreOptions {
  /** 初始内存态，缺省 `DEFAULT_THEME_MODE`。 */
  initialMode?: ThemeMode;
  /** 注入存储；`undefined` = 惰性自动探测，`null` = 关闭持久化。 */
  storage?: ThemeModeStorage | null;
  storageKey?: string;
}

/** 惰性探测宿主 localStorage；不可用（SSR / 隐私模式 / 权限拒绝）时返回 null。 */
function resolveHostStorage(): ThemeModeStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: unknown }).localStorage;
    if (candidate === undefined || candidate === null) return null;
    const store = candidate as ThemeModeStorage;
    const ok = typeof store.getItem === 'function' && typeof store.setItem === 'function';
    return ok ? store : null;
  } catch {
    return null;
  }
}

/** 从任意存储对象读一个合法 mode；任何异常与脏值都返回 null。 */
export function readStoredMode(storage: ThemeModeStorage | null, key: string): ThemeMode | null {
  if (storage === null) return null;
  try {
    return parseThemeMode(storage.getItem(key));
  } catch {
    return null;
  }
}

/** 尽力写存储；失败静默（UI 不能因为存不了偏好而崩）。 */
function writeStoredMode(storage: ThemeModeStorage | null, key: string, mode: ThemeMode): void {
  if (storage === null) return;
  try {
    storage.setItem(key, mode);
  } catch {
    /* 配额/权限问题：忽略，内存态仍然生效 */
  }
}

export function createThemeStore(options: CreateThemeStoreOptions = {}): ThemeStore {
  const explicitStorage = options.storage;
  const storageKey = options.storageKey ?? THEME_STORAGE_KEY;
  const autoDetect = explicitStorage === undefined;

  let mode: ThemeMode = options.initialMode ?? DEFAULT_THEME_MODE;
  const listeners = new Set<(mode: ThemeMode) => void>();

  /** 每次使用都重新解析：注入的存储直接用，自动探测的惰性取（且不缓存失败结果）。 */
  const currentStorage = (): ThemeModeStorage | null =>
    autoDetect ? resolveHostStorage() : explicitStorage;

  return {
    getMode: () => mode,
    setMode: (next) => {
      writeStoredMode(currentStorage(), storageKey, next);
      if (next === mode) return;
      mode = next;
      for (const listener of listeners) listener(mode);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate: () => {
      const stored = readStoredMode(currentStorage(), storageKey);
      if (stored !== null && stored !== mode) {
        mode = stored;
        for (const listener of listeners) listener(mode);
      }
      return mode;
    },
    hasStorage: () => currentStorage() !== null,
  };
}
