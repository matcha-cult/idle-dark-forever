/** theme 分组纯逻辑测试：build-theme-config / theme-store / viewport mock。 */
import { theme } from 'antd';
import { describe, expect, it } from 'vitest';
import { buildThemeConfig, defaultPrimaryColor, hasCompactAlgorithm } from './build-theme-config.js';
import { createThemeStore, readStoredMode, THEME_STORAGE_KEY, type ThemeModeStorage } from './theme-store.js';
import { DEFAULT_THEME_MODE, nextThemeMode, parseThemeMode, themeToggleLabel } from './types.js';

interface FakeStorage extends ThemeModeStorage {
  data: Map<string, string>;
  calls: string[];
}

function makeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  const calls: string[] = [];
  return {
    data,
    calls,
    getItem(key) {
      calls.push(`get:${key}`);
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      calls.push(`set:${key}=${value}`);
      data.set(key, value);
    },
  };
}

describe('buildThemeConfig', () => {
  it('暗色 = darkAlgorithm + compactAlgorithm（紧凑恒在）', () => {
    const config = buildThemeConfig({ mode: 'dark' });
    const algorithms = config.algorithm as unknown[];
    expect(algorithms).toHaveLength(2);
    expect(algorithms[0]).toBe(theme.darkAlgorithm);
    expect(algorithms[1]).toBe(theme.compactAlgorithm);
    expect(hasCompactAlgorithm({ mode: 'dark' })).toBe(true);
  });

  it('亮色 = defaultAlgorithm + compactAlgorithm', () => {
    const algorithms = buildThemeConfig({ mode: 'light' }).algorithm as unknown[];
    expect(algorithms[0]).toBe(theme.defaultAlgorithm);
    expect(algorithms[1]).toBe(theme.compactAlgorithm);
    expect(hasCompactAlgorithm({ mode: 'light' })).toBe(true);
  });

  it('缺省主色来自 antd seed token（本仓不私藏 hex 色板）', () => {
    const primary = buildThemeConfig({ mode: 'dark' }).token?.colorPrimary;
    expect(primary).toBe(theme.defaultSeed.colorPrimary);
    expect(primary).toBe(defaultPrimaryColor());
  });

  it('primaryColor 覆盖生效；空串 / 纯空白回退缺省值', () => {
    expect(buildThemeConfig({ mode: 'dark', primaryColor: 'tomato' }).token?.colorPrimary).toBe('tomato');
    expect(buildThemeConfig({ mode: 'dark', primaryColor: '' }).token?.colorPrimary).toBe(defaultPrimaryColor());
    expect(buildThemeConfig({ mode: 'dark', primaryColor: '   ' }).token?.colorPrimary).toBe(defaultPrimaryColor());
  });
});

describe('theme/types', () => {
  it('nextThemeMode 往返', () => {
    expect(nextThemeMode('dark')).toBe('light');
    expect(nextThemeMode('light')).toBe('dark');
  });

  it('parseThemeMode 只认两个合法值', () => {
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode('system')).toBeNull();
    expect(parseThemeMode(null)).toBeNull();
    expect(parseThemeMode(undefined)).toBeNull();
    expect(parseThemeMode(1)).toBeNull();
  });

  it('themeToggleLabel 指向「点击后将切到」的状态', () => {
    expect(themeToggleLabel('dark')).toBe('切换到亮色主题');
    expect(themeToggleLabel('light')).toBe('切换到暗色主题');
  });

  it('缺省主题态为暗色（暗黑奇幻题材）', () => {
    expect(DEFAULT_THEME_MODE).toBe('dark');
  });
});

describe('createThemeStore', () => {
  it('构造零副作用：不读也不写存储', () => {
    const storage = makeStorage();
    const store = createThemeStore({ storage });
    expect(storage.calls).toEqual([]);
    expect(store.getMode()).toBe(DEFAULT_THEME_MODE);
    expect(store.hasStorage()).toBe(true);
  });

  it('hydrate 读取持久化值并通知订阅者', () => {
    const storage = makeStorage({ [THEME_STORAGE_KEY]: 'light' });
    const store = createThemeStore({ storage });
    const seen: string[] = [];
    store.subscribe((mode) => seen.push(mode));
    expect(store.hydrate()).toBe('light');
    expect(store.getMode()).toBe('light');
    expect(seen).toEqual(['light']);
  });

  it('hydrate 遇到脏数据 / 缺 key 时保持原值', () => {
    const dirty = makeStorage({ [THEME_STORAGE_KEY]: '{"mode":"dark"}' });
    const store = createThemeStore({ storage: dirty });
    expect(store.hydrate()).toBe(DEFAULT_THEME_MODE);
    const empty = makeStorage();
    expect(createThemeStore({ storage: empty, initialMode: 'light' }).hydrate()).toBe('light');
  });

  it('setMode 写存储 + 通知；同值重复设置不再通知', () => {
    const storage = makeStorage();
    const store = createThemeStore({ storage });
    const seen: string[] = [];
    store.subscribe((mode) => seen.push(mode));
    store.setMode('light');
    store.setMode('light');
    expect(seen).toEqual(['light']);
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('light');
  });

  it('退订后不再收到通知', () => {
    const store = createThemeStore({ storage: makeStorage() });
    const seen: string[] = [];
    const unsubscribe = store.subscribe((mode) => seen.push(mode));
    store.setMode('light');
    unsubscribe();
    store.setMode('dark');
    expect(seen).toEqual(['light']);
  });

  it('storage: null 显式关闭持久化（仍可切换内存态）', () => {
    const store = createThemeStore({ storage: null });
    expect(store.hasStorage()).toBe(false);
    store.setMode('light');
    expect(store.getMode()).toBe('light');
    expect(store.hydrate()).toBe('light');
  });

  it('存储抛错（配额 / 权限）不冒泡', () => {
    const hostile: ThemeModeStorage = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    const store = createThemeStore({ storage: hostile });
    expect(() => store.setMode('light')).not.toThrow();
    expect(store.hydrate()).toBe('light');
  });

  it('自定义 storageKey 生效', () => {
    const storage = makeStorage({ 'custom:key': 'light' });
    const store = createThemeStore({ storage, storageKey: 'custom:key' });
    expect(store.hydrate()).toBe('light');
    expect(readStoredMode(storage, 'custom:key')).toBe('light');
  });

  it('未注入 storage 时惰性探测 globalThis.localStorage', () => {
    const host = globalThis as { localStorage?: unknown };
    const had = 'localStorage' in host;
    const previous = host.localStorage;
    const storage = makeStorage();
    Object.defineProperty(host, 'localStorage', { configurable: true, writable: true, value: storage });
    try {
      const store = createThemeStore();
      expect(store.hasStorage()).toBe(true);
      store.hydrate();
      expect(storage.calls).toEqual([`get:${THEME_STORAGE_KEY}`]);
    } finally {
      if (had) Object.defineProperty(host, 'localStorage', { configurable: true, writable: true, value: previous });
      else Reflect.deleteProperty(host, 'localStorage');
    }
  });

  it('无 localStorage（SSR）时 hasStorage=false 且不抛错', () => {
    const host = globalThis as { localStorage?: unknown };
    const had = 'localStorage' in host;
    const previous = host.localStorage;
    Reflect.deleteProperty(host, 'localStorage');
    try {
      const store = createThemeStore();
      expect(store.hasStorage()).toBe(false);
      expect(store.hydrate()).toBe(DEFAULT_THEME_MODE);
    } finally {
      if (had) Object.defineProperty(host, 'localStorage', { configurable: true, writable: true, value: previous });
    }
  });
});
