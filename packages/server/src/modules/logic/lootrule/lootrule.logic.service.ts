/**
 * 拾取规则域门面（Action → 本服务 → internal 纯逻辑）。
 *
 * 读写都返回完整 `LootRuleStateDto`（前端整体替换）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  ActionResult,
  ActionFail,
  LootRuleStateDto,
  LootRuleUpdateInput,
} from '@idle-dark/protocol';
import { BusinessErrorCode, ok } from '@idle-dark/protocol';
import { failOf } from '../../../common/kernel/result.js';
import type { Player } from '@idle-dark/game-core';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { PlayerContextService } from '../shared/index.js';
import { PanelCharacterService } from '../inventory/internal/panel-character.service.js';
import { toFailOrThrow } from '../inventory/internal/op-error.js';
import { opSetMinLevel, opUpdateLootRule, lootRuleStateOf } from './internal/loot-rule-ops.js';

const RATE_LIMITS = {
  update: 60,
  setMinLevel: 60,
} as const;

type Loaded = { ok: true; characterId: string; player: Player } | { ok: false; fail: ActionFail };

@Injectable()
export class LootRuleLogicService {
  constructor(
    private readonly contexts: PlayerContextService,
    private readonly characters: PanelCharacterService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async get(userId: number, characterId?: string): Promise<ActionResult<LootRuleStateDto>> {
    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    return ok(lootRuleStateOf(loaded.player));
  }

  async update(
    userId: number,
    input: LootRuleUpdateInput,
    characterId?: string,
  ): Promise<ActionResult<LootRuleStateDto>> {
    const limited = this.rateLimiter.consumeOrFail(`lootrule:update:${userId}`, RATE_LIMITS.update);
    if (limited) return limited;

    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    const { player, characterId: cid } = loaded;

    try {
      opUpdateLootRule(player, input);
    } catch (error) {
      return toFailOrThrow(error);
    }

    this.contexts.markDirty(userId, cid);
    await this.contexts.flush(userId, cid);
    return ok(lootRuleStateOf(player));
  }

  async setMinLevel(
    userId: number,
    minLevel: number,
    characterId?: string,
  ): Promise<ActionResult<LootRuleStateDto>> {
    const limited = this.rateLimiter.consumeOrFail(`lootrule:setMinLevel:${userId}`, RATE_LIMITS.setMinLevel);
    if (limited) return limited;

    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    const { player, characterId: cid } = loaded;

    try {
      opSetMinLevel(player, minLevel);
    } catch (error) {
      return toFailOrThrow(error);
    }

    this.contexts.markDirty(userId, cid);
    await this.contexts.flush(userId, cid);
    return ok(lootRuleStateOf(player));
  }

  private async loadPlayer(userId: number, characterId?: string): Promise<Loaded> {
    const resolved = await this.characters.resolve(userId, characterId);
    if (resolved === null) return { ok: false, fail: failOf(BusinessErrorCode.PLAYER_NOT_FOUND) };
    const player = await this.contexts.load(userId, resolved);
    if (player === null) return { ok: false, fail: failOf(BusinessErrorCode.PLAYER_NOT_FOUND) };
    return { ok: true, characterId: resolved, player };
  }
}
