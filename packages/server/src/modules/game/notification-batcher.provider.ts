/**
 * `NotificationBatcher` 的装配（显式 token + 工厂提供者）。
 *
 * 为什么用显式 token 而不是 `@Injectable` + 构造参数：
 * Nest 对**普通对象**构造参数无法推断 provider，会把它当成 `Object` 令牌去解析并启动失败
 * （框架已知坑，见 `AGENTS.md` §5.2）。显式 token + `useFactory` 同时满足
 * 「可注入」与「可单测直接 new」。
 */
import type { Provider } from '@nestjs/common';
import { NOTIFICATION_PORT, type NotificationMessage, type NotificationPort } from '../../common/ports/notification.port.js';
import { NotificationBatcher, type BatchFlushHandler, type NotificationBatcherOptions } from './notification-batcher.js';

/** 注入 `NotificationBatcher` 实例的令牌。 */
export const NOTIFICATION_BATCHER = Symbol('NOTIFICATION_BATCHER');
/** 注入 `NotificationBatcherOptions` 的令牌（默认 `{}`，可被覆盖）。 */
export const NOTIFICATION_BATCHER_OPTIONS = Symbol('NOTIFICATION_BATCHER_OPTIONS');

export interface NotificationBatcherProviderOptions extends NotificationBatcherOptions {
  /**
   * 本批次发生过丢帧时的回调。
   *
   * 丢帧意味着客户端快照必然陈旧 —— 调用方应在此推一次全量快照，或推一个
   * 「请重新拉取」的信令，而**不能**让客户端继续在旧快照上演算。
   * 未提供时只记一条 warn（不静默）。
   */
  onResync?: (userId: number, dropped: number) => void;
}

/**
 * 默认 flush 处理器：把批次内的帧逐条投递给定向推送端口。
 *
 * 端口为 null（未启用 WS）时静默丢弃 —— 与 `sendNotification` 未命中返回 false 的语义一致。
 */
export function createPortFlushHandler(
  port: NotificationPort | null,
  options: NotificationBatcherProviderOptions = {},
): BatchFlushHandler {
  return (userId, frames, meta) => {
    if (meta.resync) {
      if (options.onResync !== undefined) {
        options.onResync(userId, meta.dropped);
      } else {
        console.warn(
          `[idle-dark] 推送丢帧：userId=${userId} dropped=${meta.dropped} —— 客户端快照已陈旧，请补推全量`,
        );
      }
    }
    if (port === null) return;
    for (const frame of frames) {
      const message: NotificationMessage = {
        cmd: frame.cmd,
        subCmd: frame.subCmd,
        ...(frame.data !== undefined ? { data: frame.data } : {}),
        ...(frame.type !== undefined ? { type: frame.type } : {}),
      };
      port.sendTo(userId, message);
    }
  };
}

/** 生成 `NOTIFICATION_BATCHER` 与 `NOTIFICATION_BATCHER_OPTIONS` 两个提供者。 */
export function createNotificationBatcherProviders(): Provider[] {
  return [
    { provide: NOTIFICATION_BATCHER_OPTIONS, useValue: {} as NotificationBatcherProviderOptions },
    {
      provide: NOTIFICATION_BATCHER,
      inject: [NOTIFICATION_PORT, NOTIFICATION_BATCHER_OPTIONS],
      useFactory: (
        port: NotificationPort | null,
        options: NotificationBatcherProviderOptions,
      ): NotificationBatcher => {
        const batcher = new NotificationBatcher(createPortFlushHandler(port, options), options);
        batcher.start();
        return batcher;
      },
    },
  ];
}
