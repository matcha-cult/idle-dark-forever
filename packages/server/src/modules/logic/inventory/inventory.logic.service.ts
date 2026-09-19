/**
 * 背包域门面（Action → 本服务 → internal 纯逻辑）。
 *
 * 写操作统一走：限流 → `opId` 幂等 → 加载角色 → 纯逻辑 → `markDirty` + `flush`
 * → 返回最新扁平格子数组 + `(inventory, changed)` 推送。
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
import { EVENT_BUS, GAME_CLOCK, PlayerContextService, type EventBus, type NowSource } from '../shared/index.js';
import { PanelCharacterService } from '../shared/panel-character.service.js';
import { withOperation } from '../shared/idempotency.js';
import { OpError, toFailOrThrow } from '../shared/op-error.js';
import { listPanelSlots, resolvePanelSlot } from '../shared/slot-ref.js';
import { rngFromText, seedTextOf } from '../shared/rng.js';
import { pushInventoryChanged } from '../shared/notify.js';
import {
  opEquip,
  opExpand,
  opLock,
  opSell,
  opSort,
  opUnequip,
  opUsePackage,
} from './internal/inventory-ops.js';

/** 各写操作的滑动窗口限流额度（次 / 分钟）。 */
const RATE_LIMITS = {
  equip: 60,
  unequip: 60,
  sell: 60,
  lock: 120,
  sort: 30,
  usePackage: 30,
  expand: 20,
} as const;

type Loaded = { ok: true; characterId: string; player: Player } | { ok: false; fail: ActionFail };

@Injectable()
export class InventoryLogicService {
  private counter = 0;

  constructor(
    private readonly contexts: PlayerContextService,
    private readonly characters: PanelCharacterService,
    private readonly opIds: OpIdempotencyService,
    private readonly rateLimiter: RateLimiterService,
    @Inject(NOTIFICATION_BATCHER) private readonly batcher: NotificationBatcher,
    @Inject(GAME_CLOCK) private readonly now: NowSource,
    /**
     * 跨服事件总线（08 §2.3 解环）：改装备 / 词缀后发布 `CombatHooksDirty`，
     * 由 battle 订阅重绑 hook —— 本域不再 import `WorldService`。
     */
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  async list(userId: number, characterId?: string): Promise<ActionResult<InventorySlotDto[]>> {
    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    return ok(listPanelSlots(this.contexts.tables, loaded.player));
  }

  async equip(
    userId: number,
    id: string,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    return this.runMutation(userId, opId, characterId, 'equip', RATE_LIMITS.equip, (player) => {
      const resolved = resolvePanelSlot(player, id);
      if (!resolved) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
      opEquip(player, resolved.position, resolved.slot);
    });
  }

  async unequip(
    userId: number,
    id: string,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    return this.runMutation(userId, opId, characterId, 'unequip', RATE_LIMITS.unequip, (player) => {
      const resolved = resolvePanelSlot(player, id);
      if (!resolved) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
      opUnequip(player, resolved.position, resolved.slot);
    });
  }

  async sell(
    userId: number,
    id: string,
    count: number,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    return this.runMutation(userId, opId, characterId, 'sell', RATE_LIMITS.sell, (player) => {
      const resolved = resolvePanelSlot(player, id);
      if (!resolved) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
      opSell(player, resolved.position, resolved.slot, count);
    });
  }

  async lock(
    userId: number,
    id: string,
    locked: boolean,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    return this.runMutation(userId, opId, characterId, 'lock', RATE_LIMITS.lock, (player) => {
      const resolved = resolvePanelSlot(player, id);
      if (!resolved) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
      opLock(resolved.slot, locked);
    });
  }

  async sort(
    userId: number,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    return this.runMutation(userId, opId, characterId, 'sort', RATE_LIMITS.sort, (player) => {
      opSort(player);
    });
  }

  async usePackage(
    userId: number,
    id: string,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    return this.runMutation(
      userId,
      opId,
      characterId,
      'usePackage',
      RATE_LIMITS.usePackage,
      (player, seed) => {
        const resolved = resolvePanelSlot(player, id);
        if (!resolved) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
        opUsePackage(player, this.contexts.tables, resolved.slot, rngFromText(seed));
      },
    );
  }

  async expand(
    userId: number,
    count: number,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    return this.runMutation(userId, opId, characterId, 'expand', RATE_LIMITS.expand, (player) => {
      opExpand(player, player.account, this.contexts.tables, count);
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

  private async runMutation(
    userId: number,
    opId: string | undefined,
    characterId: string | undefined,
    rateKey: string,
    limit: number,
    work: (player: Player, seed: string) => void,
  ): Promise<ActionResult<InventorySlotDto[]>> {
    const limited = this.rateLimiter.consumeOrFail(`inventory:${rateKey}:${userId}`, limit);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player, characterId: cid } = loaded;

      const seed = seedTextOf(userId, cid, opId, this.now(), this.nextCounter());
      try {
        work(player, seed);
      } catch (error) {
        return toFailOrThrow(error);
      }

      this.contexts.markDirty(userId, cid);
      await this.contexts.flush(userId, cid);
      // 装备/词缀变化会让 PlayerUnit 的 hook 过期（去 MobX 后不再自动追踪）。
      // 发布事件，battle 订阅后在下一次 tick 统一重绑；对没有活跃会话的角色是 no-op。
      this.events.emit({ type: 'CombatHooksDirty', userId, characterId: cid });
      const slots = listPanelSlots(this.contexts.tables, player);
      pushInventoryChanged(this.batcher, userId, slots);
      return ok(slots);
    });
  }

  private nextCounter(): number {
    this.counter = (this.counter + 1) % 1_000_000;
    return this.counter;
  }
}
