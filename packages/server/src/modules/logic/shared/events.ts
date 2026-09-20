/**
 * 逻辑域**跨服事件契约**（08 §2.3 解环用；R1-a2）
 *
 * 背景：`world/inventory/career` 之间存在真实环（见 09 §0.3 环快照）：
 * - `world → inventory`（推送助手 / 当前角色，已由 R1-a1 上移 shared 消除）
 * - `inventory/career/produce → world`（`markCombatDirty`）↔ `world → inventory`
 *
 * 破解方式（08 §2.3）：**副作用方向改为事件**，订阅方与发布方都只依赖本文件 ——
 * 于是依赖图变成单向（发布方 → 事件端口 ← 订阅方），不再互相 import 具体服务。
 *
 * 约定：
 * - 事件是**进程内、同步派发**的（单进程阶段 A2）；接口面向未来跨进程（08 阶段 6）保持数据化。
 * - 载荷只用原始类型，**不携带 `Player` / 服务实例**，便于将来序列化。
 * - 事件名即 `type` 字段，订阅按名注册。
 */

/** 战斗 hook 需重绑：由 item / character 面板域发布，battle 订阅置脏标记。 */
export interface CombatHooksDirtyEvent {
  readonly type: 'CombatHooksDirty';
  readonly userId: number;
  readonly characterId: string;
}

/**
 * 混沌仪一次挑战已结算（W6）：由 battle 发布，`idle`（混沌仪）订阅。
 *
 * - `outcome: 'clear'` = 混沌图守关 BOSS 被击杀；`'death'` = 玩家在混沌图中阵亡；
 * - `tier` = 本次挑战的 T 阶（1~16）；battle 只报告事实，**不决定**下一步（失败分支在混沌仪）。
 * - 只在**在线 tick** 发布；离线推进由 `IdleService` 直接读内核的同一结果。
 */
export interface ChaosRunEndedEvent {
  readonly type: 'ChaosRunEnded';
  readonly userId: number;
  readonly characterId: string;
  readonly tier: number;
  readonly outcome: 'clear' | 'death';
}

/** 事件名 → 载荷 的映射（订阅端的类型来源）。 */
export interface DomainEventMap {
  CombatHooksDirty: CombatHooksDirtyEvent;
  ChaosRunEnded: ChaosRunEndedEvent;
}

export type DomainEventName = keyof DomainEventMap;
export type DomainEvent = DomainEventMap[DomainEventName];

/**
 * 事件总线端口（进程内实现见 `event-bus.ts`）。
 *
 * 只暴露「发布」与「订阅」两件事，**不含业务**；将来换分布式实现时消费方代码不变。
 */
export interface EventBus {
  /** 同步派发；订阅方异常被记录后跳过，不影响其它订阅方与发布方。 */
  emit<E extends DomainEvent>(event: E): void;
  /** 订阅；返回取消订阅函数（重复取消是 no-op）。 */
  on<K extends DomainEventName>(name: K, handler: (event: DomainEventMap[K]) => void): () => void;
}

/** 注入事件总线的令牌。 */
export const EVENT_BUS = Symbol('EVENT_BUS');
