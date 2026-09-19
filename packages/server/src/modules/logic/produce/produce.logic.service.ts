/**
 * 生产域门面（Action → 本服务 → internal 纯逻辑）。
 *
 * 消耗类操作（附魔 / 重铸 / 分解 / 投入材料 / 药剂重置）统一：
 * 限流 → `opId` 幂等 → 加载角色 → 纯逻辑 → `markDirty`/`markAccountDirty` + `flush`
 * → 返回 DTO + `(inventory, changed)` 推送。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  ActionResult,
  ActionFail,
  DecomposeResultDto,
  EnchantCostsDto,
  InventorySlotDto,
  MedicineStateDto,
} from '@idle-dark/protocol';
import { BusinessErrorCode, ok } from '@idle-dark/protocol';
import { failOf } from '../../../common/kernel/result.js';
import type { Player } from '@idle-dark/game-core';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { OpIdempotencyService } from '../../game/op-idempotency.service.js';
import { NOTIFICATION_BATCHER } from '../../game/notification-batcher.provider.js';
import type { NotificationBatcher } from '../../game/notification-batcher.js';
import { GAME_CLOCK, PlayerContextService, type NowSource } from '../shared/index.js';
import { PanelCharacterService } from '../shared/panel-character.service.js';
import { WorldService } from '../world/world.service.js';
import { withOperation } from '../shared/idempotency.js';
import { OpError, toFailOrThrow } from '../shared/op-error.js';
import { dtoOfResolved, listPanelSlots, resolvePanelSlot } from '../shared/slot-ref.js';
import { pushInventoryChanged } from '../shared/notify.js';
import { rngFromText, seedTextOf } from '../shared/rng.js';
import {
  type DecomposeTarget,
  enchantCostsOf,
  opDecompose,
  opEnchant,
  opRebuild,
  rebuildCostOf,
} from './internal/produce-ops.js';
import {
  medicineStateOf,
  opMedicineReset,
  opMedicineUse,
} from './internal/medicine.js';

const RATE_LIMITS = {
  enchantCosts: 240,
  enchant: 30,
  rebuild: 30,
  decompose: 30,
  medicineUse: 60,
  medicineReset: 10,
} as const;

type Loaded = { ok: true; characterId: string; player: Player } | { ok: false; fail: ActionFail };

@Injectable()
export class ProduceLogicService {
  private counter = 0;

  constructor(
    private readonly contexts: PlayerContextService,
    private readonly characters: PanelCharacterService,
    private readonly opIds: OpIdempotencyService,
    private readonly rateLimiter: RateLimiterService,
    @Inject(NOTIFICATION_BATCHER) private readonly batcher: NotificationBatcher,
    @Inject(GAME_CLOCK) private readonly now: NowSource,
    /** 末位且可选：单测手工 `new` 时不必造世界替身（见 inventory 同名注释）。 */
    private readonly world?: WorldService,
  ) {}

  async enchantCosts(
    userId: number,
    id: string,
    characterId?: string,
  ): Promise<ActionResult<EnchantCostsDto>> {
    const limited = this.rateLimiter.consumeOrFail(`produce:enchantCosts:${userId}`, RATE_LIMITS.enchantCosts);
    if (limited) return limited;
    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    const resolved = resolvePanelSlot(loaded.player, id);
    if (!resolved) return failOf(BusinessErrorCode.ITEM_NOT_FOUND);
    try {
      if (resolved.slot.empty) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
      if (!resolved.slot.isEquip) throw new OpError(BusinessErrorCode.ITEM_NOT_EQUIPPABLE);
      return ok(enchantCostsOf(resolved.slot));
    } catch (error) {
      return toFailOrThrow(error);
    }
  }

  async enchant(
    userId: number,
    id: string,
    lockedAffixKeys: readonly string[],
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto>> {
    const limited = this.rateLimiter.consumeOrFail(`produce:enchant:${userId}`, RATE_LIMITS.enchant);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player, characterId: cid } = loaded;
      const resolved = resolvePanelSlot(player, id);
      if (!resolved) return failOf(BusinessErrorCode.ITEM_NOT_FOUND);

      try {
        opEnchant(
          player,
          this.contexts.tables,
          resolved.slot,
          lockedAffixKeys,
          rngFromText(this.seed(loaded.characterId, opId)),
        );
      } catch (error) {
        return toFailOrThrow(error);
      }

      await this.persist(userId, cid, player);
      return ok(dtoOfResolved(resolved));
    });
  }

  async rebuild(
    userId: number,
    id: string,
    affixKey: string,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<InventorySlotDto>> {
    const limited = this.rateLimiter.consumeOrFail(`produce:rebuild:${userId}`, RATE_LIMITS.rebuild);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player, characterId: cid } = loaded;
      const resolved = resolvePanelSlot(player, id);
      if (!resolved) return failOf(BusinessErrorCode.ITEM_NOT_FOUND);

      try {
        opRebuild(
          player,
          this.contexts.tables,
          resolved.slot,
          affixKey,
          rngFromText(this.seed(loaded.characterId, opId)),
        );
      } catch (error) {
        return toFailOrThrow(error);
      }

      await this.persist(userId, cid, player);
      return ok(dtoOfResolved(resolved));
    });
  }

  async decompose(
    userId: number,
    id: string | undefined,
    ids: readonly string[] | undefined,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<DecomposeResultDto>> {
    const limited = this.rateLimiter.consumeOrFail(`produce:decompose:${userId}`, RATE_LIMITS.decompose);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player, characterId: cid } = loaded;

      let targets: DecomposeTarget[];
      try {
        targets = this.resolveTargets(player, id, ids);
      } catch (error) {
        return toFailOrThrow(error);
      }

      let result: DecomposeResultDto;
      try {
        result = opDecompose(player, this.contexts.tables, targets);
      } catch (error) {
        return toFailOrThrow(error);
      }

      await this.persist(userId, cid, player);
      return ok(result);
    });
  }

  async medicineState(
    userId: number,
    characterId?: string,
  ): Promise<ActionResult<MedicineStateDto>> {
    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    const extras = await this.contexts.extrasOf(userId);
    return ok(medicineStateOf(this.contexts.tables, extras));
  }

  async medicineUse(
    userId: number,
    material: string,
    count: number,
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<MedicineStateDto>> {
    const limited = this.rateLimiter.consumeOrFail(`produce:medicineUse:${userId}`, RATE_LIMITS.medicineUse);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player, characterId: cid } = loaded;
      const extras = await this.contexts.extrasOf(userId);

      try {
        opMedicineUse(
          player,
          this.contexts.tables,
          extras,
          material,
          count,
          rngFromText(this.seed(loaded.characterId, opId)),
        );
      } catch (error) {
        return toFailOrThrow(error);
      }

      await this.persist(userId, cid, player);
      return ok(medicineStateOf(this.contexts.tables, extras));
    });
  }

  async medicineReset(
    userId: number,
    currency: 'gold' | 'diamonds',
    opId?: string,
    characterId?: string,
  ): Promise<ActionResult<MedicineStateDto>> {
    const limited = this.rateLimiter.consumeOrFail(`produce:medicineReset:${userId}`, RATE_LIMITS.medicineReset);
    if (limited) return limited;

    return withOperation(this.opIds, userId, opId, async () => {
      const loaded = await this.loadPlayer(userId, characterId);
      if (!loaded.ok) return loaded.fail;
      const { player, characterId: cid } = loaded;
      const extras = await this.contexts.extrasOf(userId);

      try {
        opMedicineReset(player, this.contexts.tables, extras, currency);
      } catch (error) {
        return toFailOrThrow(error);
      }

      await this.persist(userId, cid, player);
      return ok(medicineStateOf(this.contexts.tables, extras));
    });
  }

  /** 当前可重铸费用预览（协议 `RebuildCostsDto` 现已可通过该值反推）。 */
  rebuildCostFor(player: Player, id: string): number | null {
    const resolved = resolvePanelSlot(player, id);
    if (!resolved || !resolved.slot.isEquip) return null;
    return rebuildCostOf(resolved.slot);
  }

  // ────────────────────────────── 内部 ──────────────────────────────

  private resolveTargets(
    player: Player,
    id: string | undefined,
    ids: readonly string[] | undefined,
  ): DecomposeTarget[] {
    if (id !== undefined && ids !== undefined) {
      throw new OpError(BusinessErrorCode.INVALID_PARAM, 'id 与 ids 只能二选一');
    }
    if (id === undefined && (ids === undefined || ids.length === 0)) {
      throw new OpError(BusinessErrorCode.INVALID_PARAM, '缺少分解目标');
    }

    const rawIds = id !== undefined ? [id] : [...(ids ?? [])];
    const targets: DecomposeTarget[] = [];
    for (const raw of rawIds) {
      const resolved = resolvePanelSlot(player, raw);
      if (!resolved) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
      if (resolved.position === 'equip') {
        throw new OpError(BusinessErrorCode.INVALID_PARAM, '装备中的物品无法分解');
      }
      targets.push({
        position: resolved.position as DecomposeTarget['position'],
        slot: resolved.slot,
      });
    }
    return targets;
  }

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
    // 附魔 / 重铸会重掷词缀，而词缀是 PlayerUnit 装备 hook 的来源之一。
    this.world?.markCombatDirty(userId, characterId);
    pushInventoryChanged(this.batcher, userId, listPanelSlots(this.contexts.tables, player));
  }

  private seed(characterId: string, opId: string | undefined): string {
    this.counter = (this.counter + 1) % 1_000_000;
    return seedTextOf(characterId, opId, this.now(), this.counter);
  }
}
