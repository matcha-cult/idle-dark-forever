/**
 * 在线会话登记（内存实现；本工程不用 Redis）
 *
 * 「在线」= 服务端自己能观察到的两个事实，**不接受任何客户端上报的时长**：
 * 1. 存在一条活着的 WS 会话 —— 框架连接注册表（握手鉴权通过即登记，close / 心跳踢除即注销）；
 *    连接注册表不可用时退化为「最近一次 `touch` 在 TTL 之内」；
 * 2. 是否被显式 touch（应用层心跳 `system.ping`、任意鉴权交互都会刷新）。
 *
 * 用途：后续决定「是否推送」（离线角色不推 tick）、离线结算锚点判定等。
 * 本服务**只记录事实，不做业务判定**。
 *
 * 依赖 IONET_WS_SERVER 是 `@Optional`：单测 / 未启用 WS 时退化为纯内存 TTL 口径。
 * 注意构造参数全部有显式 DI token / 类型（IONET_WS_SERVER 是 Symbol → 必须 @Inject），
 * 因此不存在「Nest 把 Object 当 provider 解析」的问题。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { IONET_WS_SERVER } from '@nbb-ionet/extension-nestjs';

/** 应用层心跳 TTL：客户端建议 15s 一发，留 3 次容错。 */
export const DEFAULT_HEARTBEAT_TTL_MS = 45_000;

/** 连接注册表所需的最小结构（只依赖能力，不依赖框架具体类型）。 */
export interface OnlineConnectionRegistry {
  isLocalUser(userId: string): boolean;
  getLocalUserIds(): string[];
}

export interface OnlineWsServerLike {
  readonly connectionRegistry?: OnlineConnectionRegistry;
}

@Injectable()
export class OnlineSessionService {
  /** `userId → 最近一次 touch 时刻（ms）`。 */
  private readonly lastSeenAt = new Map<number, number>();
  private readonly heartbeatTtlMs: number;

  /** 可替换时钟（单测注入固定时间用）；生产保持 `Date.now`。 */
  now: () => number = Date.now;

  constructor(
    @Optional() @Inject(IONET_WS_SERVER) private readonly wsServer: OnlineWsServerLike | null = null,
  ) {
    this.heartbeatTtlMs = DEFAULT_HEARTBEAT_TTL_MS;
  }

  /** 刷新活跃时刻（应用层心跳 / 任意鉴权交互）。非法 userId（<=0）忽略。 */
  touch(userId: number, at: number = this.now()): void {
    if (!Number.isSafeInteger(userId) || userId <= 0) return;
    this.lastSeenAt.set(userId, at);
  }

  /** 会话是否活着：连接注册表优先，不可用时回落到心跳 TTL。 */
  isSessionAlive(userId: number, at: number = this.now()): boolean {
    if (!Number.isSafeInteger(userId) || userId <= 0) return false;
    const registry = this.wsServer?.connectionRegistry;
    if (registry) return registry.isLocalUser(String(userId));
    return this.touchedRecently(userId, at);
  }

  /** 在线 = 活着的 WS 会话（注册表优先，否则最近 touch 未过期）。 */
  isOnline(userId: number, at: number = this.now()): boolean {
    return this.isSessionAlive(userId, at);
  }

  /** 当前在线 userId 列表（去重；推送扫描入口）。 */
  list(at: number = this.now()): number[] {
    const registry = this.wsServer?.connectionRegistry;
    const candidates = registry
      ? registry
          .getLocalUserIds()
          .map((raw) => Number(raw))
          .filter((id) => Number.isSafeInteger(id) && id > 0)
      : [...this.lastSeenAt.keys()];
    const online = new Set<number>();
    for (const id of candidates) {
      if (this.isOnline(id, at)) online.add(id);
    }
    return [...online];
  }

  /** 会话断开 / 登出：清理内存登记（幂等）。 */
  forget(userId: number): void {
    if (!Number.isSafeInteger(userId)) return;
    this.lastSeenAt.delete(userId);
  }

  /** 清理超过 TTL 的记录（防内存无界增长）。返回清理条数。 */
  sweep(at: number = this.now()): number {
    let removed = 0;
    for (const [userId, seenAt] of [...this.lastSeenAt]) {
      if (at - seenAt > this.heartbeatTtlMs) {
        this.lastSeenAt.delete(userId);
        removed++;
      }
    }
    return removed;
  }

  /** 登记规模（运维 / 测试可见）。 */
  get size(): number {
    return this.lastSeenAt.size;
  }

  private touchedRecently(userId: number, at: number): boolean {
    const seenAt = this.lastSeenAt.get(userId);
    if (seenAt === undefined) return false;
    return at - seenAt <= this.heartbeatTtlMs;
  }
}
