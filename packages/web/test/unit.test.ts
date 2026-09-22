/**
 * 单元边界测试（node 环境，无 DOM）：
 * 竞态守卫 / 推送总线 / 主题持久化 / 存储容错 / Toast 文案优先级 / 日志裁剪。
 *
 * 覆盖边界：undefined、0、空数组、重复订阅、订阅者抛错、存储抛错、非法主题值、超长日志。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BattleEventDto } from '@idle-dark/protocol';
import { businessErrorMessage } from '@idle-dark/protocol';
import { NotificationBus } from '../src/services/notification-bus.js';
import { createMemoryStorage, safeGet, resolveStorage, safeRemove, safeSet } from '../src/services/storage.js';
import { LoadGuard } from '../src/stores/load-guard.js';
import { ToastStore } from '../src/stores/toast-store.js';
import { UiStore } from '../src/stores/ui-store.js';
import { appendEvents, isAttackableCamp, type BattleLogEntry } from '../src/stores/world-store.js';
import { groupWalletEntries, walletGroupOf, WALLET_GROUP_LABELS } from '../src/pages/game/panels/wallet-groups.js';
import { THEME_STORAGE_KEY, ThemeStore, parseThemeMode } from '../src/theme/theme-store.js';

describe('isAttackableCamp（可被点选为攻击目标的阵营）', () => {
  it('敌方与中立可选 —— 中立即原版黄名怪（不主动攻击，但可以打）', () => {
    expect(isAttackableCamp('enemy')).toBe(true);
    expect(isAttackableCamp('neutral')).toBe(true);
  });

  it('幽灵 / 剧情 / 神龛 / 友军 / 未知值一律不可选', () => {
    for (const camp of ['ghost', 'story', 'shrine', 'player', 'alien', 'ally', '', 'ENEMY', undefined]) {
      expect(isAttackableCamp(camp as unknown as string)).toBe(false);
    }
  });
});

describe('UiStore', () => {
  it('默认无面板；设置后生效；reset 回到默认', () => {
    const ui = new UiStore();
    expect(ui.activePanelKey).toBeNull();
    ui.setActivePanel('battle');
    expect(ui.activePanelKey).toBe('battle');
    ui.reset();
    expect(ui.activePanelKey).toBeNull();
  });

  it('空 key / 非字符串一律忽略（越界入参不抛）', () => {
    const ui = new UiStore();
    ui.setActivePanel('battle');
    for (const bad of ['', undefined, null, 0, Number.NaN, {}, []]) {
      ui.setActivePanel(bad as unknown as string);
    }
    expect(ui.activePanelKey).toBe('battle');
  });

  it('autoBind：解构出去的方法仍能改到实例（推送侧直接传引用）', () => {
    const ui = new UiStore();
    const { setActivePanel } = ui;
    setActivePanel('battle');
    expect(ui.activePanelKey).toBe('battle');
  });
});

describe('LoadGuard', () => {
  it('只有最后一次 next 的令牌是 current', () => {
    const guard = new LoadGuard();
    const first = guard.next();
    expect(guard.isCurrent(first)).toBe(true);
    const second = guard.next();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
    expect(guard.current).toBe(second);
  });

  it('0 / 负值 / NaN 令牌一律不是 current（越界入参不抛）', () => {
    const guard = new LoadGuard();
    guard.next();
    expect(guard.isCurrent(0)).toBe(false);
    expect(guard.isCurrent(-1)).toBe(false);
    expect(guard.isCurrent(Number.NaN)).toBe(false);
  });
});

describe('NotificationBus', () => {
  it('按 (cmd,subCmd) 与 type 路由，两条规则命中同一 handler 只调用一次', () => {
    const bus = new NotificationBus();
    const handler = vi.fn();
    bus.on(30, 5, handler);
    bus.onType('world.tick', handler);
    bus.dispatch({ cmd: 30, subCmd: 5, type: 'world.tick' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('未命中的路由不触发；onAny 全量订阅收到', () => {
    const bus = new NotificationBus();
    const routed = vi.fn();
    const any = vi.fn();
    bus.on(30, 5, routed);
    bus.onAny(any);
    bus.dispatch({ cmd: 99, subCmd: 1 });
    expect(routed).not.toHaveBeenCalled();
    expect(any).toHaveBeenCalledTimes(1);
    // 缺 cmd/subCmd/type 的帧也要安全
    bus.dispatch({});
    expect(any).toHaveBeenCalledTimes(2);
  });

  it('订阅者抛错被隔离，不影响其它订阅者', () => {
    const bus = new NotificationBus();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    bus.onAny(bad);
    bus.onAny(good);
    expect(() => bus.dispatch({ cmd: 1 })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('退订后不再收到；clear 清空全部订阅', () => {
    const bus = new NotificationBus();
    const handler = vi.fn();
    const unsubscribe = bus.onAny(handler);
    unsubscribe();
    bus.dispatch({ cmd: 1 });
    expect(handler).not.toHaveBeenCalled();
    bus.onAny(handler);
    bus.clear();
    bus.dispatch({ cmd: 1 });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('ThemeStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('默认 dark；非法持久化值回落 dark', () => {
    expect(new ThemeStore(createMemoryStorage()).mode).toBe('dark');
    expect(parseThemeMode(null)).toBe('dark');
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode('system')).toBe('dark');
    expect(parseThemeMode('')).toBe('dark');
  });

  it('hydrate 读取存储；setMode 写回同一键（与 index.html 内联脚本一致）', () => {
    const storage = createMemoryStorage();
    storage.setItem(THEME_STORAGE_KEY, 'light');
    const theme = new ThemeStore(storage);
    expect(theme.hydrate()).toBe('light');
    expect(theme.mode).toBe('light');
    theme.setMode('dark');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    theme.toggle();
    expect(theme.mode).toBe('light');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('存储抛错不致命（内存态仍生效）', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
    };
    const theme = new ThemeStore(throwing);
    expect(() => theme.hydrate()).not.toThrow();
    expect(theme.mode).toBe('dark');
    expect(() => theme.setMode('light')).not.toThrow();
    expect(theme.mode).toBe('light');
  });
});

describe('storage helpers', () => {
  it('safeGet/safeSet/safeRemove 吞掉存储异常', () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error('x');
      },
      setItem: (): void => {
        throw new Error('x');
      },
      removeItem: (): void => {
        throw new Error('x');
      },
    };
    expect(safeGet(throwing, 'k')).toBeNull();
    expect(() => safeSet(throwing, 'k', 'v')).not.toThrow();
    expect(() => safeRemove(throwing, 'k')).not.toThrow();
  });

  it('resolveStorage 显式优先；内存实现可读回', () => {
    const memory = createMemoryStorage();
    expect(resolveStorage(memory)).toBe(memory);
    const fallback = resolveStorage();
    fallback.setItem('a', '1');
    expect(fallback.getItem('a')).toBe('1');
    fallback.removeItem('a');
    expect(fallback.getItem('a')).toBeNull();
  });
});

describe('ToastStore 文案优先级', () => {
  it('服务端 message ＞ 业务码表 ＞ 兜底', () => {
    const toast = new ToastStore();
    toast.fromFailure('MAP_LOCKED', '服务端说法', '兜底');
    expect(toast.toasts.at(-1)?.title).toBe('服务端说法');
    toast.fromFailure('MAP_LOCKED', undefined, '兜底');
    expect(toast.toasts.at(-1)?.title).toBe(businessErrorMessage('MAP_LOCKED'));
    toast.fromFailure(undefined, '', '兜底');
    expect(toast.toasts.at(-1)?.title).toBe('兜底');
  });

  it('consume 取走并清空；max 只保留最近若干条', () => {
    const toast = new ToastStore();
    toast.max = 2;
    toast.error('a');
    toast.error('b');
    toast.error('c');
    expect(toast.toasts.map((entry) => entry.title)).toEqual(['b', 'c']);
    const drained = toast.consume();
    expect(drained).toHaveLength(2);
    expect(toast.toasts).toHaveLength(0);
  });

  it('fromError 识别 BusinessError / TransportError / RestError 结构', () => {
    const toast = new ToastStore();
    // BusinessError：服务端文案优先
    toast.fromError(
      Object.assign(new Error('服务端业务话术'), {
        name: 'BusinessError',
        code: 'NO_TICKET',
        serverMessage: '服务端业务话术',
      }),
    );
    expect(toast.toasts.at(-1)?.title).toBe('服务端业务话术');
    // BusinessError：完全没有文案时回落本地码表
    toast.fromError({ name: 'BusinessError', code: 'NO_TICKET' });
    expect(toast.toasts.at(-1)?.title).toBe(businessErrorMessage('NO_TICKET'));
    // TransportError：按 errorCode 分类
    toast.fromError(Object.assign(new Error('bad'), { name: 'TransportError', errorCode: 404 }));
    expect(toast.toasts.at(-1)?.title).toBe('服务端未实现该功能');
    expect(toast.toasts.at(-1)?.code).toBe(404);
  });
});

describe('BattleLog 裁剪', () => {
  const event: BattleEventDto = { kind: 'general', text: 'x' };

  it('空事件不改变原数组引用', () => {
    const existing: BattleLogEntry[] = [];
    expect(appendEvents(existing, [], 1, () => 1)).toBe(existing);
  });

  it('本批次事件按发生顺序反序插到队首，并裁剪到上限', () => {
    let seq = 0;
    const first = appendEvents([], [event, event], 100, () => (seq += 1));
    expect(first.map((entry) => entry.seq)).toEqual([2, 1]);

    // 造 300 条旧日志 + 新批次 → 总数必须 <= 200
    const many: BattleLogEntry[] = Array.from({ length: 300 }, (_, index) => ({
      seq: index,
      serverTime: 0,
      event,
    }));
    const capped = appendEvents(many, [event], 200, () => (seq += 1));
    expect(capped).toHaveLength(200);
    expect(capped[0]?.seq).toBe(seq);
  });
});

describe('钱包分组 walletGroupOf / groupWalletEntries（纯函数边界）', () => {
  it('按 key 命名空间分流：currency. / essence. / 其它', () => {
    expect(walletGroupOf('currency.transmute')).toBe('currency');
    expect(walletGroupOf('essence.atk')).toBe('essence');
    expect(walletGroupOf('keystone.t01')).toBe('other');
    expect(WALLET_GROUP_LABELS.currency).toBe('通货');
    expect(WALLET_GROUP_LABELS.essence).toBe('精华');
  });

  it('非字符串 / 仅有前缀无点 / 空串 / 未知值一律落「其他」，不抛错', () => {
    for (const key of ['currency', 'currencyX', 'essence', '', 'Currency.a', undefined, null, 0, {}]) {
      expect(walletGroupOf(key as unknown)).toBe('other');
    }
  });

  it('空 / null / undefined / 非数组 → 三个空分组（不抛错）', () => {
    for (const input of [undefined, null, [] as const]) {
      const groups = groupWalletEntries(input as never);
      expect(groups).toEqual({ currency: [], essence: [], other: [] });
    }
  });

  it('归类时保持服务端顺序、跳过 null 条目，且不丢条目', () => {
    const entries = [
      { key: 'currency.transmute', count: 1, name: '蜕变石', type: 'material' },
      { key: 'essence.atk', count: 2, name: '锋锐精华', type: 'material' },
      { key: 'mystery.token', count: 3, name: '神秘代币', type: 'material' },
      { key: 'currency.mirror', count: 4, name: '映道镜', type: 'material' },
    ];
    const groups = groupWalletEntries(entries as never);
    expect(groups.currency.map((entry) => entry.key)).toEqual(['currency.transmute', 'currency.mirror']);
    expect(groups.essence.map((entry) => entry.key)).toEqual(['essence.atk']);
    expect(groups.other.map((entry) => entry.key)).toEqual(['mystery.token']);

    const withNull = groupWalletEntries([null, entries[0]] as never);
    expect(withNull.currency).toHaveLength(1);
  });
});
