import { describe, expect, it } from 'vitest';

import {
  AUTH_CMD,
  BANK_CMD,
  BATTLE_CMD,
  CAREER_CMD,
  CMD_SEGMENTS,
  DUNGEON_CMD,
  IDLE_CMD,
  INVENTORY_CMD,
  LOOTRULE_CMD,
  MAP_CMD,
  PLAYER_CMD,
  PRODUCE_CMD,
  PUBLIC_ACTION_KEYS,
  SHOP_CMD,
  STORY_CMD,
  SYSTEM_CMD,
  WORLD_CMD,
  cmdMerge,
} from './cmd.js';

/** 所有域 cmd 表，集中做结构断言。 */
const DOMAIN_CMDS = {
  SYSTEM_CMD,
  AUTH_CMD,
  PLAYER_CMD,
  WORLD_CMD,
  BATTLE_CMD,
  INVENTORY_CMD,
  BANK_CMD,
  LOOTRULE_CMD,
  CAREER_CMD,
  PRODUCE_CMD,
  STORY_CMD,
  SHOP_CMD,
  IDLE_CMD,
  MAP_CMD,
  DUNGEON_CMD,
} as const;

describe('cmd 段规划', () => {
  it('每个域各占一个段，且段值互不相同', () => {
    const segs = Object.values(CMD_SEGMENTS);
    expect(new Set(segs).size).toBe(segs.length);
  });

  it('段值均为正整数', () => {
    for (const seg of Object.values(CMD_SEGMENTS)) {
      expect(Number.isInteger(seg)).toBe(true);
      expect(seg).toBeGreaterThan(0);
    }
  });

  it('每个域表的 cmd 与其所属段一致', () => {
    expect(SYSTEM_CMD.cmd).toBe(CMD_SEGMENTS.system);
    expect(AUTH_CMD.cmd).toBe(CMD_SEGMENTS.auth);
    expect(PLAYER_CMD.cmd).toBe(CMD_SEGMENTS.player);
    expect(WORLD_CMD.cmd).toBe(CMD_SEGMENTS.world);
    expect(BATTLE_CMD.cmd).toBe(CMD_SEGMENTS.battle);
    expect(INVENTORY_CMD.cmd).toBe(CMD_SEGMENTS.inventory);
    expect(BANK_CMD.cmd).toBe(CMD_SEGMENTS.bank);
    expect(LOOTRULE_CMD.cmd).toBe(CMD_SEGMENTS.lootrule);
    expect(CAREER_CMD.cmd).toBe(CMD_SEGMENTS.career);
    expect(PRODUCE_CMD.cmd).toBe(CMD_SEGMENTS.produce);
    expect(STORY_CMD.cmd).toBe(CMD_SEGMENTS.story);
    expect(SHOP_CMD.cmd).toBe(CMD_SEGMENTS.shop);
    expect(IDLE_CMD.cmd).toBe(CMD_SEGMENTS.idle);
    expect(MAP_CMD.cmd).toBe(CMD_SEGMENTS.map);
    expect(DUNGEON_CMD.cmd).toBe(CMD_SEGMENTS.dungeon);
  });

  it('段内 subCmd 从 1 起、互不重复、且不越过段宽（< cmd + 10）', () => {
    for (const [name, table] of Object.entries(DOMAIN_CMDS)) {
      const subs = Object.entries(table)
        .filter(([key]) => key !== 'cmd')
        .map(([, value]) => value as number);

      expect(subs.length, `${name} 至少有 1 个 subCmd`).toBeGreaterThan(0);
      expect(new Set(subs).size, `${name} 的 subCmd 不得重复`).toBe(subs.length);
      for (const sub of subs) {
        // 0 保留：不得使用
        expect(sub, `${name} 的 subCmd 必须 >= 1`).toBeGreaterThanOrEqual(1);
        // 段宽 10：subCmd 必须落在本段内
        expect(sub, `${name} 的 subCmd 必须 < 10（段宽约定）`).toBeLessThan(10);
        expect(Number.isInteger(sub)).toBe(true);
      }
    }
  });

  it('全部 (cmd, subCmd) 组合全局唯一（防止跨域路由冲突）', () => {
    const keys: number[] = [];
    for (const table of Object.values(DOMAIN_CMDS)) {
      for (const [key, value] of Object.entries(table)) {
        if (key === 'cmd') continue;
        keys.push(cmdMerge(table.cmd, value as number));
      }
    }
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('cmdMerge', () => {
  it('按 (cmd << 16) | subCmd 打包', () => {
    expect(cmdMerge(1, 1)).toBe(0x00010001);
    expect(cmdMerge(120, 9)).toBe((120 << 16) | 9);
  });

  it('边界：cmd=0 / subCmd=0 不抛错', () => {
    expect(cmdMerge(0, 0)).toBe(0);
    expect(cmdMerge(0, 5)).toBe(5);
    expect(cmdMerge(5, 0)).toBe(5 << 16);
  });

  it('不同 (cmd, subCmd) 不会碰撞（在段宽约定内）', () => {
    const seen = new Set<number>();
    for (let cmd = 1; cmd <= 200; cmd += 1) {
      for (let sub = 1; sub < 10; sub += 1) {
        const key = cmdMerge(cmd, sub);
        expect(seen.has(key), `碰撞于 cmd=${cmd} sub=${sub}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('负数 subCmd 不产生与合法组合的碰撞（防御性）', () => {
    // 负 subCmd 属于非法输入，但不应静默等价于某个合法组合
    expect(cmdMerge(1, -1)).not.toBe(cmdMerge(1, 1));
  });
});

describe('免鉴权白名单', () => {
  it('只包含 system.ping / system.version / auth.login', () => {
    expect(PUBLIC_ACTION_KEYS.size).toBe(3);
    expect(PUBLIC_ACTION_KEYS.has(cmdMerge(SYSTEM_CMD.cmd, SYSTEM_CMD.ping))).toBe(true);
    expect(PUBLIC_ACTION_KEYS.has(cmdMerge(SYSTEM_CMD.cmd, SYSTEM_CMD.version))).toBe(true);
    expect(PUBLIC_ACTION_KEYS.has(cmdMerge(AUTH_CMD.cmd, AUTH_CMD.login))).toBe(true);
  });

  it('不包含任何需要鉴权的 Action', () => {
    for (const key of [
      [PLAYER_CMD.cmd, PLAYER_CMD.list],
      [WORLD_CMD.cmd, WORLD_CMD.snapshot],
      [INVENTORY_CMD.cmd, INVENTORY_CMD.list],
    ] as const) {
      expect(PUBLIC_ACTION_KEYS.has(cmdMerge(key[0], key[1]))).toBe(false);
    }
  });
});
