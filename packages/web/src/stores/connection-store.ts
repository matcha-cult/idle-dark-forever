/**
 * ConnectionStore —— 连接状态 / 延迟 / 心跳 / 服务器时间偏移的只读视图。
 *
 * 数据源是 transport 层回调（由 `GameClient` 转发），本 Store **不直接驱动 socket**，
 * 避免状态双写。
 */
import { makeAutoObservable, runInAction } from 'mobx';
import type { ConnectionState } from '@idle-dark/ionet-transport';
import type { GameClient, ServerTimeInfo } from '../services/game-client.js';

export class ConnectionStore {
  /** 连接状态机当前态（idle/connecting/online/reconnecting/closed/failed）。 */
  state: ConnectionState = 'idle';
  detail: string | undefined;
  /** 最近一次请求 RTT（毫秒）。 */
  latencyMs: number | null = null;
  /** 心跳累计 ack 次数（存活证据）。 */
  heartbeatAcks = 0;
  /** 服务端时间 − 本地时间（毫秒）；服务端未提供时 null。 */
  serverTimeOffsetMs: number | null = null;
  lastServerTimeMs: number | null = null;
  /** 用户主动点击的「连接/断开」动作是否在途。 */
  actionPending = false;

  constructor(private readonly client: GameClient) {
    makeAutoObservable<this, 'client'>(this, { client: false }, { autoBind: true });
  }

  get isOnline(): boolean {
    return this.state === 'online';
  }

  get isBusy(): boolean {
    return this.state === 'connecting' || this.state === 'reconnecting';
  }

  /** 由 `GameClient` 的 onStateChange 回调驱动。 */
  handleStateChange(state: ConnectionState, detail?: string): void {
    runInAction(() => {
      this.state = state;
      this.detail = detail;
    });
  }

  /** 由 `GameClient` 的 onServerTime 回调驱动。 */
  handleServerTime(info: ServerTimeInfo): void {
    runInAction(() => {
      this.serverTimeOffsetMs = info.offsetMs;
      this.lastServerTimeMs = info.serverTimeMs;
    });
  }

  /**
   * 轮询 transport 的实时指标（心跳 ack / RTT）。
   *
   * 用**结构读取**而非 `IonetClient` 的具体属性：指标面是 transport 的可选诊断能力，
   * 缺失时保持上一次的值而不是报错。
   */
  refreshMetrics(): void {
    const ionet = this.client.ionet as unknown as {
      heartbeatAcks?: number;
      lastHeartbeatAckAt?: number;
      latencyMs?: number;
    };
    runInAction(() => {
      if (typeof ionet.heartbeatAcks === 'number') this.heartbeatAcks = ionet.heartbeatAcks;
      if (typeof ionet.latencyMs === 'number') this.latencyMs = ionet.latencyMs;
    });
  }

  /** 手动连接：失败返回 false（Toast 由调用方决定）。 */
  async connect(): Promise<boolean> {
    runInAction(() => {
      this.actionPending = true;
    });
    try {
      await this.client.connect();
      this.refreshMetrics();
      return true;
    } catch {
      runInAction(() => {
        this.detail = '连接失败';
      });
      return false;
    } finally {
      runInAction(() => {
        this.actionPending = false;
      });
    }
  }

  disconnect(): void {
    this.client.disconnect('user-close');
    this.handleStateChange('closed', '用户主动断开');
  }
}
