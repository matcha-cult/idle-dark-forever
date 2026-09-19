/**
 * 故事域门面（Action → 本服务 → internal 纯逻辑）。
 *
 * 剧情三态 / 击杀进度 / 药剂等级都在账号级 `AccountExtras`（`account_state.data`），
 * 因此落库走 `markAccountDirty` + `flushAccount`。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ActionResult, ActionFail, StoryDto, StoryPlayDto } from '@idle-dark/protocol';
import { BusinessErrorCode, ok } from '@idle-dark/protocol';
import { failOf } from '../../../common/kernel/result.js';
import type { Player } from '@idle-dark/game-core';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { NOTIFICATION_BATCHER } from '../../game/notification-batcher.provider.js';
import type { NotificationBatcher } from '../../game/notification-batcher.js';
import { PlayerContextService } from '../shared/index.js';
import { PanelCharacterService } from '../inventory/internal/panel-character.service.js';
import { WorldService } from '../world/world.service.js';
import { toFailOrThrow } from '../inventory/internal/op-error.js';
import { pushInventoryChanged, pushStoryUnlock } from '../inventory/internal/notify.js';
import { listPanelSlots } from '../inventory/internal/slot-ref.js';
import {
  listStories,
  opFinishStory,
  opPlayStory,
  type FinishStoryOutcome,
} from './internal/story-ops.js';

const RATE_LIMITS = {
  play: 60,
  finish: 60,
} as const;

type Loaded = { ok: true; characterId: string; player: Player } | { ok: false; fail: ActionFail };

@Injectable()
export class StoryLogicService {
  constructor(
    private readonly contexts: PlayerContextService,
    private readonly characters: PanelCharacterService,
    private readonly rateLimiter: RateLimiterService,
    private readonly world: WorldService,
    @Inject(NOTIFICATION_BATCHER) private readonly batcher: NotificationBatcher,
  ) {}

  /**
   * 当前地图（剧情需求里的 `map` 条件要用它判定）。
   *
   * 拿不到会话时返回 `null` —— 此时任何带 `map` 条件的剧情都判定为「未满足」，
   * 这正是想要的方向：宁可让剧情晚一点解锁，也不要让玩家在错误的地图把它做掉。
   */
  private currentMapOf(userId: number, characterId: string): string | null {
    return this.world.positionOf(userId, characterId)?.map ?? null;
  }

  async list(userId: number, characterId?: string): Promise<ActionResult<StoryDto[]>> {
    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    const extras = await this.contexts.extrasOf(userId);
    const map = this.currentMapOf(userId, loaded.characterId);
    return ok(listStories(this.contexts.tables, loaded.player, extras, map));
  }

  async play(
    userId: number,
    key: string,
    characterId?: string,
  ): Promise<ActionResult<StoryPlayDto>> {
    const limited = this.rateLimiter.consumeOrFail(`story:play:${userId}`, RATE_LIMITS.play);
    if (limited) return limited;

    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    const extras = await this.contexts.extrasOf(userId);
    const map = this.currentMapOf(userId, loaded.characterId);

    let result: StoryPlayDto;
    try {
      result = opPlayStory(this.contexts.tables, loaded.player, extras, key, map);
    } catch (error) {
      return toFailOrThrow(error);
    }

    this.contexts.markAccountDirty(userId);
    await this.contexts.flushAccount(userId);
    return ok(result);
  }

  async finish(
    userId: number,
    key: string,
    characterId?: string,
  ): Promise<ActionResult<StoryDto>> {
    const limited = this.rateLimiter.consumeOrFail(`story:finish:${userId}`, RATE_LIMITS.finish);
    if (limited) return limited;

    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    const { player, characterId: cid } = loaded;
    const extras = await this.contexts.extrasOf(userId);
    const map = this.currentMapOf(userId, cid);

    let outcome: FinishStoryOutcome;
    try {
      outcome = opFinishStory(this.contexts.tables, player, extras, key, map);
    } catch (error) {
      return toFailOrThrow(error);
    }

    this.contexts.markDirty(userId, cid);
    this.contexts.markAccountDirty(userId);
    await this.contexts.flush(userId, cid);
    pushInventoryChanged(this.batcher, userId, listPanelSlots(this.contexts.tables, player));
    for (const unlocked of outcome.unlocked) {
      pushStoryUnlock(this.batcher, userId, unlocked.key, unlocked.name);
    }
    return ok(outcome.dto);
  }

  private async loadPlayer(userId: number, characterId?: string): Promise<Loaded> {
    const resolved = await this.characters.resolve(userId, characterId);
    if (resolved === null) return { ok: false, fail: failOf(BusinessErrorCode.PLAYER_NOT_FOUND) };
    const player = await this.contexts.load(userId, resolved);
    if (player === null) return { ok: false, fail: failOf(BusinessErrorCode.PLAYER_NOT_FOUND) };
    return { ok: true, characterId: resolved, player };
  }
}
