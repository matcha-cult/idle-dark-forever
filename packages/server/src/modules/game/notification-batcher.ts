/**
 * 推送批次聚合 + 节流 —— **推送风暴防线**。
 *
 * 为什么必须有：原版《永夜》的 `message` 总线是「每次伤害一条事件」，战斗在服务端跑起来后
 * 一个角色每秒可产生数十~上百条事件。若逐条 `sendNotification`，WS 会被打爆
 * （见 `ai-docs/00-重写总方案.md` §10 与风险 R4）。
 *
 * 策略：
 * - 按 `(userId, cmdMerge)` **去重合并**：同一路由在一个批次内只保留一帧，`data` 经注册的
 *   merger 合并（默认「后者覆盖」；`world.tick` 这类应注册成「累积事件 + 取最新快照」）。
 * - **定时 flush**（默认 200ms ≈ 5Hz）：一个用户的所有待发路由合成一次投递。
 * - **队列上限**：单用户待发路由数达到 `maxRoutesPerUser` 时，**新的路由帧被真正丢弃**
 *   （不占内存）并累计 overflow；flush 时通过 `meta.resync` 告知调用方
 *   —— 丢帧意味着客户端快照必然陈旧，必须让它重新拉全量，而不是继续在旧快照上演算。
 * - `stop()` 会先 flush 再停表，避免关服丢推送。
 *
 * 本类**不使用 Nest 装饰器**：通过 `NOTIFICATION_BATCHER` token 的工厂提供者装配，
 * 既可注入又可单测直接 `new`。
 */
import { cmdMerge } from '@idle-dark/protocol';

export interface PushFrame {
  cmd: number;
  subCmd: number;
  data?: unknown;
  /** 可选事件名（与 `cmd`/`subCmd` 并列）。 */
  type?: string;
}

export interface BatchFlushMeta {
  /** true = 本批次发生过丢帧，调用方应额外推一次全量快照或让客户端重新拉取。 */
  resync: boolean;
  /** 自上次 flush 以来该用户被丢弃的帧数。 */
  dropped: number;
}

export type FrameMerger = (prev: unknown, next: unknown) => unknown;
export type BatchFlushHandler = (userId: number, frames: PushFrame[], meta: BatchFlushMeta) => void;

export interface NotificationBatcherOptions {
  /** flush 周期（ms），默认 200（5Hz）。 */
  flushIntervalMs?: number;
  /** 单用户待发路由上限，默认 32（超出即丢帧 + resync）。 */
  maxRoutesPerUser?: number;
}

export const DEFAULT_FLUSH_INTERVAL_MS = 200;
export const DEFAULT_MAX_ROUTES_PER_USER = 32;

export class NotificationBatcher {
  private readonly queues = new Map<number, Map<number, PushFrame>>();
  /** 溢出计数（未进入队列，故与队列分开记）。 */
  private readonly overflow = new Map<number, number>();
  private readonly mergers = new Map<number, FrameMerger>();
  private readonly handler: BatchFlushHandler;
  private readonly flushIntervalMs: number;
  private readonly maxRoutesPerUser: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly totals = { flushed: 0, dropped: 0, resyncs: 0 };

  constructor(handler: BatchFlushHandler, options: NotificationBatcherOptions = {}) {
    this.handler = handler;
    this.flushIntervalMs = positiveInt(options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS);
    this.maxRoutesPerUser = positiveInt(options.maxRoutesPerUser, DEFAULT_MAX_ROUTES_PER_USER);
  }

  /** 为某路由注册合并策略（例如 `world.tick` 累积事件）。 */
  registerMerger(cmd: number, subCmd: number, merger: FrameMerger): void {
    this.mergers.set(cmdMerge(cmd, subCmd), merger);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.flushAll(), this.flushIntervalMs);
    // 不要因为推送定时器阻止进程退出
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  /** 停表并 flush 剩余帧（关服不丢推送）。 */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flushAll();
  }

  /**
   * 入队一帧。同一 `(userId, cmdMerge)` 在一个批次内只保留一帧。
   *
   * @returns true = 已入队（新建或与既有帧合并）；false = 因路由数超限被**真正丢弃**
   *          （未占内存，已计入 overflow，flush 时通过 `meta.resync` 上报）
   */
  enqueue(userId: number, frame: PushFrame): boolean {
    let queue = this.queues.get(userId);
    if (queue === undefined) {
      queue = new Map();
      this.queues.set(userId, queue);
    }
    const key = cmdMerge(frame.cmd, frame.subCmd);
    const existing = queue.get(key);

    if (existing !== undefined) {
      const merger = this.mergers.get(key);
      const merged = merger === undefined ? frame.data : merger(existing.data, frame.data);
      queue.set(key, { ...frame, data: merged });
      return true;
    }

    if (queue.size >= this.maxRoutesPerUser) {
      this.overflow.set(userId, (this.overflow.get(userId) ?? 0) + 1);
      this.totals.dropped += 1;
      return false;
    }

    queue.set(key, frame);
    return true;
  }

  /**
   * 立即投递某用户的待发帧，返回投递的帧数。
   *
   * 若该用户只有 overflow（队列为空），仍会以空帧 + `resync:true` 调用一次 handler，
   * 让调用方有机会补推全量快照；此时返回 0。
   */
  flushUser(userId: number): number {
    const queue = this.queues.get(userId);
    const dropped = this.overflow.get(userId) ?? 0;
    this.queues.delete(userId);
    this.overflow.delete(userId);

    const frames = queue === undefined ? [] : [...queue.values()];
    if (frames.length === 0 && dropped === 0) return 0;

    this.totals.flushed += frames.length;
    const resync = dropped > 0;
    if (resync) this.totals.resyncs += 1;
    this.handler(userId, frames, { resync, dropped });
    return frames.length;
  }

  /**
   * **丢弃**某用户的全部待发帧（不投递），返回丢掉的帧数。
   *
   * 用途：连接语义发生突变时（例如新 WS 握手把该账号重置为「未选角色」）——
   * 此时队列里可能还压着上一批 `(world, tick)`，若照常 flush 会投给**刚连上、
   * 还停在选角页**的新连接（实测会漏出 1 帧）。这类帧必须丢弃而不是补发。
   */
  drop(userId: number): number {
    const queue = this.queues.get(userId);
    const dropped = this.overflow.get(userId) ?? 0;
    this.queues.delete(userId);
    this.overflow.delete(userId);
    return (queue?.size ?? 0) + dropped;
  }

  /** 立即投递全部待发帧。 */
  flushAll(): { users: number; frames: number } {
    const userIds = new Set<number>([...this.queues.keys(), ...this.overflow.keys()]);
    let users = 0;
    let frames = 0;
    for (const userId of userIds) {
      const sent = this.flushUser(userId);
      users += 1;
      frames += sent;
    }
    return { users, frames };
  }

  /** 运维 / 测试可见的累计指标。 */
  get stats(): {
    flushed: number;
    dropped: number;
    resyncs: number;
    pendingUsers: number;
    pendingFrames: number;
    pendingOverflow: number;
  } {
    let pendingFrames = 0;
    for (const queue of this.queues.values()) pendingFrames += queue.size;
    let pendingOverflow = 0;
    for (const count of this.overflow.values()) pendingOverflow += count;
    return {
      ...this.totals,
      pendingUsers: this.queues.size,
      pendingFrames,
      pendingOverflow,
    };
  }
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}
