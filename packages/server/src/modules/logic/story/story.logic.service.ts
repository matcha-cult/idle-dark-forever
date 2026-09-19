/**
 * 故事域门面（Action → 本服务 → internal 纯逻辑）。
 *
 * 剧情三态 / 击杀进度 / 药剂等级都在账号级 `AccountExtras`（`account_state.data`），
 * 因此落库走 `markAccountDirty` + `flushAccount`。
 *
 * 08 §2.3 解环（R1-a2）：本服务**不再 import `WorldService`**。
 * - 「当前地图」改读**持久化位置** `extras.worldMaps[characterId].map`（唯一权威）；
 * - 进图推进 / 击杀递减改为订阅 battle 发布的 `MapEntered` / `EnemyKilled` 事件。
 */
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ActionResult, ActionFail, StoryDto, StoryPlayDto } from '@idle-dark/protocol';
import { BusinessErrorCode, ok } from '@idle-dark/protocol';
import { failOf } from '../../../common/kernel/result.js';
import type { Player } from '@idle-dark/game-core';
import { RateLimiterService } from '../../../common/services/rate-limiter.service.js';
import { NOTIFICATION_BATCHER } from '../../game/notification-batcher.provider.js';
import type { NotificationBatcher } from '../../game/notification-batcher.js';
import {
  EVENT_BUS,
  PanelCharacterService,
  PlayerContextService,
  type AccountExtras,
  type EnemyKilledEvent,
  type EventBus,
  type MapEnteredEvent,
  listPanelSlots,
  pushInventoryChanged,
  pushStoryUnlock,
  toFailOrThrow,
} from '../shared/index.js';
import {
  listStories,
  opAdvanceStoriesOnMapEntry,
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
export class StoryLogicService implements OnModuleInit {
  constructor(
    private readonly contexts: PlayerContextService,
    private readonly characters: PanelCharacterService,
    private readonly rateLimiter: RateLimiterService,
    @Inject(NOTIFICATION_BATCHER) private readonly batcher: NotificationBatcher,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  /**
   * 订阅 battle 发布的战斗侧事件（08 §2.3）：
   * - `MapEntered` → 原 `MapPanel.checkStories()` 的进图推进；
   * - `EnemyKilled` → 原 `game.onEnemyKilled` 的击杀任务递减。
   *
   * 总线是**同步**派发，因此与解环前「world 直接调用」的时序完全一致。
   */
  onModuleInit(): void {
    this.events.on('MapEntered', (event) => this.handleMapEntered(event));
    this.events.on('EnemyKilled', (event) => this.handleEnemyKilled(event));
  }

  /**
   * 进图剧情推进（原版 `MapPanel.checkStories()`）：条件满足的击杀 / 购买任务**当场登记**，
   * 纯剧情脚本推给前端**自动播放**。
   *
   * 幂等（登记过的不会再命中）。回调内不 await：账号与角色此刻已在 `PlayerContextService`
   * 缓存里（由 battle 会话启动时加载），`peek*` 同步取用即可保持 tick 内时序。
   */
  private handleMapEntered(event: MapEnteredEvent): void {
    const player = this.contexts.peek(event.userId, event.characterId);
    const extras = this.contexts.peekExtras(event.userId);
    if (player === null || extras === null) return;
    const outcome = opAdvanceStoriesOnMapEntry(this.contexts.tables, player, extras, event.map);
    if (outcome.tasks.length === 0 && outcome.scripts.length === 0) return;
    this.contexts.markAccountDirty(event.userId);
    for (const task of outcome.tasks) {
      pushStoryUnlock(this.batcher, event.userId, {
        key: task.key,
        name: task.name,
        taskType: task.taskType,
        autoPlay: false,
      });
    }
    for (const script of outcome.scripts) {
      pushStoryUnlock(this.batcher, event.userId, {
        key: script.key,
        name: script.name,
        taskType: 'script',
        autoPlay: true,
      });
    }
  }

  /**
   * 击杀任务递减（原版 `game.onEnemyKilled`）。
   *
   * 内核保证 `count ≥ 1`；此处仍做防御：`undefined/NaN/Infinity/0/负数` 一律按 1 次计，
   * 避免把剩余数写成 `NaN`（解环前是无保护写法）。
   */
  private handleEnemyKilled(event: EnemyKilledEvent): void {
    const extras = this.contexts.peekExtras(event.userId);
    if (extras === null) return;
    const tasks = extras.enemyTasks[event.enemyType];
    if (!tasks) return;
    const dec = Number.isFinite(event.count) ? Math.max(1, Math.trunc(event.count)) : 1;
    let changed = false;
    const justFinished: string[] = [];
    for (const storyKey of Object.keys(tasks)) {
      const remaining = tasks[storyKey];
      if (remaining === undefined || remaining <= 0) continue;
      const next = Math.max(0, remaining - dec);
      tasks[storyKey] = next;
      changed = true;
      if (next === 0) justFinished.push(storyKey);
    }
    if (!changed) return;
    this.contexts.markAccountDirty(event.userId);
    // 原版 `checkKill()`：击杀任务达成且有剧本时**当场弹剧本**（前端据此自动打开）。
    for (const key of justFinished) {
      const story = this.contexts.tables.stories[key];
      if (story?.script) {
        pushStoryUnlock(this.batcher, event.userId, {
          key,
          name: story.name,
          taskType: 'script',
          autoPlay: true,
        });
      }
    }
  }

  async list(userId: number, characterId?: string): Promise<ActionResult<StoryDto[]>> {
    const loaded = await this.loadPlayer(userId, characterId);
    if (!loaded.ok) return loaded.fail;
    const extras = await this.contexts.extrasOf(userId);
    return ok(
      listStories(
        this.contexts.tables,
        loaded.player,
        extras,
        currentMapOf(extras, loaded.characterId),
      ),
    );
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
    const map = currentMapOf(extras, loaded.characterId);

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
    const map = currentMapOf(extras, cid);

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
      pushStoryUnlock(this.batcher, userId, unlocked);
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

/**
 * 当前地图（剧情需求里的 `map` 条件要用它判定）——**唯一权威是持久化位置**
 * `extras.worldMaps[characterId].map`（由 battle 会话启动 / 进图时写入）。
 *
 * 拿不到时返回 `null` —— 此时任何带 `map` 条件的剧情都判定为「未满足」，
 * 这正是想要的方向：宁可让剧情晚一点解锁，也不要让玩家在错误的地图把它做掉。
 */
export function currentMapOf(extras: AccountExtras, characterId: string): string | null {
  const stored = extras.worldMaps[characterId];
  if (stored === undefined) return null;
  const map = stored.map;
  return typeof map === 'string' && map !== '' ? map : null;
}
