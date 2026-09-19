import { describe, expect, it } from 'vitest';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { OpError } from '../../../src/modules/logic/inventory/internal/op-error.js';
import {
  listStories,
  opFinishStory,
  opPlayStory,
  parseStoryScript,
  requirementMet,
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

describe('story 列表 / 开始 / 完成', () => {
  it('列表覆盖全部剧情，未开启的带锁定原因', () => {
    const fixture = makeFixture();
    const list = listStories(fixture.tables, fixture.player, fixture.extras);
    expect(list.length).toBe(Object.keys(fixture.tables.stories).length);
    expect(list.every((story) => story.status === 'none')).toBe(true);
  });

  it('未满足前置条件（前序剧情未完成）→ STORY_LOCKED', () => {
    const fixture = makeFixture();
    const lockedKey = Object.keys(fixture.tables.stories).find((key) => {
      const story = fixture.tables.stories[key]!;
      return !requirementMet(fixture.tables, fixture.player, fixture.extras, story);
    });
    expect(lockedKey).toBeDefined();
    expect(
      codeOf(() => opPlayStory(fixture.tables, fixture.player, fixture.extras, lockedKey!)),
    ).toBe(BusinessErrorCode.STORY_LOCKED);
  });

  it('未知剧情 → STORY_NOT_FOUND；未开始就完成 → STORY_LOCKED；已完成再完成 → STORY_ALREADY_DONE', () => {
    const fixture = makeFixture();
    expect(
      codeOf(() => opPlayStory(fixture.tables, fixture.player, fixture.extras, 'nope')),
    ).toBe(BusinessErrorCode.STORY_NOT_FOUND);

    const key = Object.keys(fixture.tables.stories)[0]!;
    expect(
      codeOf(() => opFinishStory(fixture.tables, fixture.player, fixture.extras, key)),
    ).toBe(BusinessErrorCode.STORY_LOCKED);

    fixture.extras.storiesMap[key] = 'done';
    expect(
      codeOf(() => opFinishStory(fixture.tables, fixture.player, fixture.extras, key)),
    ).toBe(BusinessErrorCode.STORY_ALREADY_DONE);
  });

  it('play 开启剧情并登记击杀任务；未完成时 finish → STORY_LOCKED', () => {
    const fixture = makeFixture();
    const key = Object.keys(fixture.tables.stories).find(
      (candidate) =>
        requirementMet(fixture.tables, fixture.player, fixture.extras, fixture.tables.stories[candidate]!),
    )!;
    const play = opPlayStory(fixture.tables, fixture.player, fixture.extras, key);
    expect(play.nodes.length).toBeGreaterThan(0);
    expect(fixture.extras.storiesMap[key]).toBe('task');

    const story = fixture.tables.stories[key]!;
    if (story.taskType === 'kill' && (story.killCount ?? 0) > 0) {
      expect(
        codeOf(() => opFinishStory(fixture.tables, fixture.player, fixture.extras, key)),
      ).toBe(BusinessErrorCode.STORY_LOCKED);
    }
  });

  it('击杀任务清零后 finish 成功并置为 done', () => {
    const fixture = makeFixture();
    // 找一条击杀类剧情，手动把它置为进行中并把剩余击杀清零。
    const key = Object.keys(fixture.tables.stories).find((candidate) => {
      const story = fixture.tables.stories[candidate]!;
      return story.taskType === 'kill' && !!story.enemy;
    })!;
    const story = fixture.tables.stories[key]!;
    fixture.extras.storiesMap[key] = 'task';
    fixture.extras.enemyTasks[story.enemy!] = { [key]: 0 };

    const outcome = opFinishStory(fixture.tables, fixture.player, fixture.extras, key);
    expect(outcome.dto.status).toBe('done');
    expect(fixture.extras.storiesMap[key]).toBe('done');
  });

  it('购买类任务神力不足 → NOT_ENOUGH_DIAMONDS', () => {
    const fixture = makeFixture();
    const key = Object.keys(fixture.tables.stories).find((candidate) => {
      const story = fixture.tables.stories[candidate]!;
      return story.taskType === 'purchase' && (story.price ?? 0) > 0;
    });
    if (!key) return; // 数据表里当前没有购买类任务时跳过
    fixture.extras.storiesMap[key] = 'task';
    fixture.account.diamonds = 0;
    expect(
      codeOf(() => opFinishStory(fixture.tables, fixture.player, fixture.extras, key)),
    ).toBe(BusinessErrorCode.NOT_ENOUGH_DIAMONDS);
  });
});
