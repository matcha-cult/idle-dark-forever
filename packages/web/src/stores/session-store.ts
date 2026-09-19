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

  /** REST 登录；成功后 token 落盘。失败不抛（返回 false + Toast）。 */
  async login(username: string, password: string): Promise<boolean> {
    runInAction(() => {
      this.busy = true;
      this.status = 'authenticating';
      this.errorMessage = null;
    });
    try {
      const result = await this.rest.login({ username, password });
      if (result.success === false) {
        const code = failureCodeOf(result);
        const message = failureMessageOf(result);
        runInAction(() => {
          this.status = 'anonymous';
          this.errorMessage = message ?? code ?? '登录失败';
        });
        toastFailure(this.toast, result, '登录失败');
        return false;
      }
      const data = result.data;
      if (typeof data?.token !== 'string' || data.token.length === 0) throw new Error('登录响应缺少 token');
      runInAction(() => {
        this.token = data.token;
        this.me = {
          userId: data.userId,
          displayName: data.displayName,
          diamonds: 0,
          playerSlotCount: 0,
          highestEndlessLevel: 0,
        };
        this.status = 'authenticated';
        this.errorMessage = null;
        this.activePlayerKey = null;
      });
      safeSet(this.storage, TOKEN_STORAGE_KEY, data.token);
      safeSet(this.storage, ME_STORAGE_KEY, JSON.stringify(this.me));
      return true;
    } catch (error) {
      runInAction(() => {
        this.status = 'anonymous';
        this.errorMessage = error instanceof Error ? error.message : String(error);
      });
      this.toast.fromError(error, '登录失败');
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
      runInAction(() => {
        this.players = players;
        // 选中的角色被删掉时回落
        if (this.activePlayerKey !== null && !players.some((p) => p.key === this.activePlayerKey)) {
          this.activePlayerKey = null;
        }
      });
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
      this.toast.success('角色已删除');
      return true;
    } catch (error) {
      this.toast.fromError(error, '删除角色失败');
      return false;
    }
  }

  /** 退出当前角色、回到选角页（不登出账号）。 */
  leaveCharacter(): void {
    runInAction(() => {
      this.activePlayerKey = null;
    });
  }
}
