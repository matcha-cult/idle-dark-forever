/**
 * 怪物稀有度四阶（W11）单测 —— 纯函数边界 + 与协议文案表的一致性。
 *
 * 钉死四件事：
 * 1. `clampEnemyQuality` 的所有边界（`undefined` / `null` / `NaN` / `±Infinity` / 负 / 小数 / 超大）；
 * 2. 档位映射是**逐级对应**：`quality 0/1/2` → `普通/稀有/精英`（`quality 2` **不得**被归到稀有）；
 * 3. 优先级 `boss(3) > elite(2) > quality`，且脏值一律退化为普通；
 * 4. 档位数与协议 `UNIT_RARITY_NAMES` 一致（防两侧漂移）。
 */
import { describe, expect, it } from 'vitest';

import { UNIT_RARITY_MAX, UNIT_RARITY_NAMES } from '@idle-dark/protocol';

import { ENEMY_RARITY, ENEMY_RARITY_MAX, clampEnemyQuality, enemyRarityOf } from './enemy-rarity.js';

describe('clampEnemyQuality：敌人词缀条数夹到 0..2', () => {
  it('0/1/2 原样通过', () => {
    expect(clampEnemyQuality(0)).toBe(0);
    expect(clampEnemyQuality(1)).toBe(1);
    expect(clampEnemyQuality(2)).toBe(2);
  });

  it('超过 2 一律夹到 2（不能把怪物等级推到天上）', () => {
    for (const v of [3, 4, 99, 1e9, Number.MAX_SAFE_INTEGER]) {
      expect(clampEnemyQuality(v), `quality=${v}`).toBe(2);
    }
  });

  it('非有限 / 非数字 / 缺失 → 0', () => {
    for (const v of [undefined, null, Number.NaN, Infinity, -Infinity, '1', {}, []]) {
      expect(clampEnemyQuality(v as number), `quality=${String(v)}`).toBe(0);
    }
  });

  it('负数与 0 → 0；小数向下取整', () => {
    for (const v of [-1, -0.5, -1e9, 0, 0.4]) {
      expect(clampEnemyQuality(v), `quality=${v}`).toBe(0);
    }
    expect(clampEnemyQuality(1.7)).toBe(1);
    expect(clampEnemyQuality(1.999)).toBe(1);
    expect(clampEnemyQuality(2.5)).toBe(2);
  });
});

describe('enemyRarityOf：四阶档位', () => {
  it('普通 / 稀有 / 精英 逐级对应 quality 0/1/2', () => {
    expect(enemyRarityOf({ quality: 0 })).toBe(ENEMY_RARITY.common);
    expect(enemyRarityOf({ quality: 1 })).toBe(ENEMY_RARITY.rare);
    // ⚠️ 这条是四阶的命门：`quality 2` 是**精英**，不是稀有（自然刷怪 1% 概率也能掷到）。
    expect(enemyRarityOf({ quality: 2 })).toBe(ENEMY_RARITY.elite);
  });

  it('守关 BOSS 恒为传奇，且压过 elite / quality', () => {
    expect(enemyRarityOf({ worldBoss: true })).toBe(ENEMY_RARITY.legendary);
    expect(enemyRarityOf({ worldBoss: true, quality: 0 })).toBe(ENEMY_RARITY.legendary);
    expect(enemyRarityOf({ worldBoss: true, elite: true, quality: 2 })).toBe(
      ENEMY_RARITY.legendary,
    );
  });

  it('精英标记压过 quality（即使 quality 异常）', () => {
    expect(enemyRarityOf({ elite: true, quality: 0 })).toBe(ENEMY_RARITY.elite);
    expect(enemyRarityOf({ elite: true, quality: 1 })).toBe(ENEMY_RARITY.elite);
    expect(enemyRarityOf({ elite: true, quality: Number.NaN })).toBe(ENEMY_RARITY.elite);
    expect(enemyRarityOf({ elite: true })).toBe(ENEMY_RARITY.elite);
  });

  it('脏值 / 缺失一律退化为普通（绝不返回 NaN / 越界值）', () => {
    for (const q of [undefined, null, Number.NaN, Infinity, -Infinity, -1, '2', {}]) {
      const rarity = enemyRarityOf({ quality: q as number });
      expect(rarity, `quality=${String(q)}`).toBe(ENEMY_RARITY.common);
    }
    expect(enemyRarityOf({})).toBe(ENEMY_RARITY.common);
  });

  it('worldBoss / elite 只有**严格等于 true** 才算（`1` / 字符串不算）', () => {
    expect(enemyRarityOf({ worldBoss: 1 as unknown as boolean })).toBe(ENEMY_RARITY.common);
    expect(enemyRarityOf({ elite: 'yes' as unknown as boolean })).toBe(ENEMY_RARITY.common);
  });

  it('产物恒在 0..3 且为整数', () => {
    const samples = [
      {},
      { quality: 0 },
      { quality: 1 },
      { quality: 2 },
      { quality: 99 },
      { elite: true },
      { worldBoss: true },
    ];
    for (const s of samples) {
      const r = enemyRarityOf(s);
      expect(Number.isInteger(r), JSON.stringify(s)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(ENEMY_RARITY_MAX);
    }
  });
});

describe('档位常量与协议文案表一致（防两侧漂移）', () => {
  it('ENEMY_RARITY_MAX + 1 === UNIT_RARITY_NAMES.length === UNIT_RARITY_MAX + 1', () => {
    expect(UNIT_RARITY_NAMES.length).toBe(ENEMY_RARITY_MAX + 1);
    expect(UNIT_RARITY_MAX).toBe(ENEMY_RARITY_MAX);
  });

  it('文案逐字为「普通 / 稀有 / 精英 / 传奇」', () => {
    expect([...UNIT_RARITY_NAMES]).toEqual(['普通', '稀有', '精英', '传奇']);
  });

  it('常量索引与文案索引一一对应', () => {
    expect(UNIT_RARITY_NAMES[ENEMY_RARITY.common]).toBe('普通');
    expect(UNIT_RARITY_NAMES[ENEMY_RARITY.rare]).toBe('稀有');
    expect(UNIT_RARITY_NAMES[ENEMY_RARITY.elite]).toBe('精英');
    expect(UNIT_RARITY_NAMES[ENEMY_RARITY.legendary]).toBe('传奇');
  });
});
