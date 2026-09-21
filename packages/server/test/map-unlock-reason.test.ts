/**
 * 地图锁定原因（W11 / R4）：`lockedReason` 必须**区分缺失条件**。
 *
 * ## 背景
 *
 * 此前 `lockedReason` 恒为一句「尚未满足进入条件」，前端直接渲染 —— 玩家无法判断自己差的是
 * **等级**还是**守关 BOSS**。用户报「`world.2` 挂机 25+ 波仍未解锁」时，正是被这句话困住：
 * 他以为判定写错了，实际差的是等级。这是"怀疑判定有误"的直接来源。
 *
 * ⚠️ 本文件同时钉住一条纪律：**原因文案只做展示，绝不参与放行判定**。
 * 判定唯一入口仍是 `checkRequirement`（fail-closed）。
 */
import { describe, expect, it } from 'vitest';

import { createDefaultTables, type RequirementContext } from '@idle-dark/game-core';
import { checkRequirement } from '@idle-dark/game-core';
import { lockedReasonOf, mapListDtoOf } from '../src/modules/logic/shared/map-dto.js';
import { Player } from '@idle-dark/game-core';

const tables = createDefaultTables();

function context(overrides: Partial<RequirementContext['player']> = {}, bossKilled: string[] = []) {
  const ctx: RequirementContext = {
    player: {
      role: 'Eyer',
      currentCareer: 'warrior',
      level: 14,
      maxLevel: 100,
      ...overrides,
    },
    map: 'world.2',
    bossKilled: new Set(bossKilled),
  };
  return ctx;
}

describe('lockedReasonOf：缺失条件 → 玩家可读文案', () => {
  it('等级不足 → 带上目标等级与当前等级', () => {
    expect(lockedReasonOf({ level: 15 }, context({ level: 14 }), tables)).toBe(
      '需要等级 15（当前 14）',
    );
  });

  it('BOSS 未击杀 → 用上一张图的**名字**说话（不是 key）', () => {
    const reason = lockedReasonOf({ bossKilled: 'world.2' }, context({}, []), tables);
    expect(reason).toContain(tables.maps['world.2']!.name);
    expect(reason).toContain('守关 BOSS');
    expect(reason).not.toContain('world.2');
  });

  it('未知 mapKey 的前置图 → 退回 key（不崩、不留空）', () => {
    const reason = lockedReasonOf({ bossKilled: 'world.999' }, context({}, []), tables);
    expect(reason).toContain('world.999');
  });

  it('多条件同时缺失 → 用「；」串起来，且**只列缺失的**', () => {
    const reason = lockedReasonOf(
      { level: 15, bossKilled: 'world.2' },
      context({ level: 14 }, ['world.1']),
      tables,
    );
    expect(reason).toBe('需要等级 15（当前 14）；需先击杀「迷雾林间」的守关 BOSS');
  });

  it('已满足的条件不出现在原因里', () => {
    // BOSS 已杀 → 只剩等级缺失。
    const reason = lockedReasonOf(
      { level: 15, bossKilled: 'world.2' },
      context({ level: 14 }, ['world.2']),
      tables,
    );
    expect(reason).toBe('需要等级 15（当前 14）');
  });

  it('角色 / 职业 / 地图 / 等级上限条件都能给出原因', () => {
    expect(lockedReasonOf({ role: 'Eyer' }, context({ role: 'other' }), tables)).toBe(
      '需要职业 Eyer',
    );
    expect(lockedReasonOf({ career: 'knight' }, context({ currentCareer: 'warrior' }), tables)).toBe(
      '需要转职 knight',
    );
    expect(lockedReasonOf({ map: 'world.5' }, context({}, []), tables)).toContain(
      tables.maps['world.5']!.name,
    );
    expect(lockedReasonOf({ atLeastMaxLevel: 200 }, context({}, []), tables)).toBe(
      '需要等级上限 ≥ 200',
    );
    expect(lockedReasonOf({ atMostMaxLevel: 60 }, context({}, []), tables)).toBe(
      '需要等级上限 ≤ 60',
    );
  });

  it('$and 递归取子条件；$or 各分支都不满足时列出「需满足其一」', () => {
    expect(lockedReasonOf({ $and: [{ level: 99 }] }, context({ level: 1 }), tables)).toBe(
      '需要等级 99（当前 1）',
    );
    const orReason = lockedReasonOf(
      { $or: [{ level: 99 }, { bossKilled: 'world.9' }] },
      context({ level: 1 }, []),
      tables,
    );
    expect(orReason).toContain('需满足其一');
    expect(orReason).toContain('需要等级 99');
    // BOSS 分支同样用人话 + 地图名（不是 key）。
    expect(orReason).toContain(tables.maps['world.9']!.name);
  });

  it('$or 有任一分支满足 → 不产生任何原因（判定本就不会锁）', () => {
    expect(lockedReasonOf({ $or: [{ level: 1 }] }, context({ level: 14 }), tables)).toBe(
      '尚未满足进入条件',
    );
  });

  it('分析不出来的条件 / 空条件 → 回落通用文案（绝不返回空串）', () => {
    for (const req of [{}, null, undefined, { debug: true }]) {
      const reason = lockedReasonOf(req, context(), tables);
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
      expect(reason).toBe('尚未满足进入条件');
    }
  });

  it('脏值条件不产生误导文案（NaN / Infinity / 空串 / 数字 role）', () => {
    const reason = lockedReasonOf(
      {
        level: Number.NaN,
        atMostMaxLevel: Infinity,
        role: '',
        career: 42 as unknown as string,
        map: null as unknown as string,
        bossKilled: 7 as unknown as string,
      },
      context(),
      tables,
    );
    expect(reason).toBe('尚未满足进入条件');
  });

  it('循环条件（自引用）不死循环、不抛错', () => {
    const cyclic = { $and: [] as unknown[] };
    cyclic.$and.push(cyclic);
    const reason = lockedReasonOf(cyclic as never, context(), tables);
    expect(typeof reason).toBe('string');
    expect(reason.length).toBeGreaterThan(0);
  });
});

describe('与真实解锁链一致性（世界地图走 bossKilled 链）', () => {
  function playerAt(level: number, killed: string[]): Player {
    const p = Player.fromJSON(tables, 'c1', () => 0, { role: 'Eyer', currentCareer: 'warrior' });
    p.postCreate();
    p.level = level;
    for (const map of killed) p.markWorldBossKilled(map);
    return p;
  }

  it('level 1 + 未击杀任何 BOSS：world.2 的锁定原因直指上一图的守关 BOSS', () => {
    const list = mapListDtoOf(tables, playerAt(1, []), 'world.1');
    const world2 = list.find((m) => m.key === 'world.2');
    expect(world2?.unlocked).toBe(false);
    expect(world2?.lockedReason).toContain(tables.maps['world.1']!.name);
    expect(world2?.lockedReason).toContain('守关 BOSS');
  });

  it('W11 关键回归：**等级不再进入解锁条件** —— 14 级只要杀过 world.2 就能进 world.3', () => {
    const list = mapListDtoOf(tables, playerAt(14, ['world.1', 'world.2']), 'world.2');
    const world3 = list.find((m) => m.key === 'world.3');
    expect(world3?.unlocked).toBe(true);
    expect(world3?.lockedReason).toBeNull();
    // 这正是「啊啊」卡住的那一步：旧实现要求等级 15，而 13→15 实测需 21228 次击杀。
    expect(checkRequirement(tables.maps['world.3']!.requirement, {
      player: { role: 'Eyer', currentCareer: 'warrior', level: 14, maxLevel: 100 },
      map: 'world.2',
      bossKilled: new Set(['world.1', 'world.2']),
    })).toBe(true);
  });

  it('通关链逐段推进：每张图的锁定原因都指向它自己的前置图', () => {
    for (const [key, map] of Object.entries(tables.maps)) {
      if (!key.startsWith('world.')) continue;
      const bossKilled = map.requirement?.bossKilled;
      if (!bossKilled) continue; // world.1 无门槛
      const list = mapListDtoOf(tables, playerAt(1, []), 'world.1');
      const dto = list.find((m) => m.key === key);
      expect(dto?.unlocked, key).toBe(false);
      expect(dto?.lockedReason, key).toContain('守关 BOSS');
    }
  });
});
