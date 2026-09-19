/**
 * RootStore —— 应用唯一的组合根。
 *
 * 职责：
 * - 装配 `GameClient`（WS 状态机 + typed GameApi + REST + 推送总线）与各域 Store；
 * - 把 transport 回调接到 Store：连接状态 → `ConnectionStore`，
 *   业务错误 → `ToastStore`；推送经 `client.notifications` 统一路由到各域 `handleNotification`；
 * - 会话生命周期编排：bootstrap / login / createCharacter / selectCharacter / logout / loadPanel；
 * - 指标轮询（默认 1s）与资源释放（`dispose`）。
 *
 * 错误口径：本类**不向上抛**。登录/连接失败经 Toast 提示后返回 false；
 * `loadPanel()` 各域独立失败由各自 Store 吞掉，`Promise.all` 不会 reject。
 */
import type { IonetClientOptions, SocketAdapterFactory } from '@idle-dark/ionet-transport';
import {
  BATTLE_CMD,
  CAREER_CMD,
  IDLE_CMD,
  INVENTORY_CMD,
  STORY_CMD,
  WORLD_CMD,
} from '@idle-dark/protocol';
import { GameClient, resolveApiBaseUrl, resolveWsUrl } from '../services/game-client.js';
import type { PushFrame } from '../services/notification-bus.js';
import { resolveStorage, type StorageLike } from '../services/storage.js';
import { BankStore } from '../stores/bank-store.js';
import { CareerStore } from '../stores/career-store.js';
import { ConnectionStore } from '../stores/connection-store.js';
import { IdleStore } from '../stores/idle-store.js';
import { InventoryStore } from '../stores/inventory-store.js';
import { PlayerStore } from '../stores/player-store.js';
import { ProduceStore } from '../stores/produce-store.js';
import { SessionStore } from '../stores/session-store.js';
import { ShopStore } from '../stores/shop-store.js';
import { StoryStore } from '../stores/story-store.js';
import { ToastStore } from '../stores/toast-store.js';
import { WorldStore } from '../stores/world-store.js';
import type { StoreContext } from '../stores/store-context.js';
import { ThemeStore } from '../theme/theme-store.js';

/** 默认指标轮询间隔（毫秒）。 */
const DEFAULT_METRICS_INTERVAL_MS = 1000;

export interface RootStoreOptions {
  /** WS 端点；缺省同源 `/ws`。 */
  wsUrl?: string;
  /** REST 前缀；缺省同源 `/api`。 */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** 缺省用浏览器 localStorage（不可用时内存实现）。 */
  storage?: StorageLike;
  /** 测试注入 socket 适配器。 */
  adapterFactory?: SocketAdapterFactory;
  lifecycle?: LifecycleAdapter;
  heartbeat?: IonetClientOptions['heartbeat'];
  reconnect?: IonetClientOptions['reconnect'];
  requestTimeoutMs?: number;
  logger?: (...args: unknown[]) => void;
  /** `connection.refreshMetrics()` 轮询间隔；缺省 1000，设 0 关闭。 */
  autoRefreshMetricsMs?: number;
}

export class RootStore {
  readonly toast: ToastStore;
  readonly theme: ThemeStore;
  readonly session: SessionStore;
  readonly connection: ConnectionStore;
  readonly client: GameClient;
  readonly player: PlayerStore;
  readonly world: WorldStore;
  readonly inventory: InventoryStore;
  readonly bank: BankStore;
  readonly career: CareerStore;
  readonly produce: ProduceStore;
  readonly story: StoryStore;
  readonly shop: ShopStore;
  readonly idle: IdleStore;

  private readonly autoRefreshMetricsMs: number;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private readonly routingUnsubscribers: Array<() => void> = [];

  constructor(options: RootStoreOptions = {}) {
    this.toast = new ToastStore();

    // 回调闭包在连接/请求发生时才读取 this.*，因此此处先建 client 再建各 Store 是安全的。
    this.client = new GameClient({
      url: options.wsUrl ?? resolveWsUrl(),
      baseUrl: options.baseUrl ?? resolveApiBaseUrl(),
      getToken: () => this.session.token ?? undefined,
      callbacks: {
        onStateChange: (state, detail) => this.connection.handleStateChange(state, detail),
        onBusinessError: (error) => this.toast.fromError(error),
      },
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.adapterFactory === undefined ? {} : { adapterFactory: options.adapterFactory }),
      ...(options.heartbeat === undefined ? {} : { heartbeat: options.heartbeat }),
      ...(options.reconnect === undefined ? {} : { reconnect: options.reconnect }),
      ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    });

    // 存储只解析一次：若两次解析会在「无 localStorage 且未显式传入」时得到两个不同的内存实现。
    const storage = resolveStorage(options.storage);
    this.theme = new ThemeStore(storage);
    this.session = new SessionStore(this.client.api, this.client.rest, storage, this.toast);
    this.connection = new ConnectionStore(this.client);

    const ctx: StoreContext = {
      api: this.client.api,
      client: this.client,
      toast: this.toast,
      session: this.session,
      root: () => this,
    };
    this.player = new PlayerStore(ctx);
    this.world = new WorldStore(ctx);
    this.inventory = new InventoryStore(ctx);
    this.bank = new BankStore(ctx);
    this.career = new CareerStore(ctx);
    this.produce = new ProduceStore(ctx);
    this.story = new StoryStore(ctx);
    this.shop = new ShopStore(ctx);
    this.idle = new IdleStore(ctx);

    this.autoRefreshMetricsMs = options.autoRefreshMetricsMs ?? DEFAULT_METRICS_INTERVAL_MS;
    this.startMetricsPolling();
    this.startNotificationRouting();
  }

  /** 恢复会话；有 token 则连接 WS（失败不抛，仅 toast）。 */
  async bootstrap(): Promise<void> {
    if (!this.session.restore()) return;
    await this.connectAfterAuth();
    await Promise.all([this.session.loadMe(), this.session.loadPlayers()]);
    if (this.session.activePlayerKey !== null) await this.loadPanel();
  }

  /** 登录 → 存 token → `?token=` 连 WS → 并发拉账号/角色列表/面板。 */
  async login(username: string, password: string): Promise<boolean> {
    const ok = await this.session.login(username, password);
    if (!ok) return false;
    await this.connectAfterAuth();
    await Promise.all([this.session.loadMe(), this.session.loadPlayers()]);
    return true;
  }

  /** 建角成功后直接进入该角色。 */
  async createCharacter(name: string, role: string): Promise<boolean> {
    const player = await this.session.createPlayer(name, role);
    if (player === null) return false;
    return this.selectCharacter(player.key);
  }

  /** 选择角色：拉服务端权威角色态 → 应用 → 并发拉面板。 */
  async selectCharacter(key: string): Promise<boolean> {
    const state = await this.session.selectPlayer(key);
    if (state === null) return false;
    this.player.applyState(state);
    await this.loadPanel();
    return true;
  }

  /** 退出当前角色（回选角页），不断开 WS。 */
  leaveCharacter(): void {
    this.session.leaveCharacter();
  }

  logout(): void {
    try {
      this.client.disconnect('logout');
    } catch {
      /* 连接可能已关闭，忽略 */
    }
    this.session.logout();
    this.player.reset();
    this.stopMetricsPolling();
  }

  /**
   * 并发拉取面板：player / world / inventory / bank / career / produce / story / shop / idle。
   * 每个域 Store 的 `load()` 内部已 try/catch；这里再兜一层 `.catch`，
   * 确保 `Promise.all` 绝不因单个域失败而 reject。
   */
  async loadPanel(): Promise<void> {
    await Promise.all([
      this.player.load().catch(() => undefined),
      this.world.load().catch(() => undefined),
      this.inventory.load().catch(() => undefined),
      this.bank.load().catch(() => undefined),
      this.career.load().catch(() => undefined),
      this.produce.load().catch(() => undefined),
      this.story.load().catch(() => undefined),
      this.shop.load().catch(() => undefined),
      this.idle.load().catch(() => undefined),
      this.inventory.loadLootRule().catch(() => undefined),
    ]);
  }

  /** 订阅推送：transport 的 `client.notifications` → 本地总线 → 按 cmd 段路由到域 Store。 */
  startNotificationRouting(): void {
    this.routingUnsubscribers.push(
      this.client.notifications.onAny((notification) => this.routeNotification(notification)),
    );
  }

  /** 释放：停轮询、退订推送、释放 client（幂等）。 */
  dispose(): void {
    this.stopMetricsPolling();
    for (const unsubscribe of this.routingUnsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        /* 退订失败忽略 */
      }
    }
    this.client.dispose();
  }

  /** 登录成功后连接 WS；失败只 toast，不阻止登录成功。 */
  private async connectAfterAuth(): Promise<void> {
    try {
      await this.client.connect();
      this.connection.refreshMetrics();
    } catch (error) {
      this.toast.fromError(error, '连接失败');
    }
  }

  /**
   * 推送路由表：**只按 cmd 段转发**，载荷解释权在域 Store。
   * `system.notice` / `battle.log|lot` 目前并入世界日志与 Toast（见各 Store 的 handleNotification）。
   */
  private routeNotification(notification: PushFrame): void {
    switch (notification.cmd) {
      case WORLD_CMD.cmd:
        this.world.handleNotification(notification);
        return;
      case INVENTORY_CMD.cmd:
        this.inventory.handleNotification(notification);
        return;
      case CAREER_CMD.cmd:
        this.career.handleNotification(notification);
        return;
      case STORY_CMD.cmd:
        this.story.handleNotification(notification);
        return;
      case IDLE_CMD.cmd:
        this.idle.handleNotification(notification);
        return;
      case BATTLE_CMD.cmd:
        this.world.handleNotification(notification);
        return;
      default:
        return;
    }
  }

  private startMetricsPolling(): void {
    if (this.autoRefreshMetricsMs <= 0) return;
    if (this.metricsTimer !== null) return;
    this.metricsTimer = setInterval(() => {
      this.connection.refreshMetrics();
    }, this.autoRefreshMetricsMs);
  }

  private stopMetricsPolling(): void {
    if (this.metricsTimer === null) return;
    clearInterval(this.metricsTimer);
    this.metricsTimer = null;
  }
}
