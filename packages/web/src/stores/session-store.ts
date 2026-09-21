/**
 * SessionStore —— JWT / 账号 / 角色列表（会话生命周期）。
 *
 * 职责边界：
 * - **REST** 只做「登录 / me」（后端职责划分：REST = auth + 账号信息）；
 * - 角色列表 / 创建 / 选择走 WS typed API（`player` 段）；选择结果（`PlayerStateDto`）
 *   交给 `PlayerStore` 持有 —— 本 Store 只记「当前选中的角色 key」与元数据；
 * - token 落 `localStorage`；`?token=` 由 transport 在握手时拼接（本 Store 不碰连接）。
 *
 * 竞态：角色列表 / 选择的响应回写一律过 `LoadGuard`（快速切换角色时旧响应必须丢弃）。
 */
import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { MeDto, PlayerMetaDto, PlayerStateDto } from '@idle-dark/protocol';
import {
  failureCodeOf,
  failureMessageOf,
  toastFailure,
  type GameApi,
  type RestClient,
} from '../services/game-client.js';
import { safeGet, safeRemove, safeSet, type StorageLike } from '../services/storage.js';
import { LoadGuard } from './load-guard.js';
import type { ToastStore } from './toast-store.js';

export const TOKEN_STORAGE_KEY = 'idle-dark:token';
export const ME_STORAGE_KEY = 'idle-dark:me';
/**
 * 「上次进入的角色」缓存键。
 *
 * 刷新页面时用它**自动进入角色**（不再强制走选角页）。载荷形状见 {@link CachedCharacter}。
 */
export const ACTIVE_PLAYER_STORAGE_KEY = 'idle-dark:active-player';

/**
 * 已选角色的缓存载荷。
 *
 * ⚠️ **必须带 `userId`**：`key` 是服务端生成的角色 UUID，不同账号的 key 互不相干，
 * 但「同一浏览器先登 A 再登 B」时若不校验账号，B 就会拿着 A 的 key 去 `player.select`
 * —— 服务端会以 `PLAYER_NOT_FOUND` 拒绝（`resolveActiveCharacter` 的归属校验），
 * 表现为「换个账号一进页面就弹一个莫名其妙的错误」。
 */
export interface CachedCharacter {
  userId: string;
  key: string;
}

export type SessionStatus = 'anonymous' | 'authenticating' | 'authenticated';

export class SessionStore {
  token: string | null = null;
  me: MeDto | null = null;
  players: PlayerMetaDto[] = [];
  /** 当前进入的角色 key（null = 尚未选择）。 */
  activePlayerKey: string | null = null;
  status: SessionStatus = 'anonymous';
  /** 登录 / 建角 / 选择在途。 */
  busy = false;
  /** 页面内联可展示的错误文案（与 Toast 同源）。 */
  errorMessage: string | null = null;
  /** 角色列表加载态。 */
  playersLoading = false;
  /**
   * 会话恢复（`RootStore.bootstrap()`）进行中。
   *
   * 用途只有一个：**别在首帧按「还没有角色」渲染建角页**。刷新页面时
   * `players` 还没拉回来（空数组），`App` 的三态门会先落到建角页，几十毫秒后
   * 才跳走 —— 这就是一次可见的错误页面闪烁。`App` 在 `restoring === true` 时
   * 渲染「正在恢复会话」，等 bootstrap 落定再决定去哪个页面。
   */
  restoring = false;

  private readonly guard = new LoadGuard();

  constructor(
    private readonly api: GameApi,
    private readonly rest: RestClient,
    private readonly storage: StorageLike,
    private readonly toast: ToastStore,
  ) {
    makeAutoObservable<this, 'api' | 'rest' | 'storage' | 'toast' | 'guard'>(
      this,
      { api: false, rest: false, storage: false, toast: false, guard: false, players: observable.shallow },
      { autoBind: true },
    );
  }

  get isAuthenticated(): boolean {
    return this.token !== null;
  }

  /** 已建角（至少一个角色）。 */
  get hasPlayers(): boolean {
    return this.players.length > 0;
  }

  /** 已进入游戏（选中了角色）。 */
  get hasCharacter(): boolean {
    return this.activePlayerKey !== null;
  }

  get activePlayer(): PlayerMetaDto | undefined {
    return this.players.find((player) => player.key === this.activePlayerKey);
  }

  /** 从本地存储恢复登录态（不校验 token —— 由 WS 401 拒升级 / REST 401 兜底）。 */
  restore(): boolean {
    const token = safeGet(this.storage, TOKEN_STORAGE_KEY);
    const rawMe = safeGet(this.storage, ME_STORAGE_KEY);
    let me: MeDto | null = null;
    if (rawMe !== null) {
      try {
        me = JSON.parse(rawMe) as MeDto;
      } catch {
        me = null;
      }
    }
    runInAction(() => {
      this.token = token !== null && token !== '' ? token : null;
      this.me = me;
      this.status = this.token !== null ? 'authenticated' : 'anonymous';
    });
    return this.token !== null;
  }

  // ────────────────────────── 已选角色缓存（刷新自动进角色） ──────────────────────────

  /** 标记会话恢复进行中（`RootStore.bootstrap()` 调用；见 `restoring` 字段）。 */
  setRestoring(value: boolean): void {
    runInAction(() => {
      this.restoring = value === true;
    });
  }

  /**
   * 读出缓存的「上次进入的角色」并**三重校验**；任一不满足都返回 `null`。
   *
   * 校验：① 载荷可解析且形状正确；② `userId` 与当前账号一致；③ key 仍在角色列表里。
   *
   * ⚠️ 校验失败时会**清掉缓存**（`userId` 不匹配 / 角色已被删）——那是确定性失效，
   * 留着它只会让每次刷新都白试一次。但**网络/服务端瞬时失败不清缓存**：
   * 那种情况下下次刷新应该继续重试自动进入。
   */
  resumePlayerKey(): string | null {
    const cached = this.readCachedCharacter();
    if (cached === null) return null;
    const userId = this.me?.userId;
    if (typeof userId !== 'string' || userId === '' || userId !== cached.userId) {
      this.clearCachedCharacter();
      return null;
    }
    if (!this.players.some((player) => player.key === cached.key)) {
      this.clearCachedCharacter();
      return null;
    }
    return cached.key;
  }

  /** 读缓存载荷（损坏 / 形状不对一律 `null`，不抛错）。 */
  private readCachedCharacter(): CachedCharacter | null {
    const raw = safeGet(this.storage, ACTIVE_PLAYER_STORAGE_KEY);
    if (raw === null || raw === '') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== 'object') return null;
    const record = parsed as { userId?: unknown; key?: unknown };
    if (typeof record.userId !== 'string' || typeof record.key !== 'string') return null;
    if (record.userId === '' || record.key === '') return null;
    return { userId: record.userId, key: record.key };
  }

  /** 清掉「上次进入的角色」缓存（登出 / 换账号 / 回到选角页 / 角色被删）。 */
  clearCachedCharacter(): void {
    safeRemove(this.storage, ACTIVE_PLAYER_STORAGE_KEY);
  }

  /**
   * 落盘「上次进入的角色」。
   *
   * `me` 缺失时**不写**：没有账号 id 就无从校验，写下去等于埋一个跨账号误用的雷。
   */
  private persistActivePlayer(key: string): void {
    const userId = this.me?.userId;
    if (typeof userId !== 'string' || userId === '' || key === '') return;
    safeSet(this.storage, ACTIVE_PLAYER_STORAGE_KEY, JSON.stringify({ userId, key }));
  }

  /** REST 登录；成功后 token 落盘。失败不抛（返回 false + Toast）。 */
  async login(username: string, password: string): Promise<boolean> {
    return this.authenticate('login', username, password);
  }

  /** 清掉页面内联错误（登录/注册切换时用，避免上一个模式的报错残留）。 */
  clearError(): void {
    if (this.errorMessage === null) return;
    this.errorMessage = null;
  }

  /**
   * REST 注册；服务端注册成功即签发 token，因此**注册后直接进入已登录态**（无需再登录一次）。
   * 失败不抛（返回 false + Toast + `errorMessage`）。
   */
  async register(username: string, password: string): Promise<boolean> {
    return this.authenticate('register', username, password);
  }

  /**
   * 登录 / 注册的唯一实现。
   *
   * 两者除了「打哪个端点」与「失败文案」之外**完全同构**（都返回
   * `ActionResult<LoginResponseDto>`），所以合并到一处，避免两条链路的
   * token 落盘 / 状态机 / 竞态处理出现分叉。
   */
  private async authenticate(
    kind: 'login' | 'register',
    username: string,
    password: string,
  ): Promise<boolean> {
    const fallback = kind === 'login' ? '登录失败' : '注册失败';
    runInAction(() => {
      this.busy = true;
      this.status = 'authenticating';
      this.errorMessage = null;
    });
    try {
      const result =
        kind === 'login'
          ? await this.rest.login({ username, password })
          : await this.rest.register({ username, password });

      if (result.success === false) {
        const code = failureCodeOf(result);
        const message = failureMessageOf(result);
        runInAction(() => {
          this.status = 'anonymous';
          this.errorMessage = message ?? code ?? fallback;
        });
        toastFailure(this.toast, result, fallback);
        return false;
      }

      const data = result.data;
      if (typeof data?.token !== 'string' || data.token.length === 0) {
        throw new Error(`${fallback}：响应缺少 token`);
      }

      runInAction(() => {
        this.token = data.token;
        this.me = {
          userId: data.userId,
          displayName: data.displayName,
          diamonds: 0,
          playerSlotCount: 0,
        };
        this.status = 'authenticated';
        this.errorMessage = null;
        // 换账号/新注册都要清掉上一个会话选中的角色，避免误用到他人的 key
        this.activePlayerKey = null;
        this.players = [];
      });
      safeSet(this.storage, TOKEN_STORAGE_KEY, data.token);
      safeSet(this.storage, ME_STORAGE_KEY, JSON.stringify(this.me));
      // 换账号/注册都要丢掉上一个账号的角色缓存：`resumePlayerKey()` 还有 userId 校验兜底，
      // 这里主动清一次是为了不给「跨账号误用」留任何入口。
      this.clearCachedCharacter();
      return true;
    } catch (error) {
      runInAction(() => {
        this.status = 'anonymous';
        this.errorMessage = error instanceof Error ? error.message : String(error);
      });
      this.toast.fromError(error, fallback);
      return false;
    } finally {
      runInAction(() => {
        this.busy = false;
      });
    }
  }

  logout(): void {
    runInAction(() => {
      this.token = null;
      this.me = null;
      this.players = [];
      this.activePlayerKey = null;
      this.status = 'anonymous';
      this.errorMessage = null;
    });
    safeRemove(this.storage, TOKEN_STORAGE_KEY);
    safeRemove(this.storage, ME_STORAGE_KEY);
    // 登出后**不再自动进入角色**：否则下一次打开页面会绕过登录页的语义回到游戏。
    this.clearCachedCharacter();
  }

  /** WS / REST 401 兜底：token 失效时清会话并提示。 */
  handleUnauthorized(): void {
    if (this.token === null) return;
    this.logout();
    this.toast.error('登录状态已失效', '请重新登录');
  }

  /** 拉取账号信息（WS `(auth, me)`）。失败静默（不打断主流程）。 */
  async loadMe(): Promise<boolean> {
    if (this.token === null) return false;
    try {
      const result = await this.api.auth.me();
      if (result.success === false || result.data === undefined) return false;
      const data = result.data;
      runInAction(() => {
        this.me = data;
      });
      safeSet(this.storage, ME_STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  /** 拉取角色列表（WS `(player, list)`）。 */
  async loadPlayers(): Promise<void> {
    if (this.token === null) return;
    const token = this.guard.next();
    runInAction(() => {
      this.playersLoading = true;
    });
    try {
      const result = await this.api.player.list();
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.toast, result, '角色列表加载失败');
        return;
      }
      const players = result.data ?? [];
      let dropped = false;
      runInAction(() => {
        this.players = players;
        // 选中的角色被删掉时回落
        if (this.activePlayerKey !== null && !players.some((p) => p.key === this.activePlayerKey)) {
          this.activePlayerKey = null;
          dropped = true;
        }
      });
      // 当前角色已不在列表里 → 缓存也就失效了（否则每次刷新都会白试一次自动进入）
      if (dropped) this.clearCachedCharacter();
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      this.toast.fromError(error, '角色列表加载失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.playersLoading = false;
        });
      }
    }
  }

  /** 建角（WS `(player, create)`）。成功返回新角色元数据。 */
  async createPlayer(name: string, role: string): Promise<PlayerMetaDto | null> {
    runInAction(() => {
      this.busy = true;
      this.errorMessage = null;
    });
    try {
      const result = await this.api.player.create({ name, role });
      if (result.success === false) {
        const code = failureCodeOf(result);
        const message = failureMessageOf(result);
        runInAction(() => {
          this.errorMessage = message ?? code ?? '创建角色失败';
        });
        toastFailure(this.toast, result, '创建角色失败');
        return null;
      }
      const player = result.data ?? null;
      if (player !== null) {
        runInAction(() => {
          this.players = [...this.players, player];
        });
      }
      this.toast.success('角色创建成功', player?.name);
      return player;
    } catch (error) {
      runInAction(() => {
        this.errorMessage = error instanceof Error ? error.message : String(error);
      });
      this.toast.fromError(error, '创建角色失败');
      return null;
    } finally {
      runInAction(() => {
        this.busy = false;
      });
    }
  }

  /**
   * 选择并进入角色（WS `(player, select)`）；返回服务端下发的完整角色态。
   * 失败返回 null（Toast 已发）。
   */
  async selectPlayer(key: string): Promise<PlayerStateDto | null> {
    const token = this.guard.next();
    runInAction(() => {
      this.busy = true;
      this.errorMessage = null;
    });
    try {
      const result = await this.api.player.select({ key });
      if (!this.guard.isCurrent(token)) return null;
      if (result.success === false) {
        toastFailure(this.toast, result, '进入角色失败');
        return null;
      }
      const state = result.data;
      if (state === undefined) throw new Error('角色选择响应缺少 data');
      runInAction(() => {
        this.activePlayerKey = state.key;
      });
      // 记住「上次进入的角色」：下次刷新页面直接自动进入，不再强制走选角页。
      this.persistActivePlayer(state.key);
      return state;
    } catch (error) {
      if (!this.guard.isCurrent(token)) return null;
      this.toast.fromError(error, '进入角色失败');
      return null;
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.busy = false;
        });
      }
    }
  }

  /** 删除角色（WS `(player, remove)`）。 */
  async removePlayer(key: string): Promise<boolean> {
    try {
      const result = await this.api.player.remove({ key });
      if (result.success === false) {
        toastFailure(this.toast, result, '删除角色失败');
        return false;
      }
      runInAction(() => {
        this.players = this.players.filter((player) => player.key !== key);
        if (this.activePlayerKey === key) this.activePlayerKey = null;
      });
      // 删掉的正是缓存里的角色 → 缓存必须一起清（否则刷新会拿一个不存在的 key 去选角）
      const cached = this.readCachedCharacter();
      if (cached !== null && cached.key === key) this.clearCachedCharacter();
      this.toast.success('角色已删除');
      return true;
    } catch (error) {
      this.toast.fromError(error, '删除角色失败');
      return false;
    }
  }

  /**
   * 退出当前角色、回到选角页（不登出账号）。
   *
   * ⚠️ 同时清掉缓存：这是用户**主动**离开角色的动作，刷新页面时应当停在选角页，
   * 而不是把用户刚刚离开的角色又自动进回去。
   */
  leaveCharacter(): void {
    runInAction(() => {
      this.activePlayerKey = null;
    });
    this.clearCachedCharacter();
  }
}
