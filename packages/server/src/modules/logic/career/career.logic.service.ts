/**
 * 职业域门面（Action → 本服务 → internal 纯逻辑）。
 *
 * 写操作后返回最新 `CareerPanelDto`（前端整体替换）。
 *
 * ⚠️ game-core 的显式重绑约定：切换职业 / 选技能 / 选强化会改变战斗侧 `PlayerUnit` 的
 * hook 与技能表，但 `world/` 域目前**没有**提供 `rebind*` 入口（见交付报告「未完成项」）。
 * 本服务只改存档并落库；重绑需由战斗侧在下一次 tick / 进场时重新构建 PlayerUnit。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ActionResult, ActionFail, CareerPanelDto } from '@idle-dark/protocol';
import { BusinessErrorCode, ok } from '@idle-dark/protocol';
import { failOf } from '../../../common/kernel/result.js';
import type { Player } from '@idle-dark/game-core';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { NOTIFICATION_BATCHER } from '../../game/notification-batcher.provider.js';
import type { NotificationBatcher } from '../../game/notification-batcher.js';
import { EVENT_BUS, PlayerContextService, type EventBus } from '../shared/index.js';
import { PanelCharacterService } from '../shared/panel-character.service.js';
import { toFailOrThrow } from '../shared/op-error.js';
import { pushCareerLevelup } from '../shared/notify.js';
import {
  careerPanelOf,
  opSelectEnhance,
  opSelectSkill,
  opSwitchCareer,
  opUnselectEnhance,
  opUnselectSkill,
} from './internal/career-ops.js';

const RATE_LIMITS = {
  switchCareer: 20,
  selectSkill: 60,
  unselectSkill: 60,
  selectEnhance: 60,
  unselectEnhance: 60,
} as const;

type Loaded = { ok: true; characterId: string; player: Player } | { ok: false; fail: ActionFail };

@Injectable()
export class CareerLogicService {
  constructor(
    private readonly contexts: PlayerContextService,
    private readonly characters: PanelCharacterService,
    private readonly rateLimiter: RateLimiterService,
    @Inject(NOTIFICATION_BATCHER) private readonly batcher: NotificationBatcher,
    /** 跨服事件总线（08 §2.3 解环）：切职业/技能/强化后发布 `CombatHooksDirty`。 */
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  async list(userId: number, characterId?: string): Promise<ActionResult<CareerPanelDto>> {
    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    return ok(careerPanelOf(this.contexts.tables, loaded.player));
  }

  async switchCareer(
    userId: number,
    career: string,
    characterId?: string,
  ): Promise<ActionResult<CareerPanelDto>> {
    return this.runMutation(userId, 'switchCareer', RATE_LIMITS.switchCareer, characterId, (player) => {
      opSwitchCareer(this.contexts.tables, player, career);
    });
  }

  async selectSkill(
    userId: number,
    skill: string,
    characterId?: string,
  ): Promise<ActionResult<CareerPanelDto>> {
    return this.runMutation(userId, 'selectSkill', RATE_LIMITS.selectSkill, characterId, (player) => {
      opSelectSkill(player, skill);
    });
  }

  async unselectSkill(
    userId: number,
    skill: string,
    characterId?: string,
  ): Promise<ActionResult<CareerPanelDto>> {
    return this.runMutation(userId, 'unselectSkill', RATE_LIMITS.unselectSkill, characterId, (player) => {
      opUnselectSkill(player, skill);
    });
  }

  async selectEnhance(
    userId: number,
    enhance: string,
    characterId?: string,
  ): Promise<ActionResult<CareerPanelDto>> {
    return this.runMutation(userId, 'selectEnhance', RATE_LIMITS.selectEnhance, characterId, (player) => {
      opSelectEnhance(player, enhance);
    });
  }

  async unselectEnhance(
    userId: number,
    enhance: string,
    characterId?: string,
  ): Promise<ActionResult<CareerPanelDto>> {
    return this.runMutation(
      userId,
      'unselectEnhance',
      RATE_LIMITS.unselectEnhance,
      characterId,
      (player) => {
        opUnselectEnhance(player, enhance);
      },
    );
  }

  /**
   * `(career, levelup)` 推送入口（供 `world/` 域升级时调用）。
   * 面板域自身的写操作不会升级，这里只暴露给世界 tick 使用。
   */
  notifyLevelup(
    userId: number,
    payload: { level: number; career: string },
  ): void {
    pushCareerLevelup(this.batcher, userId, payload);
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
    rateKey: string,
    limit: number,
    characterId: string | undefined,
    work: (player: Player) => void | Promise<void>,
  ): Promise<ActionResult<CareerPanelDto>> {
    const limited = this.rateLimiter.consumeOrFail(`career:${rateKey}:${userId}`, limit);
    if (limited) return limited;

    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    const { player, characterId: cid } = loaded;

    try {
      await work(player);
    } catch (error) {
      return toFailOrThrow(error);
    }

    this.contexts.markDirty(userId, cid);
    await this.contexts.flush(userId, cid);
    // 切职业 / 选技能 / 选强化会让 PlayerUnit 的被动与强化 hook 过期 → 发布事件由 battle 重绑。
    this.events.emit({ type: 'CombatHooksDirty', userId, characterId: cid });
    return ok(careerPanelOf(this.contexts.tables, player));
  }
}
