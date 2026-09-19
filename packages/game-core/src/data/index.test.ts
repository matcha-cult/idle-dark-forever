/**
 * 数据表移植的自检。
 *
 * 关注点：
 *  1. 表非空、关键 key 存在（防止「移植成空壳」）；
 *  2. `goods` 中装备的 `position` / `class` 落在合法枚举内；
 *  3. `careers.expFormula` 是纯数字数组；
 *  4. `data/packages/*` 的显式注册（nightmare / year2018）真的生效；
 *  5. `createDefaultTables()` 可重入——`year2018/redbag.js` 的「全表追加红包」不会累加；
 *  6. 函数型规则被保留，且 `AffixData.generate` / `LegendData.generate` 走**注入的** `Rng`
 *     而不是裸 `Math.random()`。
 */

import { describe, expect, it } from 'vitest';

import type { DataTables } from '../contracts/data.js';
import type { Rng } from '../contracts/ports.js';
import { createDefaultTables } from './index.js';

const tables: DataTables = createDefaultTables();
const tables2: DataTables = createDefaultTables();

/** 只用于验证「随机来自注入端口」的探针。 */
class CountingRng implements Rng {
  calls = 0;
  constructor(private readonly value = 0.5) {}
  next(): number {
    this.calls += 1;
    return this.value;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  fork(): Rng {
    return this;
  }
  getSeed(): number {
    return 1;
  }
}

const TABLE_NAMES = [
  'careers',
  'roles',
  'maps',
  'enemies',
  'skills',
  'goods',
  'passives',
  'enhances',
  'buffs',
  'affixes',
  'enemyAffixes',
  'stories',
  'legends',
  'medicines',
] as const;

describe('createDefaultTables', () => {
  it('每张表都非空', () => {
    for (const name of TABLE_NAMES) {
      expect(Object.keys(tables[name]).length, name).toBeGreaterThan(0);
    }
    expect(tables.upgrades.bankByDiamonds.length).toBeGreaterThan(0);
    expect(tables.upgrades.inventoryByDiamonds.length).toBeGreaterThan(0);
    expect(tables.upgrades.inventory.length).toBeGreaterThan(0);
    expect(tables.announcement.version).toMatch(/^\d/);
  });

  it('关键 key 存在', () => {
    expect(tables.careers['warrior']?.name).toBe('战士');
    expect(tables.roles['Eyer']?.defaultCareer).toBe('warrior');
    expect(tables.maps['home']).toBeDefined();
    expect(tables.enemies['slime.minimal']).toBeDefined();
    expect(tables.skills['melee']).toBeDefined();
    expect(tables.goods['wood']).toBeDefined();
    expect(tables.passives['atkByStr']).toBeDefined();
    expect(tables.enhances['weaponMastery']).toBeDefined();
    expect(tables.buffs['manaShield']).toBeDefined();
    expect(tables.affixes['maxHp']).toBeDefined();
    expect(tables.enemyAffixes['stronger']).toBeDefined();
    expect(tables.stories['chapter3-7']).toBeDefined();
    expect(tables.legends['copperRing-1']).toBeDefined();
    expect(tables.medicines['mainPoint']).toBeDefined();
  });

  it('表条目的 key 与索引一致', () => {
    for (const name of TABLE_NAMES) {
      for (const [k, v] of Object.entries(tables[name])) {
        expect(v.key, `${name}.${k}`).toBe(k);
      }
    }
  });

  it('careers.expFormula 是数字数组', () => {
    for (const [key, career] of Object.entries(tables.careers)) {
      expect(Array.isArray(career.expFormula), key).toBe(true);
      expect(career.expFormula.length, key).toBeGreaterThan(0);
      for (const coef of career.expFormula) {
        expect(typeof coef, `${key} 系数`).toBe('number');
        expect(Number.isFinite(coef), `${key} 系数`).toBe(true);
      }
    }
  });

  it('goods 里 type=equip 的 position / class 合法', () => {
    const positions = new Set(['weapon', 'plastron', 'gaiter', 'ornament']);
    const classes = new Set(['armor', 'cloth', 'dagger', 'ornament', 'sword', 'wand']);
    let equips = 0;
    for (const [key, good] of Object.entries(tables.goods)) {
      if (good.type !== 'equip') continue;
      equips += 1;
      expect(good.position, key).toBeDefined();
      expect(positions.has(good.position ?? ''), `${key} position=${good.position}`).toBe(true);
      expect(good.class, key).toBeDefined();
      expect(classes.has(good.class ?? ''), `${key} class=${good.class}`).toBe(true);
      expect(typeof good.minLevel, key).toBe('number');
    }
    expect(equips).toBeGreaterThan(0);
  });
});

describe('data/packages 显式注册', () => {
  it('nightmare 追加了表项', () => {
    expect(tables.maps['nightmare.slime']).toBeDefined();
    expect(tables.enemies['nightmare.wolf.king']).toBeDefined();
    expect(tables.skills['nightmare.fire.kakarif.1']).toBeDefined();
    expect(tables.buffs['bossState']).toBeDefined();
  });

  it('nightmare 的 extend 保留了「基于原技能做 BOSS 阶段包装」的函数式改写', () => {
    const base = tables.skills['wolf.call'];
    const extended = tables.skills['nightmare.wolf.1'];
    expect(base).toBeDefined();
    expect(extended).toBeDefined();
    expect(extended).not.toBe(base);
    expect(extended.coolDown).toBe(30000);
    expect(extended.notBreakable).toBe(true);
    // canUse / effect 是从 origin 组合出来的新函数，不是原函数
    expect(typeof extended.canUse).toBe('function');
    expect(extended.canUse).not.toBe(base.canUse);
  });

  it('year2018 注册了红包 / 传奇 / 活动副本', () => {
    expect(tables.goods['year2018.redbag']).toBeDefined();
    expect(tables.legends['year2018.yearBeastWeapon-1']).toBeDefined();
    expect(tables.maps['year2018.dungeon']).toBeDefined();
  });

  it('红包掉落被追加到注册时已存在的所有 enemies / maps（活动副本除外）', () => {
    const hasRedbag = (loots: unknown): boolean =>
      Array.isArray(loots) && loots.some((l) => (l as { key?: string }).key === 'year2018.redbag');

    for (const [key, enemy] of Object.entries(tables.enemies)) {
      if (!enemy.loots) continue;
      expect(hasRedbag(enemy.loots), `enemies.${key}`).toBe(true);
    }
    for (const [key, map] of Object.entries(tables.maps)) {
      if (!map.loots) continue;
      // `year2018.dungeon` 在 redbag 之后才注册（原版注释：活动副本不掉落红包）。
      if (key === 'year2018.dungeon') continue;
      expect(hasRedbag(map.loots), `maps.${key}`).toBe(true);
    }
    // 活动副本自己不掉红包（原版注释：活动副本不掉落红包）
    expect(hasRedbag(tables.maps['year2018.dungeon']?.loots)).toBe(false);
  });

  it('createDefaultTables() 可重入：红包不会在多次调用间累加', () => {
    const countRedbag = (t: DataTables): number => {
      let n = 0;
      for (const map of Object.values(t.maps)) {
        n += (map.loots ?? []).filter((l) => (l as { key?: string }).key === 'year2018.redbag').length;
      }
      return n;
    };
    expect(countRedbag(tables)).toBe(countRedbag(tables2));
    expect(countRedbag(createDefaultTables())).toBe(countRedbag(tables));
  });
});

describe('函数型规则', () => {
  it('词缀 / 传奇的 generate 使用注入的 Rng（无裸 Math.random）', () => {
    const rng = new CountingRng(0.5);
    const rolled = tables.affixes['maxHp']?.generate(10, rng);
    expect(rng.calls).toBeGreaterThan(0);
    expect(typeof rolled).toBe('number');
    expect(Number.isFinite(rolled)).toBe(true);

    // 相同 rng 序列 → 相同结果（可重放）
    const again = tables.affixes['maxHp']?.generate(10, new CountingRng(0.5));
    expect(again).toBe(rolled);

    // 不同 rng 取值 → 不同结果（确实用了注入值，而不是常数/全局随机）
    const other = tables.affixes['maxHp']?.generate(10, new CountingRng(0.1));
    expect(other).not.toBe(rolled);
  });

  it('传奇 generate 也接受注入 Rng', () => {
    const rng = new CountingRng(0.5);
    const value = tables.legends['copperRing-1']?.generate(10, rng);
    expect(typeof value).toBe('number');
  });

  it('保留 hooks / effect / canUse 等规则函数', () => {
    expect(typeof tables.goods['wood']).toBe('object');
    expect(typeof tables.skills['melee']?.effect).toBe('function');
    expect(typeof tables.skills['melee']?.canUse).toBe('function');
    expect(typeof tables.buffs['cold']?.hooks?.['speedRateMul']).toBe('function');
    expect(typeof tables.affixes['maxHp']?.hooks?.['maxHp']).toBe('function');
    expect(typeof tables.enemies['slime.minimal']?.skills).toBe('object');
    expect(typeof tables.maps['home']?.name).toBe('string');
  });

  it('medicines 的 hook 通过 this 读单位属性', () => {
    const hook = tables.medicines['recovery']?.hooks['hpRecovery'];
    expect(typeof hook).toBe('function');
    expect(hook?.call({ maxHp: 1000 }, 10, 0)).toBeCloseTo(20);
  });

  it('词缀范围展示函数返回可读文本', () => {
    const range = tables.affixes['maxHp']?.range;
    expect(typeof range).toBe('function');
    expect(String(range?.(10))).toContain('~');
  });
});

describe('边界与异常输入', () => {
  it('空 / 缺省参数下不抛异常（保持原版容错）', () => {
    const rng = new CountingRng();
    for (const level of [0, -1, 1, 1_000_000]) {
      expect(() => tables.affixes['maxHp']?.generate(level, rng)).not.toThrow();
    }
  });

  it('未知 key 返回 undefined 而不是抛错', () => {
    expect(tables.enemies['no.such.enemy']).toBeUndefined();
    expect(tables.maps['no.such.map']).toBeUndefined();
    expect(tables.goods['no.such.good']).toBeUndefined();
  });
});
