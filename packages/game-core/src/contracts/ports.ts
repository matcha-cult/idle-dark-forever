/**
 * 时间 / 随机 / 战斗事件 端口契约（**冻结**：并行开发期间禁止改动形状，需要扩展请新增可选字段）。
 *
 * 设计目的：让游戏内核（战斗模拟、掉落、成长）与运行环境解耦——
 * - 服务端：RealClock + 服务端 PRNG + 推送到 WS 的 BattleSink
 * - 离线结算：VirtualClock（有界快进）+ 同一 PRNG + 收集式 BattleSink
 * - 单测：DeterministicClock + 固定种子 + 数组收集 BattleSink
 * - 未来的浏览器单机模式：FrameClock + 本地 PRNG + 本地渲染 Sink
 */

// ────────────────────────────── 时间 ──────────────────────────────

export interface TimerHandle {
  readonly id: number;
  /** 已取消或被消费后为 true。 */
  readonly removed: boolean;
}

/**
 * 可加速 / 可暂停 / 可快进的虚拟时钟。
 *
 * 语义与《永夜》原版 `src/logics/Timeline.js` 对齐：
 * `now = (parent.now - parentCurrent) * rate + current`
 */
export interface Clock {
  /** 当前虚拟时间（毫秒）。 */
  getTime(): number;
  /** 安排一个回调，delay 为**虚拟毫秒**。 */
  setTimeout(fn: () => void, delay: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  /** 当前倍率（攻速、全局加速都走这里）。 */
  getRate(): number;
  setRate(rate: number): void;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  /**
   * 暂停态下推进 `rest` 虚拟毫秒并清空到期回调。
   * @param budget 单次调用最多执行的回调数（防止离线快进阻塞事件循环）。
   * @returns 仍未推进完的剩余毫秒（0 表示已推完）。
   */
  stepPaused(rest: number, budget?: number): number;
  /**
   * 上一次 `stepPaused` / 同步推进实际执行的到期回调数（**可选扩展**，冻结契约的加性字段）。
   *
   * 全局每轮回调预算需要跨角色累加**实际用量**；不实现该方法的时钟按 0 计。
   */
  callbacksUsed?(): number;
  dispose(): void;
}

/** 以另一时钟为父的从属时钟工厂（原版 `new Timeline(parent)`）。 */
export interface ClockFactory {
  /** 根时钟，now 来自真实时间。 */
  createRoot(): Clock;
  createChild(parent: Clock): Clock;
}

// ────────────────────────────── 随机 ──────────────────────────────

/**
 * 可重放伪随机源。
 *
 * ⚠️ 原版全仓库直接使用 `Math.random()`（掉落品质、词缀、暴击、刷怪位置、炼金随机）。
 * 移植后**禁止**再出现裸 `Math.random()`，一律经本端口，否则离线结算无法审计、单测无法稳定。
 */
export interface Rng {
  /** [0, 1) 均匀分布。 */
  next(): number;
  /** [min, max) 均匀分布。 */
  range(min: number, max: number): number;
  /** [0, n) 整数。 */
  int(n: number): number;
  /**
   * 派生一个带标签的子随机源。
   * 相同的 (parentSeed, label) 必须产生相同序列，用于把「掉落」「词缀」「暴击」等
   * 互不干扰地独立重放。
   */
  fork(label: string): Rng;
  /** 当前内部种子快照（用于存档 / 审计）。 */
  getSeed(): number;
}

export interface RngFactory {
  /** 用给定种子创建；同种子必然产生同序列。 */
  create(seed: number): Rng;
  /** 生成一个可用于新战斗的种子（服务端用真随机，测试用固定值）。 */
  nextSeed(): number;
}

// ────────────────────────────── 战斗事件汇 ──────────────────────────────

export interface DamageEvent {
  fromId: string;
  toId: string;
  damageType: string;
  skill: string;
  value: number;
  crit: boolean;
  absorbed: number;
}
export interface HealEvent {
  fromId: string;
  toId: string;
  skill: string;
  value: number;
}
export interface DodgeEvent {
  fromId: string;
  toId: string;
  skill: string;
}
export interface DeathEvent {
  unitId: string;
  name: string;
  camp: string;
}
export interface BuffEvent {
  unitId: string;
  buffKey: string;
  name: string;
  on: boolean;
}
export interface ExpEvent {
  amount: number;
  level: number;
  peak: boolean;
}
export interface GeneralEvent {
  text: string;
}
export interface LootEvent {
  /** 物品基底 key。 */
  key: string;
  count: number;
  quality: number;
  /** 拾取规则处理结果。 */
  handled: 'pickup' | 'sell' | 'decompose';
  gold?: number;
  materials?: Array<{ key: string; count: number }>;
  /**
   * 副本钥匙所属分组（如 `nightmare.3`）。
   * ⚠️ 原版 `InventorySlot.dungeonKey`；不带上它则丢失「这把钥匙属于哪个副本」的信息。
   */
  dungeonKey?: string;
  /**
   * 是否应在客户端弹出获得提示。
   * ⚠️ 原版 `world.loots(..., showToast)` 的参数；服务端聚合推送时用它决定是否置顶单条提示。
   */
  showToast?: boolean;
}

/**
 * 战斗事件汇聚点。原版 `src/logics/message.js` 的 `sendXxx` 全部改为调用本端口。
 *
 * 服务端实现负责聚合 + 节流后经 WS 推送；前端不再跑逻辑，`renderMessage` 仅消费结构化事件。
 */
export interface BattleSink {
  damage(e: DamageEvent): void;
  heal(e: HealEvent): void;
  dodge(e: DodgeEvent): void;
  death(e: DeathEvent): void;
  buff(e: BuffEvent): void;
  exp(e: ExpEvent): void;
  general(e: GeneralEvent): void;
  loot(e: LootEvent): void;
  /** 进入地图（原版 `message.send('map.enter')`）。 */
  mapEnter(mapKey: string, name: string): void;
}

// ────────────────────────────── 日志 ──────────────────────────────

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** 静默日志（单测 / 离线结算默认）。 */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
