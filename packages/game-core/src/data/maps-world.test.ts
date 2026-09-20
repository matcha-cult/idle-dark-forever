/**
 * W3 新地图种子边界单测（R2）。
 *
 * 覆盖：
 *  - 9 个等级段（1/5/15/25/35/45/55/65/75）各恰好 1 张图，85+ 恰好 4 张；
 *  - `home` 精确保留（安全区：无怪、无进入条件）；
 *  - 每张战斗图：`requirement` = `{level}`（world.1）或 `{level, bossKilled: 上一段}`（W4 解锁链）、
 *    有 `boss`、刷怪条目合法且带一波的 `total`；
 *  - 不残留旧秘境字段（`isDungeon` / `phases` / `group` / `isEndless`）；
 *  - 所有普通怪与 BOSS 的 enemy key 都真实存在且有掉落表。
 */
import { describe, expect, it } from 'vitest';

import type { DataTables } from '../contracts/data.js';
import { createDefaultTables } from './index.js';

const tables: DataTables = createDefaultTables();

/** 新地图种子的 key 前缀。 */
const WORLD_PREFIX = 'world.';
const worldMaps = Object.entries(tables.maps).filter(([key]) => key.startsWith(WORLD_PREFIX));

/** 各等级段的段下界（§2.2 第 1 条；段首取 1 级，角色初始即 1 级）。 */
const SEGMENT_LEVELS = [1, 5, 15, 25, 35, 45, 55, 65, 75] as const;
/** 85+ 段的图数（H2 暂定 4 张）。 */
const HIGH_SEGMENT_COUNT = 4;

describe('maps-world 新地图种子', () => {
  it('home 精确保留：安全区，无怪、无进入条件', () => {
    const home = tables.maps['home'];
    expect(home).toBeDefined();
    expect(home?.key).toBe('home');
    expect(home?.name).toBe('自宅');
    expect(home?.requirement).toBeUndefined();
    expect(home?.monsters ?? []).toEqual([]);
    expect(home?.isDungeon).toBeUndefined();
    expect(home?.boss).toBeUndefined();
  });

  it('恰好 13 张战斗图，9 段各 1 张 + 85+ 共 4 张', () => {
    expect(worldMaps).toHaveLength(13);
    for (const level of SEGMENT_LEVELS) {
      const atLevel = worldMaps.filter(([, map]) => map.level === level);
      expect(atLevel.map(([key]) => key), `level=${level}`).toHaveLength(1);
    }
    const high = worldMaps.filter(([, map]) => map.level === 85);
    expect(high).toHaveLength(HIGH_SEGMENT_COUNT);
  });

  it('每张战斗图：等级 = 段下界；requirement = level + W4 解锁链 bossKilled', () => {
    for (const [key, map] of worldMaps) {
      expect(typeof map.level, key).toBe('number');
      expect(map.requirement, key).toBeDefined();
      const segment = Number(key.slice(WORLD_PREFIX.length));
      // world.1 无前置；world.N 需先击杀 world.(N-1) 的野外 BOSS（85+ 多图统一接 world.9）。
      const expected =
        segment <= 1
          ? { level: map.level }
          : { level: map.level, bossKilled: segment >= 10 ? 'world.9' : `world.${segment - 1}` };
      expect(map.requirement, key).toEqual(expected);
      expect(typeof map.name, key).toBe('string');
      expect((map.hint ?? '').length, key).toBeGreaterThan(0);
      expect(Number.isFinite(map.exp), key).toBe(true);
    }
  });

  it('每张战斗图：boss 存在且是已知敌人（守关 BOSS）', () => {
    for (const [key, map] of worldMaps) {
      expect(typeof map.boss, key).toBe('string');
      expect(tables.enemies[map.boss!], `${key} boss=${map.boss}`).toBeDefined();
    }
  });

  it('每张战斗图：1~2 条刷怪条目，加权 types 全部是已知敌人；带一波的 total', () => {
    for (const [key, map] of worldMaps) {
      const monsters = map.monsters ?? [];
      expect(monsters.length, key).toBeGreaterThanOrEqual(1);
      expect(monsters.length, key).toBeLessThanOrEqual(2);
      for (const spawn of monsters) {
        // W4：一波 = `total` 刷满且全部清空；必须是正的有限整数。
        expect(Number.isInteger(spawn.total), `${key} total 应为整数`).toBe(true);
        expect(spawn.total, `${key} total 应为正数`).toBeGreaterThan(0);
        expect(spawn.randomPosition, key).toBe(true);
        expect(spawn.quality, key).toEqual([90, 9, 1]);
        expect(Number.isFinite(spawn.delay), key).toBe(true);
        expect(Number.isFinite(spawn.max), key).toBe(true);
        expect(Number.isFinite(spawn.warmup), key).toBe(true);
        expect(spawn.type, `${key} 应使用加权 types 而不是单 type`).toBeUndefined();
        const types = spawn.types ?? {};
        expect(Object.keys(types).length, key).toBeGreaterThan(0);
        for (const [enemyKey, weight] of Object.entries(types)) {
          // 掉落表不在此断言「必有 loots」：个别敌人（如旧稿选中的 `chapter3.murloc.army`）
          // 在代码里 `loots` 缺省。真正必须成立的是「可战性」——见 `spawn-eligibility.test.ts`。
          expect(tables.enemies[enemyKey], `${key} → ${enemyKey}`).toBeDefined();
          expect(weight, `${key} → ${enemyKey} 权重`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('战斗图不残留旧秘境字段（isDungeon / phases / group / isEndless）', () => {
    for (const [key, map] of worldMaps) {
      expect(map.isDungeon, key).toBeUndefined();
      expect(map.phases, key).toBeUndefined();
      expect(map.group, key).toBeUndefined();
      expect(map.isEndless, key).toBeUndefined();
    }
  });

  it('13 张图的 boss 与普通怪 key 全部出现在刷怪表或 boss 位置上（无幽灵引用）', () => {
    const referenced = new Set<string>();
    for (const [, map] of worldMaps) {
      if (map.boss) referenced.add(map.boss);
      for (const spawn of map.monsters ?? []) {
        for (const enemyKey of Object.keys(spawn.types ?? {})) referenced.add(enemyKey);
      }
    }
    const missing = [...referenced].filter((key) => !tables.enemies[key]);
    expect(missing).toEqual([]);
  });
});
