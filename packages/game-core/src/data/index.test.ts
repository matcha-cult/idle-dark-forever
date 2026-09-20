/**
 * 数据表移植的自检。
 *
 * 关注点：
 *  1. 表非空、关键 key 存在（防止「移植成空壳」）；
 *  2. `goods` 中装备的 `position` / `class` 落在合法枚举内；
 *  3. `careers.expFormula` 是纯数字数组；
 *  4. `data/packages/*` 的显式注册（nightmare / year2018）真的生效；
 *  5. `createDefaultTables()` 可重入——`year2018/redbag.js` 的「全表追加红包」不会累加；
 *  6. 函数型规则被保留，且随机**全部**走注入的 `Rng` 端口：
 *     `generate` 用形参 `rng`，技能 / buff / 强化 / 传奇 hook 用 `world.rng.skill`
 *     （无法从参数拿到 world 的两处用 `this.world` / `this.unit.world`）；
 *  7. 数据层**零** `Math.random()`——用函数源码扫描把它钉死，防止回归。
 */

import { describe, expect, it } from 'vitest';

import type { DataTables } from '../contracts/data.js';
import type { Rng } from '../contracts/ports.js';
import { createDefaultTables } from './index.js';

const tables: DataTables = createDefaultTables();
const tables2: DataTables = createDefaultTables();

/**
 * 可重放的确定性随机源（LCG）。
 * 只用于验证「同一 seed 两次运行产出相同结果」，与生产实现无关。
 */
class SeededRng implements Rng {
  calls = 0;
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.calls += 1;
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  fork(label: string): Rng {
    void label;
    return new SeededRng(this.state);
  }
  getSeed(): number {
    return this.state;
  }
}

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

  it('每条装备词缀都标注 affixType + tag，且同一 tag 只归属前缀或后缀之一（P5 预分类）', () => {
    const tagKind = new Map<string, string>();
    const keys = Object.keys(tables.affixes);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const affix = tables.affixes[key]!;
      expect(affix.affixType, key).toMatch(/^(prefix|suffix)$/);
      expect(typeof affix.tag, key).toBe('string');
      expect((affix.tag ?? '').length, key).toBeGreaterThan(0);
      const prev = tagKind.get(affix.tag!);
      if (prev !== undefined) {
        expect(prev, `tag ${affix.tag} 跨越前后缀`).toBe(affix.affixType);
      }
      tagKind.set(affix.tag!, affix.affixType!);
    }
    // 两侧都要有词缀，否则分池抽取永远抽不到某一侧。
    expect(keys.some((key) => tables.affixes[key]!.affixType === 'prefix')).toBe(true);
    expect(keys.some((key) => tables.affixes[key]!.affixType === 'suffix')).toBe(true);
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

/**
 * 只搭 `skills['melee'].effect` 需要的最小 world / self。
 * `DataTables` 里 `effect` 的 `world` / `self` 是 `unknown`，所以这里传结构体即可。
 */
function makeMeleeHarness(rng: Rng): { damage: number[]; run: () => void } {
  const damage: number[] = [];
  const target = {
    rp: 0,
    rpOnAttacked: 1,
    runAttrHooks: () => 0,
  };
  const self = {
    target,
    atk: 100,
    rp: 0,
    rpOnAttack: 1,
    testCrit: () => false,
    getCritBonus: () => 1,
  };
  const world = {
    rng: { skill: rng },
    testDodge: () => false,
    sendDamage: (_type: string, _from: unknown, _to: unknown, _skill: unknown, value: number) => {
      damage.push(value);
    },
  };
  return {
    damage,
    run: () => {
      tables.skills['melee']?.effect.call({}, world, self, 1);
    },
  };
}

describe('随机源端口化（world.rng.skill）', () => {
  it('数据层函数源码里不含裸 Math.random（源码扫描护栏）', () => {
    const found: Array<{ path: string; src: string }> = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'function') {
        found.push({ path, src: String(node) });
        return;
      }
      if (node === null || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(tables, '');
    expect(found.length).toBeGreaterThan(600);
    const offenders = found.filter((f) => f.src.includes('Math.random'));
    expect(offenders.map((o) => o.path).join(', ')).toBe('');
  });

  it('技能 effect 走 world.rng.skill：同 seed 同结果、不同 seed 不同结果、且确实消费了该流', () => {
    const rngA = new SeededRng(12345);
    const a = makeMeleeHarness(rngA);
    a.run();

    const rngB = new SeededRng(12345);
    const b = makeMeleeHarness(rngB);
    b.run();

    const rngC = new SeededRng(999);
    const c = makeMeleeHarness(rngC);
    c.run();

    expect(a.damage).toHaveLength(1);
    expect(a.damage).toEqual(b.damage);
    expect(a.damage[0]).not.toBeCloseTo(c.damage[0] ?? Number.NaN, 6);
    // 每次施放恰好消费一次 skill 流
    expect(rngA.calls).toBe(1);
    expect(rngC.calls).toBe(1);
    // 没有 world 时不应静默退化（护栏：world.rng 缺失会抛）
    expect(() => tables.skills['melee']?.effect.call({}, {}, {}, 1)).toThrow();
  });

  it('拿不到 world 形参的传奇 hook 用 this.world.rng.skill', () => {
    const hook = tables.legends['mithrilRing-1']?.hooks?.['holyCombo'];
    expect(typeof hook).toBe('function');

    const hits: string[] = [];
    const makeThis = (value: number) => ({
      world: { rng: { skill: new CountingRng(value) } },
      useExtraSkill: (key: string) => {
        hits.push(key);
      },
    });

    // 0.1 < 0.9 → 触发
    hook?.call(makeThis(0.1), 0.9, 5);
    expect(hits).toEqual(['knight.whirlwind']);
    // 0.95 >= 0.9 → 不触发，但返回值仍是原 count
    expect(hook?.call(makeThis(0.95), 0.9, 5)).toBe(5);
    expect(hits).toHaveLength(1);
  });

  it('拿不到 world 形参的 buff hook 用 this.unit.world.rng.skill', () => {
    const hook = tables.buffs['iceShield']?.hooks?.['attacked'];
    expect(typeof hook).toBe('function');

    const stunned: Array<{ ms: number; type?: string }> = [];
    const from = {
      buffs: [] as Array<{ group?: string }>,
      stun: (ms: number, type?: string) => {
        stunned.push({ ms, type });
        return true;
      },
      addBuff: () => undefined,
    };
    // soCold = true → 走 100% 冻结分支（无需再消费随机）
    const rng = new CountingRng(0.5);
    hook?.call({ unit: { world: { rng: { skill: rng } }, runAttrHooks: () => true } }, from);
    expect(rng.calls).toBe(1);
    expect(stunned).toEqual([{ ms: 3, type: 'freezed' }]);
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
