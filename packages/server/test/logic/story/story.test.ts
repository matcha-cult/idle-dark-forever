import { describe, expect, it } from 'vitest';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { OpError } from '../../../src/modules/logic/inventory/internal/op-error.js';
import {
  listStories,
  opAdvanceStoriesOnMapEntry,
  opFinishStory,
  opPlayStory,
  parseStoryScript,
  registerStoryTask,
  requirementMet,
  taskTypeOf,
} from '../../../src/modules/logic/story/internal/story-ops.js';
import { makeFixture } from '../_helpers.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof OpError) return error.code;
    throw error;
  }
  throw new Error('expected throw');
}

function storyOf(fixture: ReturnType<typeof makeFixture>, key: string) {
  const story = fixture.tables.stories[key];
  if (!story) throw new Error(`夹具里没有剧情 ${key}`);
  return story;
}

describe('story 剧本解析', () => {
  it('解析 SAY / SCENE / 多行 {} 块', () => {
    const nodes = parseStoryScript('\nSCENE 自宅\nSAY 艾尔 你好\nASIDE {\n第一行\n第二行\n}\n');
    expect(nodes[0]).toEqual({ type: 'scene', args: ['自宅'] });
    expect(nodes[1]).toEqual({ type: 'say', args: ['艾尔', '你好'] });
    expect(nodes[2]?.type).toBe('aside');
    expect(nodes[2]?.args[0]).toBe('第一行\n第二行');
  });

  it('空脚本 → 空数组', () => {
    expect(parseStoryScript('')).toEqual([]);
  });
});

describe('taskTypeOf：区分「纯剧情脚本」与任务', () => {
  it('没有 taskType 的条目 → undefined（不是 kill）', () => {
    const fixture = makeFixture();
    // eyer-stories-1 在原版数据里只有 requirement、没有 taskType，是纯剧情脚本
    expect(taskTypeOf(storyOf(fixture, 'eyer-stories-1'))).toBeUndefined();
  });

  it('kill / purchase 原样返回', () => {
    const fixture = makeFixture();
    expect(taskTypeOf(storyOf(fixture, 'eyer-stories-3'))).toBe('kill');
  });
});

describe('地图门控（回归：曾在错误地图也能推剧情）', () => {
  it('eyer-stories-1 只在 home 满足', () => {
    const f = makeFixture();
    const story = storyOf(f, 'eyer-stories-1');
    expect(requirementMet(f.tables, f.player, f.extras, story, 'home')).toBe(true);
    expect(requirementMet(f.tables, f.player, f.extras, story, 'town.street')).toBe(false);
  });

  it('eyer-stories-2 需要「在 town.street」且「前序剧情已完成」', () => {
    const f = makeFixture();
    const story = storyOf(f, 'eyer-stories-2');

    // 前序未完成：任何时候都不满足
    expect(requirementMet(f.tables, f.player, f.extras, story, 'town.street')).toBe(false);

    f.extras.storiesMap['eyer-stories-1'] = 'done';
    // 前序完成 + 在正确地图 → 满足
    expect(requirementMet(f.tables, f.player, f.extras, story, 'town.street')).toBe(true);
    // ⚠️ 关键回归：前序完成但仍在安全屋 home → **不满足**（修复前这里会错误地返回 true）
    expect(requirementMet(f.tables, f.player, f.extras, story, 'home')).toBe(false);
    // 当前地图未知（无活跃会话）→ 保守判定为不满足
    expect(requirementMet(f.tables, f.player, f.extras, story, null)).toBe(false);
  });

  it('在错误地图 play → STORY_LOCKED', () => {
    const f = makeFixture();
    expect(
      codeOf(() => opPlayStory(f.tables, f.player, f.extras, 'eyer-stories-1', 'town.street')),
    ).toBe(BusinessErrorCode.STORY_LOCKED);
  });

  it('在正确地图 play 纯剧情脚本 → 置 task 且不登记击杀任务', () => {
    const f = makeFixture();
    const play = opPlayStory(f.tables, f.player, f.extras, 'eyer-stories-1', 'home');
    expect(play.nodes.length).toBeGreaterThan(0);
    expect(f.extras.storiesMap['eyer-stories-1']).toBe('task');
    // 纯剧情脚本没有 enemy，不应产生击杀任务
    expect(Object.keys(f.extras.enemyTasks)).toEqual([]);
  });
});

describe('story 列表 / 完成', () => {
  it('列表覆盖全部剧情；taskType 为 script 而不是 kill', () => {
    const f = makeFixture();
    const list = listStories(f.tables, f.player, f.extras, 'home');
    expect(list.length).toBe(Object.keys(f.tables.stories).length);

    const first = list.find((s) => s.key === 'eyer-stories-1');
    expect(first?.taskType).toBe('script');
    expect(first?.canStart).toBe(true);
    // 纯剧情脚本不该带击杀进度字段
    expect(first?.remaining).toBeUndefined();

    const third = list.find((s) => s.key === 'eyer-stories-3');
    expect(third?.taskType).toBe('kill');
    expect(third?.canStart).toBe(false);
  });

  it('完成纯剧情脚本 → done（无需击杀）', () => {
    const f = makeFixture();
    opPlayStory(f.tables, f.player, f.extras, 'eyer-stories-1', 'home');
    const outcome = opFinishStory(f.tables, f.player, f.extras, 'eyer-stories-1', 'home');
    expect(outcome.dto.status).toBe('done');
    expect(f.extras.storiesMap['eyer-stories-1']).toBe('done');
  });

  it('完成剧情后解锁后续（unlocked 上报）', () => {
    const f = makeFixture();
    opPlayStory(f.tables, f.player, f.extras, 'eyer-stories-1', 'home');
    const outcome = opFinishStory(f.tables, f.player, f.extras, 'eyer-stories-1', 'home');
    // 剧情 1 完成后，地图 town.street 解锁 → 站到那里即可继续剧情 2
    expect(requirementMet(f.tables, f.player, f.extras, storyOf(f, 'eyer-stories-2'), 'town.street')).toBe(
      true,
    );
    expect(Array.isArray(outcome.unlocked)).toBe(true);
  });

  it('击杀任务未清零 → STORY_LOCKED；清零后 → done', () => {
    const f = makeFixture();
    const story = storyOf(f, 'eyer-stories-3');
    f.extras.storiesMap['eyer-stories-3'] = 'task';
    f.extras.enemyTasks[story.enemy!] = { 'eyer-stories-3': 10 };
    expect(
      codeOf(() => opFinishStory(f.tables, f.player, f.extras, 'eyer-stories-3', 'town.street')),
    ).toBe(BusinessErrorCode.STORY_LOCKED);

    f.extras.enemyTasks[story.enemy!] = { 'eyer-stories-3': 0 };
    const outcome = opFinishStory(f.tables, f.player, f.extras, 'eyer-stories-3', 'town.street');
    expect(outcome.dto.status).toBe('done');
    expect(f.extras.storiesMap['eyer-stories-3']).toBe('done');
  });

  it('购买类任务神力不足 → NOT_ENOUGH_DIAMONDS', () => {
    const f = makeFixture();
    const key = Object.keys(f.tables.stories).find((candidate) => {
      const story = f.tables.stories[candidate]!;
      return story.taskType === 'purchase' && (story.price ?? 0) > 0;
    });
    if (!key) return; // 数据表里当前没有购买类任务时跳过
    f.extras.storiesMap[key] = 'task';
    f.account.diamonds = 0;
    expect(codeOf(() => opFinishStory(f.tables, f.player, f.extras, key, null))).toBe(
      BusinessErrorCode.NOT_ENOUGH_DIAMONDS,
    );
  });

  it('未知剧情 → STORY_NOT_FOUND；未开始就完成 → STORY_LOCKED；已完成再完成 → STORY_ALREADY_DONE', () => {
    const f = makeFixture();
    expect(codeOf(() => opPlayStory(f.tables, f.player, f.extras, 'nope', 'home'))).toBe(
      BusinessErrorCode.STORY_NOT_FOUND,
    );

    expect(
      codeOf(() => opFinishStory(f.tables, f.player, f.extras, 'eyer-stories-1', 'home')),
    ).toBe(BusinessErrorCode.STORY_LOCKED);

    f.extras.storiesMap['eyer-stories-1'] = 'done';
    expect(
      codeOf(() => opFinishStory(f.tables, f.player, f.extras, 'eyer-stories-1', 'home')),
    ).toBe(BusinessErrorCode.STORY_ALREADY_DONE);
  });
});

describe('进图剧情推进（原版 MapPanel.checkStories）', () => {
  it('home：纯剧情脚本只上报自动播放，不改状态、不登记击杀任务', () => {
    const f = makeFixture();
    const outcome = opAdvanceStoriesOnMapEntry(f.tables, f.player, f.extras, 'home');

    expect(outcome.scripts.map((s) => s.key)).toContain('eyer-stories-1');
    expect(outcome.tasks).toEqual([]);
    // 纯剧情脚本保持 none —— 打开（play）时才置 task，服务端不替玩家完成
    expect(f.extras.storiesMap['eyer-stories-1']).toBeUndefined();
    expect(f.extras.enemyTasks).toEqual({});
  });

  it('town.street（剧情 1 已完成）：上报剧情 2 自动播放，不登记剧情 3', () => {
    const f = makeFixture();
    f.extras.storiesMap['eyer-stories-1'] = 'done';

    const outcome = opAdvanceStoriesOnMapEntry(f.tables, f.player, f.extras, 'town.street');

    expect(outcome.scripts.map((s) => s.key)).toEqual(['eyer-stories-2']);
    // 剧情 3 还依赖剧情 2 完成 → 不在本次推进范围
    expect(outcome.tasks).toEqual([]);
  });

  it('town.street（剧情 2 已完成）：击杀任务当场登记并挂上剩余击杀数', () => {
    const f = makeFixture();
    f.extras.storiesMap['eyer-stories-1'] = 'done';
    f.extras.storiesMap['eyer-stories-2'] = 'done';

    const outcome = opAdvanceStoriesOnMapEntry(f.tables, f.player, f.extras, 'town.street');

    expect(outcome.scripts).toEqual([]);
    expect(outcome.tasks).toEqual([
      { key: 'eyer-stories-3', name: storyOf(f, 'eyer-stories-3').name, taskType: 'kill' },
    ]);
    expect(f.extras.storiesMap['eyer-stories-3']).toBe('task');
    expect(f.extras.enemyTasks['slime.minimal']?.['eyer-stories-3']).toBe(10);
  });

  it('幂等：重复调用不会重置已登记的击杀进度，也不会重复上报', () => {
    const f = makeFixture();
    f.extras.storiesMap['eyer-stories-1'] = 'done';
    f.extras.storiesMap['eyer-stories-2'] = 'done';
    opAdvanceStoriesOnMapEntry(f.tables, f.player, f.extras, 'town.street');
    f.extras.enemyTasks['slime.minimal']!['eyer-stories-3'] = 4;

    const second = opAdvanceStoriesOnMapEntry(f.tables, f.player, f.extras, 'town.street');

    expect(second.tasks).toEqual([]);
    expect(second.scripts).toEqual([]);
    // ⚠️ 进度必须保留（重复进图不能把任务重置回 10）
    expect(f.extras.enemyTasks['slime.minimal']?.['eyer-stories-3']).toBe(4);
  });

  it('地图不匹配 / 无地图上下文 → 什么都不上报', () => {
    const f = makeFixture();
    expect(opAdvanceStoriesOnMapEntry(f.tables, f.player, f.extras, 'town.cave')).toEqual({
      scripts: [],
      tasks: [],
    });
    expect(opAdvanceStoriesOnMapEntry(f.tables, f.player, f.extras, null)).toEqual({
      scripts: [],
      tasks: [],
    });
  });

  it('已完成的剧情不会再上报', () => {
    const f = makeFixture();
    f.extras.storiesMap['eyer-stories-1'] = 'done';
    const outcome = opAdvanceStoriesOnMapEntry(f.tables, f.player, f.extras, 'home');
    expect(outcome.scripts.map((s) => s.key)).not.toContain('eyer-stories-1');
  });

  it('registerStoryTask：纯剧情脚本只置 task，不产生击杀任务', () => {
    const f = makeFixture();
    registerStoryTask(f.extras, storyOf(f, 'eyer-stories-1'));
    expect(f.extras.storiesMap['eyer-stories-1']).toBe('task');
    expect(f.extras.enemyTasks).toEqual({});
  });
});

describe('完成剧情后的解锁上报（供 (story, unlock) 推送）', () => {
  it('纯剧情脚本解锁 → autoPlay=true', () => {
    const f = makeFixture();
    opPlayStory(f.tables, f.player, f.extras, 'eyer-stories-1', 'home');
    const outcome = opFinishStory(f.tables, f.player, f.extras, 'eyer-stories-1', 'home');
    // home 上其余剧情都未满足条件 → 本次没有可上报项
    expect(outcome.unlocked).toEqual([]);
  });

  it('完成剧情 2 → 剧情 3 上报为 kill 且 autoPlay=false，并当场登记击杀任务', () => {
    const f = makeFixture();
    f.extras.storiesMap['eyer-stories-1'] = 'done';
    opPlayStory(f.tables, f.player, f.extras, 'eyer-stories-2', 'town.street');

    const outcome = opFinishStory(f.tables, f.player, f.extras, 'eyer-stories-2', 'town.street');

    const entry = outcome.unlocked.find((item) => item.key === 'eyer-stories-3');
    expect(entry).toEqual({
      key: 'eyer-stories-3',
      name: storyOf(f, 'eyer-stories-3').name,
      taskType: 'kill',
      autoPlay: false,
    });
    expect(f.extras.storiesMap['eyer-stories-3']).toBe('task');
    expect(f.extras.enemyTasks['slime.minimal']?.['eyer-stories-3']).toBe(10);
  });
});
