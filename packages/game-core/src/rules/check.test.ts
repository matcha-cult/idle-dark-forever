import { describe, expect, it } from 'vitest';

import { checkRequirement, type RequirementContext } from './check.js';

function makeContext(overrides: Partial<RequirementContext> = {}): RequirementContext {
  return {
    player: { role: 'Eyer', currentCareer: 'warrior', level: 20, maxLevel: 60 },
    map: 'home',
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

  it('bossKilled：命中集合成立；未命中 / 空集 / 上下文缺失一律 fail-closed', () => {
    expect(
      checkRequirement({ bossKilled: 'world.1' }, makeContext({ bossKilled: new Set(['world.1']) })),
    ).toBe(true);
    expect(
      checkRequirement({ bossKilled: 'world.2' }, makeContext({ bossKilled: new Set(['world.1']) })),
    ).toBe(false);
    expect(checkRequirement({ bossKilled: 'world.1' }, makeContext({ bossKilled: new Set() }))).toBe(false);
    // 上下文没有 bossKilled（undefined / 未提供）→ 不成立
    expect(checkRequirement({ bossKilled: 'world.1' }, makeContext())).toBe(false);
    expect(
      checkRequirement({ bossKilled: 'world.1' }, makeContext({ bossKilled: undefined })),
    ).toBe(false);
  });

  it('bossKilled：undefined / 空串 / 非字符串视为「无此条件」', () => {
    const context = makeContext({ bossKilled: new Set(['world.1']) });
    expect(checkRequirement({ bossKilled: undefined }, context)).toBe(true);
    expect(checkRequirement({ bossKilled: '' }, context)).toBe(true);
    expect(checkRequirement({ bossKilled: 123 as unknown as string }, context)).toBe(true);
  });

  it('bossKilled 与 level 是 AND 关系（解锁链语义）', () => {
    expect(
      checkRequirement(
        { level: 5, bossKilled: 'world.1' },
        makeContext({ player: { role: 'Eyer', currentCareer: 'warrior', level: 5, maxLevel: 100 }, bossKilled: new Set(['world.1']) }),
      ),
    ).toBe(true);
    expect(
      checkRequirement(
        { level: 5, bossKilled: 'world.1' },
        makeContext({ player: { role: 'Eyer', currentCareer: 'warrior', level: 4, maxLevel: 100 }, bossKilled: new Set(['world.1']) }),
      ),
    ).toBe(false);
    expect(
      checkRequirement(
        { level: 5, bossKilled: 'world.1' },
        makeContext({ player: { role: 'Eyer', currentCareer: 'warrior', level: 5, maxLevel: 100 }, bossKilled: new Set() }),
      ),
    ).toBe(false);
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
    const context = makeContext();
    expect(checkRequirement({ role: 'Eyer', career: 'warrior', level: 20, map: 'home' }, context)).toBe(
      true,
    );
    expect(checkRequirement({ role: 'Eyer', career: 'warrior', level: 20, map: 'forest' }, context)).toBe(false);
  });

  it('自引用 / 循环构造的 $or·$and 不爆栈（超过深度上限 fail-closed）', () => {
    const context = makeContext();
    const selfOr: { $or: unknown[] } = { $or: [] };
    selfOr.$or.push(selfOr);
    expect(() => checkRequirement(selfOr, context)).not.toThrow();
    expect(checkRequirement(selfOr, context)).toBe(false);

    const selfAnd: { $and: unknown[] } = { $and: [] };
    selfAnd.$and.push(selfAnd);
    expect(checkRequirement(selfAnd, context)).toBe(false);

    // 互相引用（A→B→A）同样不爆栈
    const a: { $or: unknown[] } = { $or: [] };
    const b: { $or: unknown[] } = { $or: [a] };
    a.$or.push(b);
    expect(checkRequirement(a, context)).toBe(false);
  });

  it('深度恰好在上限内的嵌套仍按语义判定（不误伤）', () => {
    const context = makeContext();
    let ok: Record<string, unknown> = { level: 20 };
    for (let i = 0; i < 30; i += 1) ok = { $and: [ok] };
    expect(checkRequirement(ok as never, context)).toBe(true);
  });
});
