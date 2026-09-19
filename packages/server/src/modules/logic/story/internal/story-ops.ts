/**
 * 故事域纯逻辑（原版 `check.js#onStoryDone` + `pages/stories/*`）。
 *
 * 剧情三态存在账号级 `AccountExtras.storiesMap`（`'task'` / `'done'`）；
 * 击杀任务进度存在 `AccountExtras.enemyTasks`（`enemyKey → { storyKey: 剩余击杀数 }`），
 * 由战斗侧击杀时递减（需 `world/` 域调用本文件的 `decrementKillTask`，见交付报告）。
 */
import {
  checkRequirement,
  InventorySlot,
  type DataTables,
  type Player,
  type Requirement,
  type RequirementContext,
  type StoryData,
} from '@idle-dark/game-core';
import type { StoryDto, StoryPlayDto } from '@idle-dark/protocol';
import { BusinessErrorCode } from '@idle-dark/protocol';
import type { AccountExtras } from '../../shared/index.js';
import { OpError } from '../../inventory/internal/op-error.js';

export interface StoryNode {
  type: string;
  args: string[];
}

/** 原版 `pages/stories/Play.js#parseStory`（逐行对齐，含 `{ ... }` 多行块）。 */
export function parseStoryScript(script: string): StoryNode[] {
  const lines = script.split('\n');
  const result: StoryNode[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const pieces = (lines[i] ?? '').trim().split(' ');
    const head = pieces[0];
    if (pieces.length <= 0 || !head) continue;
    const last = pieces[pieces.length - 1];
    if (last === '{') {
      const content: string[] = [];
      while (i < lines.length - 1) {
        const inner = lines[++i];
        if (inner === '}') break;
        content.push(inner ?? '');
      }
      pieces[pieces.length - 1] = content.join('\n');
    }
    result.push({ type: head.toLowerCase(), args: pieces.slice(1) });
  }
  return result;
}

export type StoryStatus = 'none' | 'task' | 'done';

export function statusOf(extras: AccountExtras, key: string): StoryStatus {
  const value = extras.storiesMap[key];
  return value === 'done' ? 'done' : value === 'task' ? 'task' : 'none';
}

/**
 * 剧情任务的真实类型。数据表里存在**没有 `taskType`** 的纯剧情条目
 * （原版在进入地图时直接播放并标记完成），这里显式归一化。
 */
export function taskTypeOf(story: StoryData): 'kill' | 'purchase' | undefined {
  const raw = (story as { taskType?: unknown }).taskType;
  return raw === 'kill' || raw === 'purchase' ? raw : undefined;
}

/**
 * 去掉需求里的 `map` 条件。
 *
 * ⚠️ 面板域当前**拿不到当前地图**（`PlayerStateDto.map` 来自 `world/` 运行时，
 * 而 `world/` 尚未提供只读查询入口），若保留 `map` 条件会导致所有剧情永远锁死。
 * 因此本域先忽略 `map` 门槛（role / level / stories 等仍严格判定），
 * 待 world 暴露当前地图后改为传入真实值。见交付报告。
 */
export function stripMapRequirement(requirement: Requirement | undefined): Requirement | undefined {
  if (!requirement) return requirement;
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(requirement)) {
    if (key === 'map') continue;
    const value = (requirement as Record<string, unknown>)[key];
    if (key === '$or' || key === '$and') {
      if (Array.isArray(value)) {
        clone[key] = value.map((item) => stripMapRequirement(item as Requirement));
      }
      continue;
    }
    clone[key] = value;
  }
  return clone as Requirement;
}

function requirementContext(player: Player, extras: AccountExtras): RequirementContext {
  return {
    player,
    map: null,
    storiesMap: new Map(Object.entries(extras.storiesMap)),
  };
}

export function requirementMet(
  tables: DataTables,
  player: Player,
  extras: AccountExtras,
  story: StoryData,
): boolean {
  return checkRequirement(stripMapRequirement(story.requirement), requirementContext(player, extras));
}

/** 剩余击杀数（未登记任务时回落到 `killCount`）。 */
export function remainingKills(extras: AccountExtras, story: StoryData): number {
  const enemy = story.enemy ?? '';
  const task = extras.enemyTasks[enemy];
  const raw = task?.[story.key];
  const remaining = typeof raw === 'number' && Number.isFinite(raw) ? raw : story.killCount ?? 0;
  return Math.max(0, Math.trunc(remaining));
}

export function storyDtoOf(
  tables: DataTables,
  player: Player,
  extras: AccountExtras,
  story: StoryData,
): StoryDto {
  const status = statusOf(extras, story.key);
  const met = requirementMet(tables, player, extras, story);
  const taskType = taskTypeOf(story) ?? 'kill';
  const dto: StoryDto = {
    key: story.key,
    group: story.group,
    name: story.name,
    status,
    taskType,
    canStart: status === 'none' ? met : true,
    lockedReason: status === 'done' ? '剧情已完成' : status === 'none' && !met ? '条件未满足' : null,
  };
  if (story.enemy !== undefined) dto.enemy = story.enemy;
  if (story.killCount !== undefined) dto.killCount = story.killCount;
  if (taskType === 'kill' && taskTypeOf(story) === 'kill') dto.remaining = remainingKills(extras, story);
  if (story.price !== undefined) dto.price = story.price;
  return dto;
}

export function listStories(
  tables: DataTables,
  player: Player,
  extras: AccountExtras,
): StoryDto[] {
  const out: StoryDto[] = [];
  for (const key of Object.keys(tables.stories)) {
    const story = tables.stories[key];
    if (story) out.push(storyDtoOf(tables, player, extras, story));
  }
  return out;
}

/** 当前「未开启但条件已满足」的剧情 key 集合。 */
export function startableKeys(
  tables: DataTables,
  player: Player,
  extras: AccountExtras,
): Set<string> {
  const out = new Set<string>();
  for (const key of Object.keys(tables.stories)) {
    const story = tables.stories[key];
    if (!story) continue;
    if (statusOf(extras, key) !== 'none') continue;
    if (requirementMet(tables, player, extras, story)) out.add(key);
  }
  return out;
}

/**
 * 打开剧本：返回 DSL 节点。
 *
 * 若剧情尚未开始（`none`）且条件满足，则本次打开同时把它置为 `task`
 * 并登记击杀任务（原版在进入地图时 `game.addKillTask`，服务端收敛到 `play`）。
 */
export function opPlayStory(
  tables: DataTables,
  player: Player,
  extras: AccountExtras,
  key: string,
): StoryPlayDto {
  const story = tables.stories[key];
  if (!story) throw new OpError(BusinessErrorCode.STORY_NOT_FOUND);

  const status = statusOf(extras, key);
  if (status === 'none') {
    if (!requirementMet(tables, player, extras, story)) {
      throw new OpError(BusinessErrorCode.STORY_LOCKED);
    }
    extras.storiesMap[key] = 'task';
    if (taskTypeOf(story) === 'kill' && story.enemy) {
      const enemy = story.enemy;
      const bucket = extras.enemyTasks[enemy] ?? {};
      bucket[key] = story.killCount ?? 0;
      extras.enemyTasks[enemy] = bucket;
    }
  }

  return {
    key: story.key,
    name: story.name,
    nodes: parseStoryScript(story.script),
    awards: { ...story.awards },
  };
}

function grantAwards(player: Player, tables: DataTables, story: StoryData): void {
  for (const key of Object.keys(story.awards)) {
    const award = story.awards[key];
    if (key === 'purchaseRate') {
      // ⚠️ `purchaseRate` 在 game-core 的账号状态里没有字段（内购已废弃），跳过并记录。
      continue;
    }
    if (typeof award === 'number') {
      const existing = player.awardInventory.find((item) => item.key === key);
      if (existing) {
        existing.count = (existing.count ?? 0) + award;
      } else {
        player.awardInventory.push(
          new InventorySlot(tables, 'award').fromJSON({ key, count: award }),
        );
      }
      continue;
    }
    if (award && typeof award === 'object') {
      const quality = typeof award.quality === 'number' ? award.quality : 0;
      player.awardInventory.push(
        new InventorySlot(tables, 'award').fromJSON({ key, count: 1, quality, affixes: [] }),
      );
    }
  }
}

export interface FinishStoryOutcome {
  dto: StoryDto;
  /** 本次结算后新解锁的剧情（供 `(story, unlock)` 推送）。 */
  unlocked: Array<{ key: string; name: string }>;
}

/** 完成剧情：校验任务进度 / 支付购买价格 → 标记 done → 发奖 → 计算新解锁。 */
export function opFinishStory(
  tables: DataTables,
  player: Player,
  extras: AccountExtras,
  key: string,
): FinishStoryOutcome {
  const story = tables.stories[key];
  if (!story) throw new OpError(BusinessErrorCode.STORY_NOT_FOUND);
  const status = statusOf(extras, key);
  if (status === 'done') throw new OpError(BusinessErrorCode.STORY_ALREADY_DONE);
  if (status === 'none') throw new OpError(BusinessErrorCode.STORY_LOCKED, '剧情尚未开始');

  const taskType = taskTypeOf(story);
  if (taskType === 'kill') {
    if (remainingKills(extras, story) > 0) {
      throw new OpError(BusinessErrorCode.STORY_LOCKED, '击杀任务尚未完成');
    }
  } else if (taskType === 'purchase') {
    const price = typeof story.price === 'number' && Number.isFinite(story.price) ? story.price : 0;
    if (price > 0) {
      if (player.account.diamonds < price) {
        throw new OpError(BusinessErrorCode.NOT_ENOUGH_DIAMONDS, undefined, { required: price });
      }
      player.account.diamonds -= price;
    }
  }

  const before = startableKeys(tables, player, extras);
  extras.storiesMap[key] = 'done';
  if (story.enemy) {
    const bucket = extras.enemyTasks[story.enemy];
    if (bucket) {
      delete bucket[key];
      if (Object.keys(bucket).length === 0) delete extras.enemyTasks[story.enemy];
    }
  }
  grantAwards(player, tables, story);

  const after = startableKeys(tables, player, extras);
  const unlocked: Array<{ key: string; name: string }> = [];
  for (const candidate of after) {
    if (before.has(candidate)) continue;
    const data = tables.stories[candidate];
    if (data) unlocked.push({ key: candidate, name: data.name });
  }

  return { dto: storyDtoOf(tables, player, extras, story), unlocked };
}

/** 战斗击杀回调（供 `world/` 域调用）：递减任务进度并返回是否发生变化。 */
export function decrementKillTask(
  extras: AccountExtras,
  enemy: string,
  amount = 1,
  role: string | null = null,
  tables?: DataTables,
): boolean {
  const bucket = extras.enemyTasks[enemy];
  if (!bucket) return false;
  let changed = false;
  for (const key of Object.keys(bucket)) {
    if (tables) {
      const req = tables.stories[key]?.requirement;
      if (req?.role && role !== null && req.role !== role) continue;
    }
    const rest = bucket[key] ?? 0;
    bucket[key] = rest - amount;
    changed = true;
  }
  return changed;
}
