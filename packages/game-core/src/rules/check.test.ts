import { describe, expect, it } from 'vitest';

import { checkRequirement, checkStory, type RequirementContext } from './check.js';

function makeContext(overrides: Partial<RequirementContext> = {}): RequirementContext {
  return {
    player: { role: 'Eyer', currentCareer: 'warrior', level: 20, maxLevel: 60 },
    map: 'home',
    storiesMap: new Map(),
    ...overrides,
  };
}

describe('checkRequirement', () => {
  it('空条件 / 空对象为真（原版 `= {}` 默认参数语义）', () => {
    const context = makeContext();
    expect(checkRequirement({}, context)).toBe(true);
    expect(checkRequirement(undefined, context)).toBe(true);
    expect(checkRequirement(null, context)).toBe(true);
  });

  it('role / career 判定', () => {
    const context = makeContext();
    expect(checkRequirement({ role: 'Eyer' }, context)).toBe(true);
    expect(checkRequirement({ role: 'Other' }, context)).toBe(false);
    expect(checkRequirement({ career: 'warrior' }, context)).toBe(true);
    expect(checkRequirement({ career: 'mage' }, context)).toBe(false);
  });

  it('无角色时任何角色相关条件都不成立', () => {
    const context = makeContext({ player: null });
    expect(checkRequirement({ role: 'Eyer' }, context)).toBe(false);
    expect(checkRequirement({ career: 'warrior' }, context)).toBe(false);
    expect(checkRequirement({ level: 1 }, context)).toBe(false);
    expect(checkRequirement({ atMostMaxLevel: 100 }, context)).toBe(false);
    expect(checkRequirement({ atLeastMaxLevel: 1 }, context)).toBe(false);
  });

  it('level 为下限；atMostMaxLevel / atLeastMaxLevel 作用于 maxLevel', () => {
    const context = makeContext();
    expect(checkRequirement({ level: 20 }, context)).toBe(true);
    expect(checkRequirement({ level: 21 }, context)).toBe(false);
    expect(checkRequirement({ atMostMaxLevel: 60 }, context)).toBe(true);
    expect(checkRequirement({ atMostMaxLevel: 59 }, context)).toBe(false);
    expect(checkRequirement({ atLeastMaxLevel: 60 }, context)).toBe(true);
    expect(checkRequirement({ atLeastMaxLevel: 61 }, context)).toBe(false);
  });

  it('level 为 0 / NaN / undefined 时视为「无此条件」（原版假值语义）', () => {
    const context = makeContext();
    expect(checkRequirement({ level: 0 }, context)).toBe(true);
    expect(checkRequirement({ level: Number.NaN }, context)).toBe(true);
    expect(checkRequirement({ level: undefined }, context)).toBe(true);
  });

  it('map 判定', () => {
    expect(checkRequirement({ map: 'home' }, makeContext())).toBe(true);
    expect(checkRequirement({ map: 'forest' }, makeContext())).toBe(false);
    expect(checkRequirement({ map: 'home' }, makeContext({ map: null }))).toBe(false);
  });

  it('stories：全部 done 才成立', () => {
    const context = makeContext({
      storiesMap: new Map([
        ['a', 'done'],
        ['b', 'task'],
      ]),
    });
    expect(checkRequirement({ stories: ['a'] }, context)).toBe(true);
    expect(checkRequirement({ stories: ['a', 'b'] }, context)).toBe(false);
    expect(checkRequirement({ stories: ['missing'] }, context)).toBe(false);
    expect(checkRequirement({ stories: [] }, context)).toBe(true);
  });

  it('beforeStories：任何一个 done 就不成立', () => {
    const context = makeContext({ storiesMap: new Map([['a', 'done']]) });
    expect(checkRequirement({ beforeStories: ['a'] }, context)).toBe(false);
    expect(checkRequirement({ beforeStories: ['b'] }, context)).toBe(true);
    expect(checkRequirement({ beforeStories: [] }, context)).toBe(true);
  });

  it('stories / beforeStories 非数组时跳过（原版会抛 TypeError）', () => {
    const context = makeContext();
    expect(checkRequirement({ stories: 'a' as unknown as string[] }, context)).toBe(true);
    expect(checkRequirement({ beforeStories: 1 as unknown as string[] }, context)).toBe(true);
  });

  it('$or：任一成立；空数组为不成立（原版 `.some` 语义）', () => {
    const context = makeContext();
    expect(checkRequirement({ $or: [{ level: 1 }, { level: 999 }] }, context)).toBe(true);
    expect(checkRequirement({ $or: [{ level: 999 }, { career: 'mage' }] }, context)).toBe(false);
    expect(checkRequirement({ $or: [] }, context)).toBe(false);
    expect(checkRequirement({ $or: 'x' as unknown as [] }, context)).toBe(true);
  });

  it('$and：全部成立；空数组为成立（原版 `.every` 语义）', () => {
    const context = makeContext();
    expect(checkRequirement({ $and: [{ level: 1 }, { career: 'warrior' }] }, context)).toBe(true);
    expect(checkRequirement({ $and: [{ level: 1 }, { career: 'mage' }] }, context)).toBe(false);
    expect(checkRequirement({ $and: [] }, context)).toBe(true);
  });

  it('$or / $and 递归嵌套', () => {
    const context = makeContext();
    const requirement = {
      $and: [{ level: 10 }, { $or: [{ career: 'mage' }, { career: 'warrior' }] }],
    };
    expect(checkRequirement(requirement, context)).toBe(true);
    expect(checkRequirement({ $and: [{ level: 99 }, { $or: [{ career: 'warrior' }] }] }, context)).toBe(
      false,
    );
  });

  it('多条件同时存在时是 AND 关系', () => {
    const context = makeContext({ storiesMap: new Map([['a', 'done']]) });
    expect(checkRequirement({ role: 'Eyer', career: 'warrior', level: 20, map: 'home', stories: ['a'] }, context)).toBe(
      true,
    );
    expect(checkRequirement({ role: 'Eyer', career: 'warrior', level: 20, map: 'forest' }, context)).toBe(false);
  });
});

describe('checkStory', () => {
  it('已 done 的剧情不可再开启', () => {
    const context = makeContext({ storiesMap: new Map([['s1', 'done']]) });
    expect(checkStory({ key: 's1', requirement: {} }, context)).toBe(false);
    expect(checkStory({ key: 's2', requirement: {} }, context)).toBe(true);
  });

  it('未完成时按 requirement 判定', () => {
    const context = makeContext();
    expect(checkStory({ key: 's1', requirement: { level: 21 } }, context)).toBe(false);
    expect(checkStory({ key: 's1', requirement: { level: 20 } }, context)).toBe(true);
  });

  it('requirement 缺失视为无附加条件', () => {
    expect(checkStory({ key: 's1' }, makeContext())).toBe(true);
  });

  it('task 态不算 done，仍可开启', () => {
    const context = makeContext({ storiesMap: new Map([['s1', 'task']]) });
    expect(checkStory({ key: 's1', requirement: {} }, context)).toBe(true);
  });
});
