import { describe, expect, it } from 'vitest';
import { PUBLIC_ACTION_KEYS, cmdMerge } from '@idle-dark/protocol';
import {
  assertNoDuplicateRoutes,
  assertPublicActionsRegistered,
  findDuplicateRoutes,
  findUnregisteredPublicActions,
  type RouteEntry,
} from '../src/ionet/route-check.js';

function entry(cmd: number, subCmd: number, label: string): RouteEntry {
  return { cmd, subCmd, label };
}

describe('findDuplicateRoutes', () => {
  it('空数组 / 单条 → 无冲突', () => {
    expect(findDuplicateRoutes([])).toEqual([]);
    expect(findDuplicateRoutes([entry(1, 1, 'A.ping')])).toEqual([]);
  });

  it('同一 (cmd, subCmd) 重复 → 报出全部来源', () => {
    const duplicates = findDuplicateRoutes([
      entry(1, 1, 'A.ping'),
      entry(1, 1, 'B.ping'),
      entry(1, 1, 'C.ping'),
    ]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.cmd).toBe(1);
    expect(duplicates[0]?.subCmd).toBe(1);
    expect(duplicates[0]?.labels).toEqual(['A.ping', 'B.ping', 'C.ping']);
  });

  it('cmd 相同 subCmd 不同 / subCmd 相同 cmd 不同 → 均不冲突', () => {
    const entries = [
      entry(1, 1, 'A'),
      entry(1, 2, 'B'),
      entry(2, 1, 'C'),
      entry(10, 1, 'D'),
    ];
    expect(findDuplicateRoutes(entries)).toEqual([]);
  });

  it('多组冲突同时报出，且顺序稳定', () => {
    const duplicates = findDuplicateRoutes([
      entry(1, 1, 'A'),
      entry(1, 1, 'B'),
      entry(10, 2, 'C'),
      entry(10, 2, 'D'),
    ]);
    expect(duplicates.map((d) => [d.cmd, d.subCmd])).toEqual([
      [1, 1],
      [10, 2],
    ]);
  });

  it('cmd=0 / subCmd=0 也参与唯一性判定', () => {
    expect(findDuplicateRoutes([entry(0, 0, 'A'), entry(0, 0, 'B')])).toHaveLength(1);
    expect(findDuplicateRoutes([entry(0, 0, 'A'), entry(0, 1, 'B')])).toEqual([]);
  });
});

describe('assertNoDuplicateRoutes', () => {
  it('无冲突 → 不抛错', () => {
    expect(() => assertNoDuplicateRoutes([entry(1, 1, 'A'), entry(1, 2, 'B')])).not.toThrow();
  });

  it('有冲突 → throw 且信息含 cmd/subCmd 与两个来源', () => {
    expect(() =>
      assertNoDuplicateRoutes([entry(30, 5, 'WorldAction.tick'), entry(30, 5, 'BattleAction.tick')]),
    ).toThrowError(/cmd=30 subCmd=5.*WorldAction\.tick.*BattleAction\.tick/);
  });
});

describe('免鉴权白名单漂移断言', () => {
  const publicRoutes: RouteEntry[] = [...PUBLIC_ACTION_KEYS].map((key, index) => ({
    cmd: key >>> 16,
    subCmd: key & 0xffff,
    label: `Public${index}`,
  }));

  it('协议白名单全部已注册 → 无缺失、不抛错', () => {
    expect(findUnregisteredPublicActions(publicRoutes)).toEqual([]);
    expect(() => assertPublicActionsRegistered(publicRoutes)).not.toThrow();
  });

  it('白名单路由漏注册 → 报出缺失的路由键', () => {
    const missingOne = publicRoutes.slice(1);
    const missing = findUnregisteredPublicActions(missingOne);
    expect(missing).toEqual([cmdMerge(publicRoutes[0]?.cmd ?? 0, publicRoutes[0]?.subCmd ?? 0)]);
    expect(() => assertPublicActionsRegistered(missingOne)).toThrowError(/未注册路由/);
  });
});
