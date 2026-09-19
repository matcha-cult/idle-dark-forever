/**
 * 进程内事件总线（`EventBus` 端口默认实现）
 *
 * - **同步派发**：发布方调用 `emit` 即立刻跑完全部订阅方 —— 保持与解环前的直接调用
 *   完全相同的时序（进图剧情推送 / 击杀任务递减都在同一 tick 内完成）。
 * - 单个订阅方抛错**被记录后跳过**，不影响其它订阅方与发布方（避免一条业务链拖垮 tick）；
 *   这是显式降级（有日志），不是静默吞异常。
 * - 订阅表用 `Set` 保持注册顺序，派发时拷贝一份，允许订阅方在回调里取消订阅。
 */
import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent, DomainEventMap, DomainEventName, EventBus } from './events.js';

type AnyHandler = (event: never) => void;

@Injectable()
export class InProcessEventBus implements EventBus {
  private readonly logger = new Logger(InProcessEventBus.name);
  private readonly handlers = new Map<DomainEventName, Set<AnyHandler>>();

  emit<E extends DomainEvent>(event: E): void {
    const set = this.handlers.get(event.type as DomainEventName);
    if (set === undefined || set.size === 0) return;
    for (const handler of [...set]) {
      try {
        (handler as (e: DomainEvent) => void)(event);
      } catch (error) {
        this.logger.warn(`事件订阅方异常：${event.type}`, {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  on<K extends DomainEventName>(name: K, handler: (event: DomainEventMap[K]) => void): () => void {
    let set = this.handlers.get(name);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as AnyHandler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.handlers.get(name);
      current?.delete(handler as AnyHandler);
      if (current !== undefined && current.size === 0) this.handlers.delete(name);
    };
  }

  /** 已注册订阅数（观测 / 测试可见）。 */
  handlerCountOf(name: DomainEventName): number {
    return this.handlers.get(name)?.size ?? 0;
  }
}

export type { DomainEventMap };
