/**
 * GameClient —— 应用侧对 transport 层的**唯一装配点**。
 *
 * 把三样东西绑在一起，Store 只依赖本类（与它导出的类型）：
 * - `ionet`：WS 连接状态机（`?token=` 握手 / 心跳 / 退避重连 / reqId 并发）；
 * - `rest`：REST 通道（登录 / me；同源 `/api`，Vite 代理）；
 * - `api`：按 protocol 的 cmd 段组织的 **typed API**，每个方法返回
 *   `Promise<ActionResult<T>>` —— 业务失败**不抛**（归一化为 `ActionFail`），
 *   只有传输层异常才抛（由 Store 的 try/catch 转成 Toast）。
 *
 * 设计取舍（与用户预期接口的差异见交付报告）：
 * - 本文件**不自造 GameApi 类**去猜测 transport 聚合 API 的方法名，而是在
 *   `IonetClient.request(cmd, subCmd, data)` 之上按 `@idle-dark/protocol` 的
 *   `*_CMD` 常量装配 typed 方法。cmd/subCmd 的唯一真相仍是 protocol，不存在手工镜像；
 * - 「业务失败不抛」由 `toActionResult` 统一保证：transport 若抛 `BusinessError`，
 *   这里就地转成 `ActionFail`，于是**所有 Store 只需处理一种失败形态**。
 */
import {
  AUTH_CMD,
  BANK_CMD,
  BATTLE_CMD,
  CAREER_CMD,
  IDLE_CMD,
  INVENTORY_CMD,
  LOOTRULE_CMD,
  PLAYER_CMD,
  PRODUCE_CMD,
  SHOP_CMD,
  STORY_CMD,
  SYSTEM_CMD,
  WORLD_CMD,
  businessErrorMessage,
  isOk,
  type ActionResult,
  type CareerProgressDto,
  type DecomposeResultDto,
  type EnhanceDto,
  type EnchantCostsDto,
  type EquipPosition,
  type EquipmentsDto,
  type InventorySlotDto,
  type LootRuleAction,
  type MedicineStateDto,
  type MeDto,
  type OfflineReportDto,
  type PlayerMetaDto,
  type PlayerStateDto,
  type Quality,
  type ShopStateDto,
  type SkillDto,
  type SlotLimits,
  type StoryDto,
  type StoryPlayDto,
  type WorldSnapshotDto,
} from '@idle-dark/protocol';
import {
  IonetClient,
  type BusinessError,
  type ConnectionState,
  type IonetClientOptions,
} from '@idle-dark/ionet-transport';
import { NotificationBus, type PushFrame } from './notification-bus.js';

// ─────────────────────────── REST（认证） ───────────────────────────

/** REST 失败（非 2xx / 网络错误）。与传输层 errorCode 是两个独立层级。 */
export class RestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'RestError';
  }
}

export interface LoginInput {
  username: string;
  password: string;
}

/** REST 通道：**只做认证与账号信息**，其余游戏交互全走 WS（工程硬约束）。 */
export class RestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | undefined,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  /** `POST /api/auth/login` → `LoginResponseDto`。 */
  async login(input: LoginInput): Promise<ActionResult<{ token: string; expiresAt: number; userId: string; displayName: string }>> {
    return this.post('/auth/login', input, { auth: false });
  }

  /** `GET /api/auth/me` → `MeDto`。 */
  async me(): Promise<ActionResult<MeDto>> {
    return this.get('/auth/me');
  }

  private async get<T>(path: string): Promise<ActionResult<T>> {
    return this.send<T>('GET', path, undefined, { auth: true });
  }

  private async post<T>(path: string, body: unknown, options: { auth: boolean }): Promise<ActionResult<T>> {
    return this.send<T>('POST', path, body, options);
  }

  private async send<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: { auth: boolean },
  ): Promise<ActionResult<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = this.getToken();
    if (options.auth && token !== undefined && token !== '') headers['Authorization'] = `Bearer ${token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new RestError(0, error instanceof Error ? error.message : String(error));
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text !== '') {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      throw new RestError(response.status, extractMessage(parsed) ?? `请求失败（HTTP ${response.status}）`, parsed);
    }
    // REST 端点可能直接返回 ActionResult，也可能直接返回裸 DTO；两种都归一化。
    return toActionResult<T>(parsed);
  }
}

function extractMessage(body: unknown): string | undefined {
  if (body !== null && typeof body === 'object') {
    const record = body as { message?: unknown; errorMessage?: unknown };
    if (typeof record.message === 'string') return record.message;
    if (Array.isArray(record.message) && typeof record.message[0] === 'string') return record.message[0];
    if (typeof record.errorMessage === 'string') return record.errorMessage;
  }
  if (typeof body === 'string' && body.length > 0) return body;
  return undefined;
}

// ─────────────────────────── 域响应形状 ───────────────────────────

/*
 * ⚠️ `packages/protocol/src/dto.ts` 只冻结了**实体** DTO（物品/单位/剧情…），
 * 没有定义每个 Action 的**容器载荷**。以下接口是 web 侧对容器的最小假设，
 * 服务端落地后应回填到 protocol（见交付报告「未完成项/已知限制」）。
 */

/** `(inventory, list)` 载荷。 */
export interface InventoryStateDto {
  equipments: EquipmentsDto;
  inventory: InventorySlotDto[];
  buildInventory: InventorySlotDto[];
  awardInventory: InventorySlotDto[];
  size: number;
}

/** `(bank, list)` 载荷。 */
export interface BankStateDto {
  slots: InventorySlotDto[];
  size: number;
}

/** `(career, list)` 载荷。 */
export interface CareerPanelDto {
  currentCareer: string;
  careers: CareerProgressDto[];
  skills: SkillDto[];
  enhances: EnhanceDto[];
  selectedSkills: string[];
  selectedEnhances: string[];
  slotLimits: SlotLimits;
}

/** 单条自动拾取规则（quality → action）。 */
export interface LootRuleEntryDto {
  quality: Quality;
  action: LootRuleAction;
}

/** `(lootrule, get)` 载荷。 */
export interface LootRuleStateDto {
  rules: LootRuleEntryDto[];
  minLevel: number;
}

/** `(player, list)` 载荷。 */
export interface PlayerListDto {
  players: PlayerMetaDto[];
}

/** `(player, create)` 载荷。 */
export interface PlayerCreatedDto {
  player: PlayerMetaDto;
}

// ─────────────────────────── typed API 输入 ───────────────────────────

export interface CreatePlayerInput {
  name: string;
  role: string;
}

export interface EnterMapInput {
  map: string;
  endlessLevel?: number;
}

export interface EquipInput {
  id: string;
}

export interface SellInput {
  id: string;
  count?: number;
}

export interface LockInput {
  id: string;
  locked: boolean;
}

export interface ContainerItemInput {
  id: string;
  count?: number;
}

export interface EnchantInput {
  id: string;
  /** 本次要锁定的词缀 key（锁定额外消耗神力）。 */
  locks?: string[];
}

export interface RebuildInput {
  id: string;
  affixKey: string;
}

export interface DecomposeInput {
  /** 单件分解。 */
  id?: string;
  /** 整批分解 build 背包。 */
  all?: boolean;
}

export interface MedicineUseInput {
  id: string;
  count?: number;
}

export interface MedicineResetInput {
  method: 'gold' | 'diamonds';
}

export interface ExchangeInput {
  from: string;
  to: string;
  count?: number;
}

/** 按 protocol cmd 段组织的 typed API。 */
export interface GameApi {
  system: {
    ping(): Promise<ActionResult<void>>;
    version(): Promise<ActionResult<{ version: string; noticeVersion?: string }>>;
  };
  auth: {
    me(): Promise<ActionResult<MeDto>>;
    logout(): Promise<ActionResult<void>>;
  };
  player: {
    list(): Promise<ActionResult<PlayerListDto>>;
    create(input: CreatePlayerInput): Promise<ActionResult<PlayerCreatedDto>>;
    remove(key: string): Promise<ActionResult<void>>;
    select(key: string): Promise<ActionResult<PlayerStateDto>>;
  };
  world: {
    snapshot(): Promise<ActionResult<WorldSnapshotDto>>;
    enterMap(input: EnterMapInput): Promise<ActionResult<{ snapshot?: WorldSnapshotDto }>>;
    leave(): Promise<ActionResult<{ snapshot?: WorldSnapshotDto }>>;
    skipOffline(): Promise<ActionResult<void>>;
  };
  battle: {
    focus(input: { unitId: string; targetId: string | null }): Promise<ActionResult<void>>;
  };
  inventory: {
    list(): Promise<ActionResult<InventoryStateDto>>;
    equip(input: EquipInput): Promise<ActionResult<void>>;
    unequip(input: { position: EquipPosition }): Promise<ActionResult<void>>;
    sell(input: SellInput): Promise<ActionResult<void>>;
    lock(input: LockInput): Promise<ActionResult<void>>;
    sort(): Promise<ActionResult<void>>;
    usePackage(input: ContainerItemInput): Promise<ActionResult<void>>;
    expand(): Promise<ActionResult<void>>;
  };
  bank: {
    list(): Promise<ActionResult<BankStateDto>>;
    deposit(input: ContainerItemInput): Promise<ActionResult<void>>;
    withdraw(input: ContainerItemInput): Promise<ActionResult<void>>;
    expand(): Promise<ActionResult<void>>;
  };
  lootRule: {
    get(): Promise<ActionResult<LootRuleStateDto>>;
    update(input: LootRuleStateDto): Promise<ActionResult<void>>;
    setMinLevel(input: { minLevel: number }): Promise<ActionResult<void>>;
  };
  career: {
    list(): Promise<ActionResult<CareerPanelDto>>;
    switchCareer(input: { career: string }): Promise<ActionResult<void>>;
    selectSkill(input: { key: string }): Promise<ActionResult<void>>;
    unselectSkill(input: { key: string }): Promise<ActionResult<void>>;
    selectEnhance(input: { key: string }): Promise<ActionResult<void>>;
    unselectEnhance(input: { key: string }): Promise<ActionResult<void>>;
  };
  produce: {
    enchantCosts(input: { id: string; locks?: string[] }): Promise<ActionResult<EnchantCostsDto>>;
    enchant(input: EnchantInput): Promise<ActionResult<void>>;
    rebuild(input: RebuildInput): Promise<ActionResult<void>>;
    decompose(input: DecomposeInput): Promise<ActionResult<DecomposeResultDto>>;
    medicineState(): Promise<ActionResult<MedicineStateDto>>;
    medicineUse(input: MedicineUseInput): Promise<ActionResult<void>>;
    medicineReset(input: MedicineResetInput): Promise<ActionResult<void>>;
  };
  story: {
    list(): Promise<ActionResult<{ stories: StoryDto[] }>>;
    play(input: { key: string }): Promise<ActionResult<StoryPlayDto>>;
    finish(input: { key: string }): Promise<ActionResult<{ awards?: Record<string, unknown> }>>;
  };
  shop: {
    state(): Promise<ActionResult<ShopStateDto>>;
    buyPlayerSlot(): Promise<ActionResult<void>>;
    exchange(input: ExchangeInput): Promise<ActionResult<void>>;
  };
  idle: {
    report(): Promise<ActionResult<OfflineReportDto>>;
    claim(): Promise<ActionResult<{ claimed: boolean }>>;
  };
}

// ─────────────────────────── 归一化 ───────────────────────────

/**
 * 把 transport 的返回归一化为 `ActionResult<T>`（**业务失败不抛**）。
 *
 * 兼容三种形态：
 * 1. 已是 `ActionResult`（有 boolean `success`）→ 原样返回；
 * 2. 裸信封 `{ data }`（transport 已解包一层）→ 包成成功体；
 * 3. 裸载荷 → 包成成功体。
 */
export function toActionResult<T>(raw: unknown): ActionResult<T> {
  if (raw !== null && typeof raw === 'object' && 'success' in raw) {
    const success = (raw as { success: unknown }).success;
    if (typeof success === 'boolean') return raw as ActionResult<T>;
  }
  if (raw !== null && typeof raw === 'object' && 'data' in raw && Object.keys(raw).length === 1) {
    return { success: true, data: (raw as { data: T }).data };
  }
  return { success: true, data: raw as T };
}

/** 从失败体取文案：服务端 `message` ＞ `businessErrorMessage(code)` ＞ 通用兜底。 */
export function failureMessageOf(result: ActionResult<unknown>, fallback = '操作失败'): string {
  if (isOk(result)) return fallback;
  if (typeof result.message === 'string' && result.message.length > 0) return result.message;
  const code = (result.data as { code?: unknown }).code;
  if (typeof code === 'string' && code.length > 0) return businessErrorMessage(code);
  return fallback;
}

/** 从失败体取业务码（无则 undefined）。 */
export function failureCodeOf(result: ActionResult<unknown>): string | undefined {
  if (isOk(result)) return undefined;
  const code = (result.data as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

// ─────────────────────────── 端点推导 ───────────────────────────

/** 同源 WS 端点推导：`ws(s)://<location.host>/ws`。 */
export function resolveWsUrl(env: unknown = import.meta.env): string {
  const configured = (env as { VITE_WS_URL?: string } | undefined)?.VITE_WS_URL;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  if (typeof location === 'undefined') return 'ws://127.0.0.1:3000/ws';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

/** 同源 REST 前缀推导（Vite 代理 `/api` → 后端）。 */
export function resolveApiBaseUrl(env: unknown = import.meta.env): string {
  const configured = (env as { VITE_API_BASE_URL?: string } | undefined)?.VITE_API_BASE_URL;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  return '/api';
}

// ─────────────────────────── GameClient ───────────────────────────

export interface ServerTimeInfo {
  serverTimeMs: number;
  offsetMs: number;
  rttMs: number;
}

export interface GameClientCallbacks {
  onStateChange(state: ConnectionState, detail?: string): void;
  /** 业务错误回调（transport 主动上报的 `data.success===false`）。 */
  onBusinessError?(error: BusinessError): void;
  onServerTime?(info: ServerTimeInfo): void;
}

export interface GameClientOptions {
  /** WS 端点；缺省同源 `/ws`。 */
  url?: string;
  /** REST 前缀；缺省 `/api`。 */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** 取当前 JWT（握手拼 `?token=`，REST 走 Bearer）。 */
  getToken: () => string | undefined;
  callbacks: GameClientCallbacks;
  /** 测试注入 socket 适配器。 */
  adapterFactory?: IonetClientOptions['adapterFactory'];
  /** 心跳间隔配置（透传 transport）。 */
  heartbeat?: IonetClientOptions['heartbeat'];
  /** 重连配置（透传 transport）。 */
  reconnect?: IonetClientOptions['reconnect'];
  logger?: (...args: unknown[]) => void;
}

export class GameClient {
  readonly ionet: IonetClient;
  readonly rest: RestClient;
  readonly api: GameApi;
  /** 推送路由总线（transport 的推送帧 → 各域 Store）。 */
  readonly notifications = new NotificationBus();

  constructor(options: GameClientOptions) {
    const ionetOptions = {
      url: options.url ?? resolveWsUrl(),
      authHandler: options.getToken,
      onStateChange: options.callbacks.onStateChange,
      ...(options.callbacks.onBusinessError === undefined
        ? {}
        : { onBusinessError: options.callbacks.onBusinessError }),
      ...(options.callbacks.onServerTime === undefined ? {} : { onServerTime: options.callbacks.onServerTime }),
      ...(options.adapterFactory === undefined ? {} : { adapterFactory: options.adapterFactory }),
      ...(options.heartbeat === undefined ? {} : { heartbeat: options.heartbeat }),
      ...(options.reconnect === undefined ? {} : { reconnect: options.reconnect }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      // transport 若支持 `onNotification` 回调，同样收进总线（与 client.notifications 双通道幂等）。
      onNotification: (frame: PushFrame) => this.notifications.dispatch(frame),
    } as IonetClientOptions;

    this.ionet = new IonetClient(ionetOptions);
    // transport 自带推送订阅面时优先复用它（`client.notifications.on` ⇒ 总线路由）。
    attachTransportNotifications(this.ionet, (frame) => this.notifications.dispatch(frame));
    this.rest = new RestClient(
      options.baseUrl ?? resolveApiBaseUrl(),
      options.getToken,
      options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)),
    );
    this.api = createGameApi(this.ionet);
  }

  get state(): ConnectionState {
    return this.ionet.getState();
  }

  connect(): Promise<void> {
    return this.ionet.connect();
  }

  /** 断开连接并清空连接态（登出时调用）：不清 session，仅网络面。 */
  disconnect(detail = 'app-close'): void {
    this.ionet.close(1000, detail);
  }
}

/**
 * 若 transport 暴露了 `client.notifications` 订阅面，则把全部推送转到本地总线。
 * 该适配是**结构探测**（不是类型依赖）：transport 的消息面仍在并行开发中，
 * 两种形态（回调 / 总线）都能工作，且不会因缺一个可选属性而编译失败。
 */
function attachTransportNotifications(
  client: IonetClient,
  sink: (frame: PushFrame) => void,
): void {
  const candidate = (client as unknown as { notifications?: { onAny?: (handler: (frame: PushFrame) => void) => () => void } })
    .notifications;
  if (candidate !== undefined && typeof candidate.onAny === 'function') {
    candidate.onAny(sink);
  }
}

/** 装配 typed API：所有请求都经 `call()`，保证失败形态统一。 */
export function createGameApi(client: IonetClient): GameApi {
  async function call<T>(cmd: number, subCmd: number, data?: unknown): Promise<ActionResult<T>> {
    try {
      const raw: unknown = await client.request(cmd, subCmd, data);
      return toActionResult<T>(raw);
    } catch (error) {
      // transport 也可能以异常形式报告业务失败：就地转成 ActionFail，Store 只处理一种失败形态。
      if (isBusinessError(error)) {
        return {
          success: false,
          ...(typeof error.serverMessage === 'string' ? { message: error.serverMessage } : {}),
          data: { code: typeof error.code === 'string' ? error.code : 'INTERNAL' },
        };
      }
      throw error;
    }
  }

  return {
    system: {
      ping: () => call<void>(SYSTEM_CMD.cmd, SYSTEM_CMD.ping),
      version: () => call<{ version: string; noticeVersion?: string }>(SYSTEM_CMD.cmd, SYSTEM_CMD.version),
    },
    auth: {
      me: () => call<MeDto>(AUTH_CMD.cmd, AUTH_CMD.me),
      logout: () => call<void>(AUTH_CMD.cmd, AUTH_CMD.logout),
    },
    player: {
      list: () => call<PlayerListDto>(PLAYER_CMD.cmd, PLAYER_CMD.list),
      create: (input) => call<PlayerCreatedDto>(PLAYER_CMD.cmd, PLAYER_CMD.create, input),
      remove: (key) => call<void>(PLAYER_CMD.cmd, PLAYER_CMD.remove, { key }),
      select: (key) => call<PlayerStateDto>(PLAYER_CMD.cmd, PLAYER_CMD.select, { key }),
    },
    world: {
      snapshot: () => call<WorldSnapshotDto>(WORLD_CMD.cmd, WORLD_CMD.snapshot),
      enterMap: (input) => call<{ snapshot?: WorldSnapshotDto }>(WORLD_CMD.cmd, WORLD_CMD.enterMap, input),
      leave: () => call<{ snapshot?: WorldSnapshotDto }>(WORLD_CMD.cmd, WORLD_CMD.leave),
      skipOffline: () => call<void>(WORLD_CMD.cmd, WORLD_CMD.skipOffline),
    },
    battle: {
      focus: (input) => call<void>(BATTLE_CMD.cmd, BATTLE_CMD.focus, input),
    },
    inventory: {
      list: () => call<InventoryStateDto>(INVENTORY_CMD.cmd, INVENTORY_CMD.list),
      equip: (input) => call<void>(INVENTORY_CMD.cmd, INVENTORY_CMD.equip, input),
      unequip: (input) => call<void>(INVENTORY_CMD.cmd, INVENTORY_CMD.unequip, input),
      sell: (input) => call<void>(INVENTORY_CMD.cmd, INVENTORY_CMD.sell, input),
      lock: (input) => call<void>(INVENTORY_CMD.cmd, INVENTORY_CMD.lock, input),
      sort: () => call<void>(INVENTORY_CMD.cmd, INVENTORY_CMD.sort),
      usePackage: (input) => call<void>(INVENTORY_CMD.cmd, INVENTORY_CMD.usePackage, input),
      expand: () => call<void>(INVENTORY_CMD.cmd, INVENTORY_CMD.expand),
    },
    bank: {
      list: () => call<BankStateDto>(BANK_CMD.cmd, BANK_CMD.list),
      deposit: (input) => call<void>(BANK_CMD.cmd, BANK_CMD.deposit, input),
      withdraw: (input) => call<void>(BANK_CMD.cmd, BANK_CMD.withdraw, input),
      expand: () => call<void>(BANK_CMD.cmd, BANK_CMD.expand),
    },
    lootRule: {
      get: () => call<LootRuleStateDto>(LOOTRULE_CMD.cmd, LOOTRULE_CMD.get),
      update: (input) => call<void>(LOOTRULE_CMD.cmd, LOOTRULE_CMD.update, input),
      setMinLevel: (input) => call<void>(LOOTRULE_CMD.cmd, LOOTRULE_CMD.setMinLevel, input),
    },
    career: {
      list: () => call<CareerPanelDto>(CAREER_CMD.cmd, CAREER_CMD.list),
      switchCareer: (input) => call<void>(CAREER_CMD.cmd, CAREER_CMD.switchCareer, input),
      selectSkill: (input) => call<void>(CAREER_CMD.cmd, CAREER_CMD.selectSkill, input),
      unselectSkill: (input) => call<void>(CAREER_CMD.cmd, CAREER_CMD.unselectSkill, input),
      selectEnhance: (input) => call<void>(CAREER_CMD.cmd, CAREER_CMD.selectEnhance, input),
      unselectEnhance: (input) => call<void>(CAREER_CMD.cmd, CAREER_CMD.unselectEnhance, input),
    },
    produce: {
      enchantCosts: (input) => call<EnchantCostsDto>(PRODUCE_CMD.cmd, PRODUCE_CMD.enchantCosts, input),
      enchant: (input) => call<void>(PRODUCE_CMD.cmd, PRODUCE_CMD.enchant, input),
      rebuild: (input) => call<void>(PRODUCE_CMD.cmd, PRODUCE_CMD.rebuild, input),
      decompose: (input) => call<DecomposeResultDto>(PRODUCE_CMD.cmd, PRODUCE_CMD.decompose, input),
      medicineState: () => call<MedicineStateDto>(PRODUCE_CMD.cmd, PRODUCE_CMD.medicineState),
      medicineUse: (input) => call<void>(PRODUCE_CMD.cmd, PRODUCE_CMD.medicineUse, input),
      medicineReset: (input) => call<void>(PRODUCE_CMD.cmd, PRODUCE_CMD.medicineReset, input),
    },
    story: {
      list: () => call<{ stories: StoryDto[] }>(STORY_CMD.cmd, STORY_CMD.list),
      play: (input) => call<StoryPlayDto>(STORY_CMD.cmd, STORY_CMD.play, input),
      finish: (input) => call<{ awards?: Record<string, unknown> }>(STORY_CMD.cmd, STORY_CMD.finish, input),
    },
    shop: {
      state: () => call<ShopStateDto>(SHOP_CMD.cmd, SHOP_CMD.state),
      buyPlayerSlot: () => call<void>(SHOP_CMD.cmd, SHOP_CMD.buyPlayerSlot),
      exchange: (input) => call<void>(SHOP_CMD.cmd, SHOP_CMD.exchange, input),
    },
    idle: {
      report: () => call<OfflineReportDto>(IDLE_CMD.cmd, IDLE_CMD.report),
      claim: () => call<{ claimed: boolean }>(IDLE_CMD.cmd, IDLE_CMD.claim),
    },
  };
}

/** 结构判定 transport 的 `BusinessError`（避免 import 其运行时类而耦合）。 */
function isBusinessError(error: unknown): error is BusinessError {
  return (
    error instanceof Error &&
    error.name === 'BusinessError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}
