/**
 * 逻辑域**跨服事件契约**（08 §2.3 解环用；R1-a2）
 *
 * 背景：`world/story/inventory/career` 之间存在三条真实环（见 09 §0.3 环快照）：
 * - `world → story`（进图推进剧情）↔ `story → world`（读当前地图）
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

/** 进入（或首次落在地图）某张图：由 battle 会话宿主发布，quest 订阅推进剧情。 */
export interface MapEnteredEvent {
  readonly type: 'MapEntered';
  readonly userId: number;
  readonly characterId: string;
  /** 地图 key（`tables.maps` 的键）。 */
  readonly map: string;
}

/** 战斗内核击杀：由 battle 发布，quest 订阅递减剧情击杀任务。 */
export interface EnemyKilledEvent {
  readonly type: 'EnemyKilled';
  readonly userId: number;
  readonly characterId: string;
  /** 怪物类型 key（`tables.monsters` 的键，如 `slime.minimal`）。 */
  readonly enemyType: string;
  /** 本次击杀数量（内核保证 ≥1）。 */
  readonly count: number;
}

/** 战斗 hook 需重绑：由 item / character 面板域发布，battle 订阅置脏标记。 */
export interface CombatHooksDirtyEvent {
  readonly type: 'CombatHooksDirty';
  readonly userId: number;
  readonly characterId: string;
}

/** 事件名 → 载荷 的映射（订阅端的类型来源）。 */
export interface DomainEventMap {
  MapEntered: MapEnteredEvent;
  EnemyKilled: EnemyKilledEvent;
  CombatHooksDirty: CombatHooksDirtyEvent;
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
