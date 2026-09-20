/**
 * W6 混沌仪地图数据单测（§1 R3 / §2.1 Q5）。
 *
 * 断言：恰好 16 张 `chaos.t01..t16`；等级 = 84 + T；`chaos` 标记正确；
 * 每张图有 BOSS 与合法刷怪表；不混入野外 `world.` 命名空间。
 */
import { describe, expect, it } from 'vitest';

import type { DataTables } from '../contracts/data.js';
import { createDefaultTables } from './index.js';
import { chaosLevelOfTier, chaosMapKeyOfTier } from '../rules/chaos.js';

const tables: DataTables = createDefaultTables();
const chaosMaps = Object.entries(tables.maps).filter(([key]) => key.startsWith('chaos.'));
const worldMaps = Object.keys(tables.maps).filter((key) => key.startsWith('world.'));

describe('maps-chaos 混沌仪地图种子', () => {
  it('恰好 16 张，key = chaos.t01..t16', () => {
    expect(chaosMaps).toHaveLength(16);
    for (let tier = 1; tier <= 16; tier += 1) {
      expect(tables.maps[chaosMapKeyOfTier(tier)!]).toBeDefined();
    }
    expect(worldMaps).toHaveLength(13);
  });

  it('每张图：等级 = 84 + T、chaos = T、名字含 T 阶', () => {
    for (const [key, map] of chaosMaps) {
      const tier = Number(key.slice('chaos.t'.length));
      expect(Number.isInteger(tier)).toBe(true);
      expect(map.level).toBe(chaosLevelOfTier(tier));
      expect(map.level).toBe(84 + tier);
      expect(map.chaos).toBe(tier);
      expect(typeof map.name).toBe('string');
      expect(map.name).toContain(`T${tier}`);
    }
  });

  it('每张图有 BOSS 且是已知敌人；刷怪 types 全部已知、total 为正', () => {
    for (const [key, map] of chaosMaps) {
      expect(typeof map.boss, key).toBe('string');
      expect(tables.enemies[map.boss!], `${key} boss=${map.boss}`).toBeDefined();
      const monsters = map.monsters ?? [];
      expect(monsters.length, key).toBeGreaterThanOrEqual(1);
      for (const spawn of monsters) {
        // W12：每波 4 只、同屏上限 4 只（含 BOSS 与召唤物）。
        expect(spawn.total, `${key} total`).toBe(4);
        expect(spawn.max, `${key} max`).toBe(4);
        const types = spawn.types ?? {};
        expect(Object.keys(types).length, key).toBeGreaterThan(0);
        for (const [enemyKey, weight] of Object.entries(types)) {
          expect(tables.enemies[enemyKey], `${key} → ${enemyKey}`).toBeDefined();
          expect(weight, `${key} → ${enemyKey}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('混沌图不写 requirement（只能由混沌仪进入，不参与野外解锁链）', () => {
    for (const [key, map] of chaosMaps) {
      expect(map.requirement, key).toBeUndefined();
    }
  });
});
