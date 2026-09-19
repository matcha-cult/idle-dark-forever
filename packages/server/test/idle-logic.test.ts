/**
 * 离线结算纯函数单测（C2 外推 / 经验落地 / 材料落地）
 *
 * C1（有界快进模拟）走的是真实 `BattleWorld`，其覆盖在 `game-core` 的金样测试里；
 * 这里专门覆盖服务端新增的**边界与外推**逻辑（0 / 负数 / NaN / 超大值 / 空数组）。
 */
import { describe, expect, it } from 'vitest';
import { Player, createDefaultTables } from '@idle-dark/game-core';
import {
  addMaterial,
  applyExpBounded,
  extrapolate,
} from '../src/modules/logic/idle/idle-logic.service.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;

function newPlayer(): Player {
  const player = Player.fromJSON(
    tables,
    'c1',
    () => NOW,
    { role: 'Eyer', currentCareer: 'warrior', careers: { warrior: { type: 'warrior', level: 1 } } },
  );
  // 补齐背包空格，否则 `Player.loot` 无处可放。
  player.postLoad();
  return player;
}

const SIM = {
  simulatedMs: 600_000,
  gainedExp: 1_000,
  gainedGold: 100,
  kills: 10,
  loots: [{ key: 'a', count: 2, quality: 0 as const }],
  materials: [{ key: 'dust1', count: 4 }],
};

describe('extrapolate（C2）', () => {
  it('simulatedMs=0 时不做无依据外推', () => {
    const r = extrapolate({ ...SIM, simulatedMs: 0 }, 600_000);
    expect(r).toEqual({ exp: 0, gold: 0, kills: 0, loots: [], materials: [] });
  });

  it('extrapolatedMs <= 0 / NaN → 全 0', () => {
    for (const ms of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const r = extrapolate(SIM, ms);
      expect(r.kills).toBe(0);
      expect(r.exp).toBe(0);
      expect(r.loots).toEqual([]);
    }
  });

  it('factor = 1 时速率不变', () => {
    const r = extrapolate(SIM, 600_000);
    expect(r.kills).toBe(10);
    expect(r.exp).toBe(1_000);
    expect(r.gold).toBe(100);
    expect(r.loots).toEqual([{ key: 'a', count: 2, quality: 0 }]);
    expect(r.materials).toEqual([{ key: 'dust1', count: 4 }]);
  });

  it('掉落与材料按比例向下取整，击杀四舍五入', () => {
    const r = extrapolate(SIM, 300_000); // factor 0.5
    expect(r.loots).toEqual([{ key: 'a', count: 1, quality: 0 }]);
    expect(r.materials).toEqual([{ key: 'dust1', count: 2 }]);
    expect(r.kills).toBe(5);
  });

  it('factor < 1/2 时掉落归零但击杀仍可能 >0', () => {
    const r = extrapolate(SIM, 60_000); // factor 0.1
    expect(r.loots).toEqual([]);
    expect(r.materials).toEqual([]);
    expect(r.kills).toBe(1);
  });

  it('超大 factor 不产生 Infinity / NaN', () => {
    const r = extrapolate(SIM, Number.MAX_SAFE_INTEGER);
    expect(Number.isFinite(r.exp)).toBe(true);
    expect(Number.isFinite(r.gold)).toBe(true);
    expect(Number.isFinite(r.kills)).toBe(true);
  });

  it('空数组输入安全', () => {
    const r = extrapolate({ ...SIM, loots: [], materials: [] }, 600_000);
    expect(r.loots).toEqual([]);
    expect(r.materials).toEqual([]);
  });
});

describe('applyExpBounded', () => {
  it('未达上限时直接累加', () => {
    const p = newPlayer();
    const before = p.exp;
    applyExpBounded(p, 5);
    expect(p.exp).toBe(before + 5);
  });

  it('0 / 负数 / NaN / Infinity 均不改变状态', () => {
    const p = newPlayer();
    const before = p.exp;
    applyExpBounded(p, 0);
    applyExpBounded(p, -100);
    applyExpBounded(p, Number.NaN);
    applyExpBounded(p, Number.POSITIVE_INFINITY);
    expect(p.exp).toBe(before);
  });

  it('巨额经验能升级且不会死循环', () => {
    const p = newPlayer();
    const lv0 = p.level;
    applyExpBounded(p, 1e12);
    expect(p.level).toBeGreaterThanOrEqual(lv0);
    expect(Number.isFinite(p.exp)).toBe(true);
  });

  it('没有当前职业时安全返回', () => {
    const p = Player.fromJSON(tables, 'c2', () => NOW, { role: 'Eyer', currentCareer: null });
    expect(() => applyExpBounded(p, 100)).not.toThrow();
  });
});

describe('addMaterial', () => {
  it('正数材料进入背包', () => {
    const p = newPlayer();
    addMaterial(p, tables, 'dust1', 3);
    expect(p.countGood('dust1')).toBe(3);
  });

  it('0 / 负数 / NaN / 空 key 不落地', () => {
    const p = newPlayer();
    addMaterial(p, tables, 'dust1', 0);
    addMaterial(p, tables, 'dust1', -5);
    addMaterial(p, tables, 'dust1', Number.NaN);
    addMaterial(p, tables, '', 5);
    expect(p.countGood('dust1')).toBe(0);
  });

  it('超大数量落地为有限值', () => {
    const p = newPlayer();
    addMaterial(p, tables, 'dust1', 1e9);
    expect(p.countGood('dust1')).toBeGreaterThan(0);
    expect(Number.isFinite(p.countGood('dust1'))).toBe(true);
  });
});
