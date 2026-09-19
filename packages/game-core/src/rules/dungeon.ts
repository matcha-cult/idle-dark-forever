/**
 * 秘境规则内核（09 §5.3/§5.4；**纯函数**，无 IO / 无裸时间）
 *
 * 这些函数由 dungeon 控制器（R3-b）消费：
 * - **票键** `ticketKeyOf`：地城钥匙按 `group ?? mapKey`，无尽按 `nightmare.<level>`；
 * - **冷却/每日重置** `planDungeonCooldown`：每 `coolDown`（默认 24h）在 `coolDownOffset + 时区`
 *   的周期边界回满到 `maxCoolDownStack`（每日 4 点重置的载体，RD6）；
 * - **神力重置** `planDungeonPaidReset`：`resetPrice = -1` 不可重置；价格不足则拒绝；
 * - **挑战队列推进** `planChallengeAdvance`：当前条目结束后弹到下一格，耗尽则 `queueExhausted`；
 * - **RD5 跳过决策** `decideChallengeEntry`：无票 / 冷却未就绪 → `skip`（继续下一条而不是中断）。
 *
 * 不变式：任何 `undefined / null / NaN / Infinity / 负数 / 0` 输入都回落成显式默认，
 * **绝不产生 NaN 状态**（状态会落库，写坏一次就是永久损坏）。
 */

/** 默认冷却周期：24h（原版 `coolDown` 样本 86400000）。 */
export const DEFAULT_DUNGEON_PERIOD_MS = 24 * 60 * 60 * 1000;
/** 每日重置时区偏移（RD6：默认 UTC+8，可显式覆盖）。 */
export const DEFAULT_DUNGEON_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
/** `resetPrice = -1` 表示不可重置（实测 `silver.warrior`）。 */
export const DUNGEON_RESET_DISABLED = -1;
/** 单次挑战消耗的层数（每层 = 一次可挑战机会）。 */
export const DUNGEON_STACK_PER_RUN = 1;

export interface DungeonTicketSource {
  readonly group?: string;
  readonly isEndless?: boolean;
}

/**
 * 地城钥匙键（`Player.dungeonTickets` / `countTicket` / `costTicket` 的键）。
 *
 * - 无尽副本：`nightmare.<endlessLevel>`（level 非有限 / <= 0 → 回落 `nightmare.1`）；
 * - 普通秘境：`group ?? mapKey`（两者都空 → 返回 `mapKey`，由调用方保证非空）。
 */
export function ticketKeyOf(
  mapKey: string,
  source: DungeonTicketSource | undefined,
  endlessLevel: number,
): string {
  const level =
    typeof endlessLevel === 'number' && Number.isFinite(endlessLevel) && endlessLevel > 0
      ? Math.trunc(endlessLevel)
      : 0;
  if (source?.isEndless === true || level > 0) {
    return `nightmare.${level > 0 ? level : 1}`;
  }
  const group = source?.group;
  if (typeof group === 'string' && group !== '') return group;
  return mapKey;
}

export interface DungeonCooldownConfig {
  /** 冷却周期（ms）；缺失 / 非正 / 非有限 → 默认 24h。 */
  readonly coolDown?: number;
  /** 周期边界偏移（ms）；决定"每日几点"的基准，配合时区。 */
  readonly coolDownOffset?: number;
  /** 可累积层数（一次可挑战机会 = 1 层）；缺失 / 非正 → `defaultTicketCount ?? 1`。 */
  readonly maxCoolDownStack?: number;
  /** 初始票数；缺失 / 非法 → 1。 */
  readonly defaultTicketCount?: number;
  /** 神力重置价格；`-1` = 不可重置。 */
  readonly resetPrice?: number;
}

export interface DungeonCooldownState {
  /** 当前可挑战层数。 */
  readonly stacks: number;
  /** 上一次回满对应的**周期边界**时刻。 */
  readonly lastResetAt: number;
  /** 最近一次消耗时刻（仅记录，供观测）。 */
  readonly lastUsedAt: number;
}

export interface DungeonCooldownPlan {
  /** 归一 + 可能已回满后的状态（**落库用**）。 */
  readonly state: DungeonCooldownState;
  /** 当前是否可挑战。 */
  readonly available: boolean;
  readonly reason: 'ok' | 'cooldown';
  /** 下一次回满的周期边界时刻。 */
  readonly nextResetAt: number;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: unknown, fallback: number): number {
  const n = finiteOr(value, fallback);
  return n > 0 ? n : fallback;
}

/** 冷却周期（ms）。 */
export function dungeonPeriodMs(config: DungeonCooldownConfig | undefined): number {
  return positiveOr(config?.coolDown, DEFAULT_DUNGEON_PERIOD_MS);
}

/** 可累积层数上限（>= 1）。 */
export function maxStacksOf(config: DungeonCooldownConfig | undefined): number {
  const fallback = positiveOr(config?.defaultTicketCount, 1);
  const max = finiteOr(config?.maxCoolDownStack, fallback);
  return Math.max(1, Math.trunc(max > 0 ? max : fallback));
}

/** 归一化落库状态（脏输入 → 安全默认，绝不 NaN）。 */
export function normalizeCooldownState(
  raw: Partial<DungeonCooldownState> | null | undefined,
  config: DungeonCooldownConfig | undefined,
): DungeonCooldownState {
  const max = maxStacksOf(config);
  const stacksRaw = finiteOr(raw?.stacks, 0);
  const stacks = Math.min(max, Math.max(0, Math.trunc(stacksRaw)));
  return {
    stacks,
    lastResetAt: finiteOr(raw?.lastResetAt, 0),
    lastUsedAt: finiteOr(raw?.lastUsedAt, 0),
  };
}

/**
 * 最近一次周期边界（`<= now`）。
 *
 * 边界序列：`offset - tz + k * period`；用向零取模使负时间戳也稳定。
 */
export function dungeonPeriodBoundary(
  now: number,
  periodMs: number,
  offsetMs: number,
  tzOffsetMs: number,
): number {
  const at = finiteOr(now, 0);
  const period = positiveOr(periodMs, DEFAULT_DUNGEON_PERIOD_MS);
  const shifted = at + finiteOr(tzOffsetMs, 0) - finiteOr(offsetMs, 0);
  const remainder = ((shifted % period) + period) % period;
  return at - remainder;
}

/**
 * 结算冷却：跨过周期边界则回满；返回可用性与落库状态。
 *
 * `lastResetAt` 记录**周期边界**（不是 `now`）：同一周期内重复调用是幂等的。
 */
export function planDungeonCooldown(
  state: Partial<DungeonCooldownState> | null | undefined,
  config: DungeonCooldownConfig | undefined,
  now: number,
  tzOffsetMs: number = DEFAULT_DUNGEON_TZ_OFFSET_MS,
): DungeonCooldownPlan {
  const period = dungeonPeriodMs(config);
  const max = maxStacksOf(config);
  const normalized = normalizeCooldownState(state, config);
  const boundary = dungeonPeriodBoundary(now, period, finiteOr(config?.coolDownOffset, 0), tzOffsetMs);
  const crossed = normalized.lastResetAt < boundary;
  const next: DungeonCooldownState = crossed
    ? { stacks: max, lastResetAt: boundary, lastUsedAt: normalized.lastUsedAt }
    : normalized;
  return {
    state: next,
    available: next.stacks > 0,
    reason: next.stacks > 0 ? 'ok' : 'cooldown',
    nextResetAt: boundary + period,
  };
}

/** 消耗一层（一次挑战）。已是 0 → 原样返回（不产生负数）。 */
export function consumeDungeonStack(
  state: DungeonCooldownState,
  count: number = DUNGEON_STACK_PER_RUN,
): DungeonCooldownState {
  const dec = Math.max(1, Math.trunc(positiveOr(count, DUNGEON_STACK_PER_RUN)));
  return { ...state, stacks: Math.max(0, state.stacks - dec), lastUsedAt: state.lastUsedAt };
}

export interface DungeonResetPlan {
  readonly allowed: boolean;
  /** 需要消耗的神力（`allowed` 为真时有效）。 */
  readonly cost: number;
  readonly reason: 'ok' | 'not_resettable' | 'not_enough_diamonds';
}

/**
 * 神力重置（`dungeon.reset`；RC3）。
 *
 * - `resetPrice` 缺失 / `NaN` / 负数（`-1` 或其它负值）→ **不可重置**；
 * - `resetPrice === 0` → 免费重置（合法）；
 * - 神力不足 → `not_enough_diamonds`（不扣费）。
 */
export function planDungeonPaidReset(
  config: DungeonCooldownConfig | undefined,
  diamonds: number,
): DungeonResetPlan {
  const raw = config?.resetPrice;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return { allowed: false, cost: 0, reason: 'not_resettable' };
  }
  const cost = Math.trunc(raw);
  const owned = Math.max(0, Math.trunc(finiteOr(diamonds, 0)));
  if (owned < cost) return { allowed: false, cost, reason: 'not_enough_diamonds' };
  return { allowed: true, cost, reason: 'ok' };
}

export interface ChallengeAdvancePlan {
  /** 推进后的条目下标（`>>>` 语义：当前条目结束后指向下一条）。 */
  readonly nextIndex: number;
  /** 是否已耗尽整个队列。 */
  readonly queueExhausted: boolean;
}

/**
 * 挑战队列推进（RC4/RD3）：当前条目结束（通关 / 死亡）后弹到下一格。
 *
 * - `index` 非法 → 视作 0；`length <= 0` → 立即耗尽；
 * - `ended === false`（当前条目还没结束）→ 下标不变、不耗尽。
 */
export function planChallengeAdvance(index: number, length: number, ended: boolean): ChallengeAdvancePlan {
  const total = Math.trunc(finiteOr(length, 0));
  if (total <= 0) return { nextIndex: 0, queueExhausted: true };
  const current = Math.min(total - 1, Math.max(0, Math.trunc(finiteOr(index, 0))));
  if (!ended) return { nextIndex: current, queueExhausted: false };
  const nextIndex = current + 1;
  return nextIndex >= total
    ? { nextIndex: total, queueExhausted: true }
    : { nextIndex, queueExhausted: false };
}

/** RD5：队列条目的进/跳决策。无票或冷却未就绪 → `skip`（继续下一条，不中断队列）。 */
export function decideChallengeEntry(ticketCount: number, cooldownAvailable: boolean): 'enter' | 'skip' {
  const tickets = Math.trunc(finiteOr(ticketCount, 0));
  if (tickets <= 0) return 'skip';
  if (cooldownAvailable !== true) return 'skip';
  return 'enter';
}
