/**
 * 刷怪池「可战性」门禁（W8 修正后的回归护栏）。
 *
 * 背景（真实缺陷）：新地图最初**只按 `level` 字段选怪**，把两个 1 级特例塞进了 `world.1`：
 * - `kobold.candle`（`camp:'neutral'` + `onPress` 机关，hp10 / **atk100**）——一刀秒人；
 * - `chapter3.murloc.army`（`camp:'neutral'`，hp1000）——中立坦克。
 *
 * 本引擎里阵营关系决定「能否自动索敌 / 能否被攻击」（`combat/camps.ts`）：
 * - `CampRelation.player.enemy = 'hate'` → 自动索敌（野怪）；
 * - `CampRelation.player.neutral = true` → 可攻击但**不会自动选中**；
 * - `CampRelation.player.alien` **不存在** → 玩家**根本无法攻击**（`chapter3.fishzilla.magician` 即为 alien）。
 *
 * 因此普通刷怪池与守关 BOSS **必须**是 `camp:'enemy'` 且非 `onPress` 机关；
 * 否则挂机会卡住波次（中立不被自动打）或直接无法通关（alien 不可攻击）。
 */
import { describe, expect, it } from 'vitest';

import type { MapData } from '../contracts/data.js';
import { createDefaultTables } from './index.js';

const tables = createDefaultTables();

/** 所有「有怪」的地图（含混沌图；`home` 无怪自动跳过）。 */
const combatMaps: Array<[string, MapData]> = Object.entries(tables.maps).filter(
  ([, map]) => (map.monsters ?? []).length > 0,
);

describe('刷怪池可战性门禁', () => {
  it('至少覆盖 13 张野外图 + 16 张混沌图（防止门禁空跑）', () => {
    expect(combatMaps.length).toBeGreaterThanOrEqual(29);
  });

  it('普通刷怪池全部是 camp=enemy 且非机关（可自动索敌、可被攻击）', () => {
    for (const [key, map] of combatMaps) {
      for (const spawn of map.monsters ?? []) {
        for (const enemyKey of Object.keys(spawn.types ?? {})) {
          const enemy = tables.enemies[enemyKey];
          expect(enemy, `${key} 引用了不存在的敌人 ${enemyKey}`).toBeDefined();
          expect(enemy!.camp, `${key} 普通怪 ${enemyKey} 的阵营`).toBe('enemy');
          expect(enemy!.onPress, `${key} 普通怪 ${enemyKey} 是 onPress 机关`).toBeUndefined();
        }
      }
    }
  });

  it('守关 BOSS 全部是 camp=enemy 且非机关', () => {
    for (const [key, map] of combatMaps) {
      if (!map.boss) continue;
      const boss = tables.enemies[map.boss];
      expect(boss, `${key} 的 boss ${map.boss} 不存在`).toBeDefined();
      expect(boss!.camp, `${key} BOSS ${map.boss} 的阵营`).toBe('enemy');
      expect(boss!.onPress, `${key} BOSS ${map.boss} 是 onPress 机关`).toBeUndefined();
    }
  });

  it('回归：world.1（段首，1 级）不得再用机关/中立特例，且 BOSS 必须是低数值怪', () => {
    const world1 = tables.maps['world.1'];
    expect(world1).toBeDefined();
    const normalKeys = (world1!.monsters ?? []).flatMap((spawn) => Object.keys(spawn.types ?? {}));
    expect(normalKeys).not.toContain('kobold.candle');
    expect(normalKeys).not.toContain('chapter3.murloc.army');
    // 段 0~5 的 BOSS 数值必须与玩家同段战力相称（原缺陷为 hp1000/atk15 的史莱姆王后）。
    const boss = tables.enemies[world1!.boss ?? ''];
    expect(boss, `world.1 boss=${world1!.boss}`).toBeDefined();
    expect(boss!.maxHp, 'world.1 BOSS 血量过高（会卡死解锁链）').toBeLessThanOrEqual(200);
    expect(boss!.atk, 'world.1 BOSS 攻击过高').toBeLessThanOrEqual(5);
  });

  it('回归：不得再把 alien（无法攻击）或 neutral（不自动索敌）当普通怪', () => {
    const offenders: string[] = [];
    for (const [key, map] of combatMaps) {
      for (const spawn of map.monsters ?? []) {
        for (const enemyKey of Object.keys(spawn.types ?? {})) {
          const camp = tables.enemies[enemyKey]?.camp;
          if (camp === 'alien' || camp === 'neutral') offenders.push(`${key} → ${enemyKey} (${camp})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('守关 BOSS 的 HP 不低于本图任一普通怪（防止守关者比杂兵弱）', () => {
    for (const [key, map] of combatMaps) {
      if (!map.boss) continue;
      const bossHp = tables.enemies[map.boss]!.maxHp ?? 0;
      for (const spawn of map.monsters ?? []) {
        for (const enemyKey of Object.keys(spawn.types ?? {})) {
          const hp = tables.enemies[enemyKey]!.maxHp ?? 0;
          expect(
            hp,
            `${key}: 普通怪 ${enemyKey} hp=${hp} > BOSS ${map.boss} hp=${bossHp}`,
          ).toBeLessThanOrEqual(bossHp);
        }
      }
    }
  });
});
