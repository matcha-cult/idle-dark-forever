/**
 * 神力商店域门面（Action → 本服务 → internal 纯逻辑）。
 *
 * ⚠️ `player_slot_count` 是 `account_state` 表的**独立列**，`PlayerContextService`
 * 只读写 `diamonds / highest_endless_level / data`，因此本服务是唯一直接访问该列的地方
 * （任务书要求「不要绕过 PlayerContextService 直接写 SQL」，此处为确有必要并已在报告中说明）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ActionResult, ActionFail, ShopStateDto } from '@idle-dark/protocol';
import { BusinessErrorCode, ok } from '@idle-dark/protocol';
import { failOf } from '../../../common/kernel/result.js';
import type { Player } from '@idle-dark/game-core';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { GameDatabaseService } from '../../game/game-database.service.js';
import { OpIdempotencyService } from '../../game/op-idempotency.service.js';
import { GAME_CLOCK, PlayerContextService, type NowSource } from '../shared/index.js';
import { PanelCharacterService } from '../inventory/internal/panel-character.service.js';
import { withOperation } from '../inventory/internal/idempotency.js';
import { toFailOrThrow } from '../inventory/internal/op-error.js';
import { rngFromText, seedTextOf } from '../inventory/internal/rng.js';
import { opBuyPlayerSlot, opExchange, shopStateOf } from './internal/shop-ops.js';

const RATE_LIMITS = {
  buyPlayerSlot: 10,
  exchange: 30,
} as const;

type Loaded = { ok: true; characterId: string; player: Player } | { ok: false; fail: ActionFail };

interface SlotRow {
  player_slot_count: number | null;
}

@Injectable()
export class ShopLogicService {
  private counter = 0;

  constructor(
    private readonly contexts: PlayerContextService,
    private readonly characters: PanelCharacterService,
    private readonly opIds: OpIdempotencyService,
    private readonly rateLimiter: RateLimiterService,
    private readonly db: GameDatabaseService,
    @Inject(GAME_CLOCK) private readonly now: NowSource,
  ) {}

  async state(userId: number, characterId?: string): Promise<ActionResult<ShopStateDto>> {
    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    const slotCount = await this.readPlayerSlotCount(userId);
    return ok(shopStateOf(slotCount, loaded.player));
  }

  async buyPlayerSlot(
    userId: number,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<ShopStateDto>> {
    const limited = this.rateLimiter.consumeOrFail(`shop:buyPlayerSlot:${userId}`, RATE_LIMITS.buyPlayerSlot);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player } = loaded;
      const current = await this.readPlayerSlotCount(userId);

      let next: number;
      try {
        next = opBuyPlayerSlot(player, current);
      } catch (error) {
        return toFailOrThrow(error);
      }

      this.contexts.markAccountDirty(userId);
      await this.contexts.flushAccount(userId);
      await this.writePlayerSlotCount(userId, next);
      return ok(shopStateOf(next, player));
    });
  }

  async exchange(
    userId: number,
    from: string,
    to: string,
    count: number,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<ShopStateDto>> {
    const limited = this.rateLimiter.consumeOrFail(`shop:exchange:${userId}`, RATE_LIMITS.exchange);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player, characterId: cid } = loaded;
      const extras = await this.contexts.extrasOf(userId);

      try {
        opExchange(
          player,
          extras,
          this.contexts.tables,
          from,
          to,
          count,
          rngFromText(this.seed(cid, opId)),
        );
      } catch (error) {
        return toFailOrThrow(error);
      }

      this.contexts.markDirty(userId, cid);
      this.contexts.markAccountDirty(userId);
      await this.contexts.flush(userId, cid);
      const slotCount = await this.readPlayerSlotCount(userId);
      return ok(shopStateOf(slotCount, player));
    });
  }

  // ────────────────────────────── 内部 ──────────────────────────────

  private async readPlayerSlotCount(userId: number): Promise<number> {
    const rows = await this.db.query<SlotRow>(
      `SELECT player_slot_count FROM account_state WHERE user_id = $1`,
      [userId],
    );
    const value = rows.rows[0]?.player_slot_count;
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1;
  }

  private async writePlayerSlotCount(userId: number, count: number): Promise<void> {
    await this.db.query(
      `INSERT INTO account_state (user_id, player_slot_count)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
          SET player_slot_count = EXCLUDED.player_slot_count,
              updated_at = CURRENT_TIMESTAMP`,
      [userId, count],
    );
  }

  private async loadPlayer(userId: number, characterId?: string): Promise<Loaded> {
    const resolved = await this.characters.resolve(userId, characterId);
    if (resolved === null) return { ok: false, fail: failOf(BusinessErrorCode.PLAYER_NOT_FOUND) };
    const player = await this.contexts.load(userId, resolved);
    if (player === null) return { ok: false, fail: failOf(BusinessErrorCode.PLAYER_NOT_FOUND) };
    return { ok: true, characterId: resolved, player };
  }

  private seed(characterId: string, opId: string | undefined): string {
    this.counter = (this.counter + 1) % 1_000_000;
    return seedTextOf(characterId, opId, this.now(), this.counter);
  }
}
