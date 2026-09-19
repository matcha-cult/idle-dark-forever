/**
 * 秘境 / 挑战队列控制器门面（cmd 140；09 §5.3/§5.4）
 *
 * 职责（拓扑 B）：
 * - **挑战队列的唯一所有者**（RC4）：CRUD + 落库（`account_state.data.challengeQueue`），
 *   客户端只能增删查询；队列推进/通关编排在 R3-b2 落地；
 * - **冷却/每日重置/神力重置**（RC3）：状态在 `account_state.data.dungeonCooldowns`，
 *   判定用 game-core 的 `planDungeonCooldown` / `planDungeonPaidReset`（纯函数，单一实现）；
 * - `enter`/`leave` 过渡期**委托 battle 会话宿主**（`world.enterMap/leave`）；唯一扣票的收敛
 *   与 `runId` 落库在 R3-b2（修 M5/M7）。
 */
import { Inject, Injectable } from '@nestjs/common';
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
  GAME_CLOCK,
  PlayerContextService,
  normalizeChallengeQueue,
  normalizeChallengeEntry,
  removeChallengeEntryAt,
  type AccountExtras,
  type ChallengeEntry,
  type NowSource,
  type DungeonCooldownEntry,
} from '../shared/index.js';
import { WorldService } from '../world/world.service.js';
import {
  maxStacksOf,
  planDungeonCooldown,
  planDungeonPaidReset,
  ticketKeyOf,
} from '@idle-dark/game-core';
import type { Player } from '@idle-dark/game-core';

@Injectable()
export class DungeonLogicService {
  constructor(
    private readonly contexts: PlayerContextService,
    private readonly world: WorldService,
    @Inject(GAME_CLOCK) private readonly now: NowSource,
  ) {}

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

  /** 过渡：委托 battle 会话宿主（唯一扣票点当前仍在 `world.enterMap`）。 */
  async enter(
    userId: number,
    characterId: string,
    mapKey: string,
    opId?: string,
  ): Promise<ActionResult<WorldSnapshotDto>> {
    return this.world.enterMap(userId, characterId, mapKey, ...(opId !== undefined ? [opId] : []));
  }

  async leave(userId: number, characterId: string): Promise<ActionResult<null>> {
    return this.world.leave(userId, characterId);
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
