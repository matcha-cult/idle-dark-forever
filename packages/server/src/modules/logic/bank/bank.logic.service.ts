/**
 * 储藏箱域门面（Action → 本服务 → internal 纯逻辑）。
 *
 * 读写接口都返回**全量银行格子**（前端整体替换，见任务书附录 A）。
 * 银行是账号级状态，落库走 `markAccountDirty` + `flushAccount`。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ActionResult, ActionFail, InventorySlotDto } from '@idle-dark/protocol';
import { BusinessErrorCode, ok } from '@idle-dark/protocol';
import { failOf } from '../../../common/kernel/result.js';
import type { Player } from '@idle-dark/game-core';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { OpIdempotencyService } from '../../game/op-idempotency.service.js';
import { NOTIFICATION_BATCHER } from '../../game/notification-batcher.provider.js';
import type { NotificationBatcher } from '../../game/notification-batcher.js';
import { PlayerContextService } from '../shared/index.js';
import { PanelCharacterService } from '../inventory/internal/panel-character.service.js';
import { withOperation } from '../inventory/internal/idempotency.js';
import { OpError, toFailOrThrow } from '../inventory/internal/op-error.js';
import { listPanelSlots, resolvePanelSlot } from '../inventory/internal/slot-ref.js';
import { pushInventoryChanged } from '../inventory/internal/notify.js';
import {
  listBankSlots,
  opBankExpand,
  opDeposit,
  opWithdraw,
  resolveBankSlot,
} from './internal/bank-ops.js';

const RATE_LIMITS = {
  deposit: 60,
  withdraw: 60,
  expand: 20,
} as const;

type Loaded = { ok: true; characterId: string; player: Player } | { ok: false; fail: ActionFail };

@Injectable()
export class BankLogicService {
  constructor(
    private readonly contexts: PlayerContextService,
    private readonly characters: PanelCharacterService,
    private readonly opIds: OpIdempotencyService,
    private readonly rateLimiter: RateLimiterService,
    @Inject(NOTIFICATION_BATCHER) private readonly batcher: NotificationBatcher,
  ) {}

  async list(userId: number, characterId?: string): Promise<ActionResult<InventorySlotDto[]>> {
    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    return ok(listBankSlots(loaded.player.account.bank));
  }

  async deposit(
    userId: number,
    id: string,
    count: number | undefined,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    const limited = this.rateLimiter.consumeOrFail(`bank:deposit:${userId}`, RATE_LIMITS.deposit);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player, characterId: cid } = loaded;
      const resolved = resolvePanelSlot(player, id);
      if (!resolved) return failOf(BusinessErrorCode.ITEM_NOT_FOUND);
      if (resolved.position !== 'inventory') {
        return failOf(BusinessErrorCode.INVALID_PARAM, '只能存入背包中的物品');
      }

      try {
        opDeposit(player, player.account, this.contexts.tables, resolved.slot, count ?? resolved.slot.count ?? 0);
      } catch (error) {
        return toFailOrThrow(error);
      }

      await this.persist(userId, cid, player);
      return ok(listBankSlots(player.account.bank));
    });
  }

  async withdraw(
    userId: number,
    id: string,
    count: number | undefined,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    const limited = this.rateLimiter.consumeOrFail(`bank:withdraw:${userId}`, RATE_LIMITS.withdraw);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player, characterId: cid } = loaded;
      const resolved = resolveBankSlot(player.account.bank, id);
      if (!resolved) return failOf(BusinessErrorCode.ITEM_NOT_FOUND);

      try {
        opWithdraw(player, player.account, this.contexts.tables, resolved.slot, count ?? resolved.slot.count ?? 0);
      } catch (error) {
        return toFailOrThrow(error);
      }

      await this.persist(userId, cid, player);
      return ok(listBankSlots(player.account.bank));
    });
  }

  async expand(
    userId: number,
    count: number,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    const limited = this.rateLimiter.consumeOrFail(`bank:expand:${userId}`, RATE_LIMITS.expand);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player, characterId: cid } = loaded;

      try {
        opBankExpand(player.account, this.contexts.tables, count);
      } catch (error) {
        return toFailOrThrow(error);
      }

      await this.persist(userId, cid, player);
      return ok(listBankSlots(player.account.bank));
    });
  }

  // ────────────────────────────── 内部 ──────────────────────────────

  private async loadPlayer(userId: number, characterId?: string): Promise<Loaded> {
    const resolved = await this.characters.resolve(userId, characterId);
    if (resolved === null) return { ok: false, fail: failOf(BusinessErrorCode.PLAYER_NOT_FOUND) };
    const player = await this.contexts.load(userId, resolved);
    if (player === null) return { ok: false, fail: failOf(BusinessErrorCode.PLAYER_NOT_FOUND) };
    return { ok: true, characterId: resolved, player };
  }

  private async persist(userId: number, characterId: string, player: Player): Promise<void> {
    this.contexts.markDirty(userId, characterId);
    this.contexts.markAccountDirty(userId);
    await this.contexts.flush(userId, characterId);
    pushInventoryChanged(this.batcher, userId, listPanelSlots(this.contexts.tables, player));
  }
}
