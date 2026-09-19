/**
 * 秘境 / 挑战队列控制器门面（cmd 140；09 §5.3/§5.4）
 *
 * 职责（拓扑 B）：
 * - **挑战队列的唯一所有者**（RC4）：CRUD + 落库（`account_state.data.challengeQueue`），
 *   客户端只能增删查询；队列推进/通关编排在 R3-b2 落地；
 * - **冷却/每日重置/神力重置**（RC3）：状态在 `account_state.data.dungeonCooldowns`，
 *   判定用 game-core 的 `planDungeonCooldown` / `planDungeonPaidReset`（纯函数，单一实现）；
 * - `enter`/`leave` 过渡期**委托 battle 会话宿主**（`world.enterMap/leave`）；
 * - **队列推进**（RD3/RD4/RD5，R4）：订阅 battle 的 `RunEnded`，决定下一跳
 *   （秘境可打则进入 / 无票·冷却未就绪跳过 / 非秘境或耗尽转 `map.ContinueOpenWorld`）。
 */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type {
  ActionResult,
  ChallengeEntryDto,
  ChallengeQueueDto,
  DungeonResetResultDto,
  DungeonTicketStateDto,
  WorldSnapshotDto,
} from '@idle-dark/protocol';
import { BusinessErrorCode, fail, ok } from '@idle-dark/protocol';
import {
  EVENT_BUS,
  GAME_CLOCK,
  PlayerContextService,
  normalizeChallengeQueue,
  normalizeChallengeEntry,
  removeChallengeEntryAt,
  type AccountExtras,
  type ChallengeEntry,
  type DungeonCooldownEntry,
  type EventBus,
  type NowSource,
  type RunEndedEvent,
} from '../shared/index.js';
import { BATTLE_COMMAND, type BattleCommandPort } from '../shared/index.js';
import { MapLogicService } from '../map/map.logic.service.js';
import {
  consumeDungeonStack,
  decideChallengeEntry,
  maxStacksOf,
  planDungeonCooldown,
  planDungeonPaidReset,
  ticketKeyOf,
} from '@idle-dark/game-core';
import type { Player } from '@idle-dark/game-core';

@Injectable()
export class DungeonLogicService implements OnModuleInit {
  private readonly logger = new Logger(DungeonLogicService.name);

  constructor(
    private readonly contexts: PlayerContextService,
    @Inject(BATTLE_COMMAND) private readonly battle: BattleCommandPort,
    private readonly maps: MapLogicService,
    @Inject(GAME_CLOCK) private readonly now: NowSource,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  /**
   * 订阅 battle 的 `RunEnded`（09 §4.2）：battle 只报告"run 结束了"，
   * **下一跳由本控制器决定**（RC4/RD3/RD5）。事件总线是同步派发，故这里 fire-and-forget。
   */
  onModuleInit(): void {
    this.events.on('RunEnded', (event) => {
      void this.handleRunEnded(event).catch((error: unknown) => {
        this.logger.warn(`挑战队列推进失败：${event.characterId}`, {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  // ────────────────────────────── 挑战队列（RC4） ──────────────────────────────

  async queueGet(userId: number, characterId: string): Promise<ActionResult<ChallengeQueueDto>> {
    const extras = await this.contexts.extrasOf(userId);
    const player = await this.contexts.load(userId, characterId);
    if (player === null) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    return ok({
      entries: this.entriesOf(extras, characterId).map(toEntryDto),
      tickets: this.ticketStates(extras, characterId, player),
    });
  }

  /** 整体替换（客户端把完整队列发上来；服务端校验后落库）。 */
  async queueSet(
    userId: number,
    characterId: string,
    raw: unknown,
  ): Promise<ActionResult<ChallengeQueueDto>> {
    const extras = await this.contexts.extrasOf(userId);
    extras.challengeQueue[characterId] = normalizeChallengeQueue(raw, this.contexts.tables);
    await this.persist(userId);
    return this.queueGet(userId, characterId);
  }

  async queueAdd(
    userId: number,
    characterId: string,
    raw: unknown,
  ): Promise<ActionResult<ChallengeQueueDto>> {
    const entry = normalizeChallengeEntry(raw, this.contexts.tables);
    if (entry === null) return fail(BusinessErrorCode.INVALID_PARAM, '队列条目非法');
    const extras = await this.contexts.extrasOf(userId);
    const current = this.entriesOf(extras, characterId);
    extras.challengeQueue[characterId] = normalizeChallengeQueue([...current, entry], this.contexts.tables);
    await this.persist(userId);
    return this.queueGet(userId, characterId);
  }

  async queueRemove(
    userId: number,
    characterId: string,
    index: number,
  ): Promise<ActionResult<ChallengeQueueDto>> {
    const extras = await this.contexts.extrasOf(userId);
    extras.challengeQueue[characterId] = removeChallengeEntryAt(
      this.entriesOf(extras, characterId),
      index,
    );
    await this.persist(userId);
    return this.queueGet(userId, characterId);
  }

  async queueClear(userId: number, characterId: string): Promise<ActionResult<ChallengeQueueDto>> {
    const extras = await this.contexts.extrasOf(userId);
    extras.challengeQueue[characterId] = [];
    await this.persist(userId);
    return this.queueGet(userId, characterId);
  }

  // ────────────────────────────── 进 / 出秘境 ──────────────────────────────

  /**
   * 进入秘境：控制器先做**冷却/层数**判定，再委托 battle 会话宿主执行切换
   * （票的唯一扣费点仍在 `world.enterMap`；R4 起冷却层在此消耗）。
   *
   * 非秘境图直接转发（开放世界走 `map.enter`）。
   */
  async enter(
    userId: number,
    characterId: string,
    mapKey: string,
    opId?: string,
  ): Promise<ActionResult<WorldSnapshotDto>> {
    const map = this.contexts.tables.maps[mapKey];
    if (map?.isDungeon !== true) {
      return this.battle.enterMap(userId, characterId, mapKey, ...(opId !== undefined ? [opId] : []));
    }
    const extras = await this.contexts.extrasOf(userId);
    const ticketKey = ticketKeyOf(mapKey, map, 0);
    const plan = planDungeonCooldown(this.cooldownOf(extras, characterId, ticketKey), map, this.now());
    if (!plan.available) {
      return fail(BusinessErrorCode.NO_TICKET, '本周期挑战次数已用尽（可等待每日重置或神力重置）');
    }
    // 先落"已重置"的状态（跨过周期边界时回满），失败不消耗层数。
    this.setCooldown(extras, characterId, ticketKey, plan.state);

    const result = await this.battle.enterMap(
      userId,
      characterId,
      mapKey,
      ...(opId !== undefined ? [opId] : []),
    );
    if (result.success) {
      this.setCooldown(extras, characterId, ticketKey, consumeDungeonStack(plan.state));
      await this.persist(userId);
    } else {
      await this.persist(userId);
    }
    return result;
  }

  async leave(userId: number, characterId: string): Promise<ActionResult<null>> {
    return this.battle.leave(userId, characterId);
  }

  // ────────────────────────────── 队列推进（RD3/RD4/RD5） ──────────────────────────────

  /**
   * battle 报告 run 结束 → 推进挑战队列。
   *
   * 规则（09 §5.3）：
   * 1. 只接管**队列驱动**的 run（队首正是刚结束的地图），手动进图不打扰队列；
   * 2. 逐条尝试队首：秘境且票/冷却就绪 → 进入；否则**跳过并继续**（RD5，不中断队列）；
   *    非秘境条目 → `map.ContinueOpenWorld(entry.key)`；
   * 3. 队列耗尽 → `map.ContinueOpenWorld(run.outside)`（RD4：run.outside → 持久化位置 → home）。
   */
  private async handleRunEnded(event: RunEndedEvent): Promise<void> {
    const extras = await this.contexts.extrasOf(event.userId);
    const queue = this.entriesOf(extras, event.characterId);
    if (queue.length === 0 || queue[0]?.key !== event.mapKey) return;

    let skipped = 0;
    while (queue.length > 0) {
      const entry = queue[0];
      if (entry === undefined) break;
      const map = this.contexts.tables.maps[entry.key];
      if (!map) {
        queue.shift();
        skipped += 1;
        continue;
      }
      if (map.isDungeon === true) {
        const player = await this.contexts.load(event.userId, event.characterId);
        if (player === null) return;
        const ticketKey = ticketKeyOf(entry.key, map, entry.endlessLevel);
        const plan = planDungeonCooldown(
          this.cooldownOf(extras, event.characterId, ticketKey),
          map,
          this.now(),
        );
        if (decideChallengeEntry(safeTicketCount(player, ticketKey), plan.available) === 'skip') {
          // RD5：无票 / 冷却未就绪 → 跳过该条并记录，继续下一条（不中断整个队列）
          queue.shift();
          skipped += 1;
          continue;
        }
        queue.shift();
        extras.challengeQueue[event.characterId] = queue;
        await this.persist(event.userId);
        this.logSkipped(event.characterId, skipped);
        await this.enter(event.userId, event.characterId, entry.key);
        return;
      }
      // 非秘境条目 → 转入该开放世界图（RD3）
      queue.shift();
      extras.challengeQueue[event.characterId] = queue;
      await this.persist(event.userId);
      this.logSkipped(event.characterId, skipped);
      await this.maps.continueOpenWorld(event.userId, event.characterId, entry.key);
      return;
    }

    // 队列耗尽 → RD4
    extras.challengeQueue[event.characterId] = queue;
    await this.persist(event.userId);
    this.logSkipped(event.characterId, skipped);
    await this.maps.continueOpenWorld(event.userId, event.characterId, event.outside);
  }

  private logSkipped(characterId: string, skipped: number): void {
    if (skipped <= 0) return;
    // I3：跳过是显式行为，必须可见（RD5）
    this.logger.log(`[CHALLENGE] 跳过 ${skipped} 个不可用队列条目：${characterId}`);
  }

  // ────────────────────────────── 神力重置（RC3） ──────────────────────────────

  /**
   * 神力重置冷却 / 购票：把该票键的层数回满，扣神力。
   *
   * `resetPrice = -1` / 缺失 / `NaN` / 负数 → 不可重置；神力不足 → `NOT_ENOUGH_DIAMONDS`。
   */
  async reset(
    userId: number,
    characterId: string,
    mapKey: string,
    endlessLevel?: number,
  ): Promise<ActionResult<DungeonResetResultDto>> {
    const map = this.contexts.tables.maps[mapKey];
    if (!map || map.isDungeon !== true) {
      return fail(BusinessErrorCode.MAP_LOCKED, '不是秘境');
    }
    const account = await this.contexts.accountOf(userId);
    const paid = planDungeonPaidReset(map, account.diamonds);
    if (!paid.allowed) {
      return paid.reason === 'not_resettable'
        ? fail(BusinessErrorCode.INVALID_PARAM, '该秘境不支持神力重置')
        : fail(BusinessErrorCode.NOT_ENOUGH_DIAMONDS);
    }

    const extras = await this.contexts.extrasOf(userId);
    const ticketKey = ticketKeyOf(mapKey, map, endlessLevel ?? 0);
    const now = this.now();
    const plan = planDungeonCooldown(this.cooldownOf(extras, characterId, ticketKey), map, now);
    const refilled: DungeonCooldownEntry = {
      stacks: maxStacksOf(map),
      lastResetAt: plan.state.lastResetAt,
      lastUsedAt: plan.state.lastUsedAt,
    };
    const perChar = extras.dungeonCooldowns[characterId] ?? {};
    perChar[ticketKey] = refilled;
    extras.dungeonCooldowns[characterId] = perChar;

    account.diamonds = Math.max(0, account.diamonds - paid.cost);
    this.contexts.markAccountDirty(userId);
    await this.persist(userId);

    return ok({
      ticketKey,
      cost: paid.cost,
      stacks: refilled.stacks,
      nextResetAt: plan.nextResetAt,
    });
  }

  // ────────────────────────────── 内部 ──────────────────────────────

  private entriesOf(extras: AccountExtras, characterId: string): ChallengeEntry[] {
    return extras.challengeQueue[characterId] ?? [];
  }

  private cooldownOf(
    extras: AccountExtras,
    characterId: string,
    ticketKey: string,
  ): DungeonCooldownEntry | undefined {
    return extras.dungeonCooldowns[characterId]?.[ticketKey];
  }

  private setCooldown(
    extras: AccountExtras,
    characterId: string,
    ticketKey: string,
    state: DungeonCooldownEntry,
  ): void {
    const perChar = extras.dungeonCooldowns[characterId] ?? {};
    perChar[ticketKey] = {
      stacks: state.stacks,
      lastResetAt: state.lastResetAt,
      lastUsedAt: state.lastUsedAt,
    };
    extras.dungeonCooldowns[characterId] = perChar;
  }

  /** 本角色所有秘境票键的冷却 / 可挑战状态（按票键去重）。 */
  private ticketStates(
    extras: AccountExtras,
    characterId: string,
    player: Player,
  ): DungeonTicketStateDto[] {
    const tables = this.contexts.tables;
    const now = this.now();
    const seen = new Map<string, DungeonTicketStateDto>();
    for (const key of Object.keys(tables.maps)) {
      const map = tables.maps[key];
      if (!map || map.isDungeon !== true) continue;
      const ticketKey = ticketKeyOf(key, map, 0);
      if (seen.has(ticketKey)) continue;
      const plan = planDungeonCooldown(this.cooldownOf(extras, characterId, ticketKey), map, now);
      seen.set(ticketKey, {
        ticketKey,
        stacks: plan.state.stacks,
        available: plan.available && safeTicketCount(player, ticketKey) > 0,
        nextResetAt: plan.nextResetAt,
      });
    }
    return [...seen.values()];
  }

  /** 落库（账号侧车）；脏标记 + flushAccount 由 PlayerContextService 统一负责。 */
  private async persist(userId: number): Promise<void> {
    this.contexts.markAccountDirty(userId);
    await this.contexts.flushAccount(userId);
  }
}

function toEntryDto(entry: ChallengeEntry): ChallengeEntryDto {
  return { key: entry.key, endlessLevel: entry.endlessLevel };
}

function safeTicketCount(player: Player, ticketKey: string): number {
  try {
    const count = player.countTicket(ticketKey);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}
