import { describe, expect, it } from 'vitest';

import {
  asArray,
  asBoolean,
  asCountOrNull,
  asLocked,
  asNumber,
  asNumberOrNull,
  asRecord,
  asString,
  asStringArray,
  asStringOrNull,
  entriesOf,
  getEndlessKeyName,
  getEndlessLevel,
  getEndlessMapLevel,
  PlayerMeta,
  romes,
  transformEquipLevel,
  untransformEquipLevel,
} from './player-meta.js';
import { createTestTables } from './fixtures.test.js';

describe('JSON 兜底 helper', () => {
  it('asRecord：非对象一律得到空对象', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    for (const value of [null, undefined, 1, 'x', true, [], new Map([['a', 1]])]) {
      expect(asRecord(value)).toEqual({});
    }
  });

  it('asArray：非数组一律得到空数组', () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
    for (const value of [null, undefined, 1, 'x', {}]) {
      expect(asArray(value)).toEqual([]);
    }
  });

  it('asNumber：NaN/undefined/null/字符串走 fallback，Infinity 与负数保留', () => {
    expect(asNumber(5, 9)).toBe(5);
    expect(asNumber(0, 9)).toBe(0);
    expect(asNumber(-3, 9)).toBe(-3);
    expect(asNumber(Number.NaN, 9)).toBe(9);
    expect(asNumber(undefined, 9)).toBe(9);
    expect(asNumber(null, 9)).toBe(9);
    expect(asNumber('5', 9)).toBe(9);
    expect(asNumber(Number.POSITIVE_INFINITY, 9)).toBe(Number.POSITIVE_INFINITY);
    expect(asNumber(Number.NEGATIVE_INFINITY, 9)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('asNumberOrNull', () => {
    expect(asNumberOrNull(0)).toBe(0);
    expect(asNumberOrNull(-1)).toBe(-1);
    expect(asNumberOrNull(Number.NaN)).toBeNull();
    expect(asNumberOrNull(undefined)).toBeNull();
    expect(asNumberOrNull('1')).toBeNull();
  });

  it('asString/asStringOrNull：空串走 fallback（对齐原版 `||`）', () => {
    expect(asString('a', 'd')).toBe('a');
    expect(asString('', 'd')).toBe('d');
    expect(asString(5, 'd')).toBe('d');
    expect(asStringOrNull('')).toBeNull();
    expect(asStringOrNull('a')).toBe('a');
    expect(asStringOrNull(null)).toBeNull();
  });

  it('asBoolean', () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean(false, true)).toBe(false);
    expect(asBoolean(undefined, true)).toBe(true);
    expect(asBoolean(0, true)).toBe(true);
    expect(asBoolean('true', true)).toBe(true);
  });

  it('asLocked：布尔保持布尔，数字保持数字，其余 → 0', () => {
    expect(asLocked(true)).toBe(true);
    expect(asLocked(false)).toBe(false);
    expect(asLocked(1)).toBe(1);
    expect(asLocked(0)).toBe(0);
    expect(asLocked(Number.NaN)).toBe(0);
    expect(asLocked(undefined)).toBe(0);
    expect(asLocked('x')).toBe(0);
  });

  it('asCountOrNull：0/NaN/undefined → null；小数向上取整；负数保留', () => {
    expect(asCountOrNull(3)).toBe(3);
    expect(asCountOrNull(2.1)).toBe(3);
    expect(asCountOrNull(-1.2)).toBe(-1);
    expect(asCountOrNull(0)).toBeNull();
    expect(asCountOrNull(Number.NaN)).toBeNull();
    expect(asCountOrNull(undefined)).toBeNull();
    expect(asCountOrNull('3')).toBeNull();
    expect(asCountOrNull(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it('entriesOf：支持 Map / 普通对象 / 数组；其余为空', () => {
    expect(entriesOf(new Map([['a', 1]]))).toEqual([['a', 1]]);
    expect(entriesOf({ a: 1, b: 2 })).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect(entriesOf([9, 8])).toEqual([
      ['0', 9],
      ['1', 8],
    ]);
    expect(entriesOf(null)).toEqual([]);
    expect(entriesOf(3)).toEqual([]);
  });

  it('asStringArray：过滤非字符串项', () => {
    expect(asStringArray(['a', 1, null, 'b'])).toEqual(['a', 'b']);
    expect(asStringArray(undefined)).toEqual([]);
  });
});

describe('等级换算（原样移植）', () => {
  it('transformEquipLevel 分段边界', () => {
    expect(transformEquipLevel(0)).toBe(0);
    expect(transformEquipLevel(1)).toBe(1);
    expect(transformEquipLevel(2)).toBe(1);
    expect(transformEquipLevel(120)).toBe(60);
    expect(transformEquipLevel(121)).toBe(60);
    expect(transformEquipLevel(180)).toBe(60);
    expect(transformEquipLevel(181)).toBe(61);
    expect(transformEquipLevel(210)).toBe(70);
    expect(transformEquipLevel(211)).toBe(70);
    expect(transformEquipLevel(999)).toBe(70);
    expect(transformEquipLevel(Number.NaN)).toBe(70); // NaN <= 120 为 false → 落到最后分支
  });

  it('untransformEquipLevel 分段边界', () => {
    expect(untransformEquipLevel(0)).toBe(0);
    expect(untransformEquipLevel(59)).toBe(118);
    expect(untransformEquipLevel(60)).toBe(180);
    expect(untransformEquipLevel(69)).toBe(207);
    expect(untransformEquipLevel(70)).toBe(250);
    expect(untransformEquipLevel(1000)).toBe(250);
  });

  it('getEndlessLevel 只认 nightmare. 前缀', () => {
    expect(getEndlessLevel('nightmare.3')).toBe(3);
    expect(getEndlessLevel('nightmare.10')).toBe(10);
    expect(getEndlessLevel('nightmare.abc')).toBe(0);
    expect(getEndlessLevel('nightmare.')).toBe(0);
    expect(getEndlessLevel('home')).toBeUndefined();
    expect(getEndlessLevel('')).toBeUndefined();
    expect(getEndlessLevel(null)).toBeUndefined();
    expect(getEndlessLevel(undefined)).toBeUndefined();
    expect(getEndlessLevel(42)).toBeUndefined();
  });

  it('getEndlessKeyName 使用罗马数字，超表则回退阿拉伯数字', () => {
    expect(getEndlessKeyName('nightmare.1')).toBe('无尽噩梦I');
    expect(getEndlessKeyName('nightmare.3')).toBe('无尽噩梦III');
    expect(getEndlessKeyName('nightmare.20')).toBe('无尽噩梦XX');
    expect(getEndlessKeyName('nightmare.21')).toBe('无尽噩梦21');
    expect(getEndlessKeyName('nightmare.0')).toBeUndefined();
    expect(getEndlessKeyName('home')).toBeUndefined();
    expect(romes.length).toBe(21);
  });

  it('getEndlessMapLevel：250 + 35*(level-1)；非无尽得到 NaN（原版语义）', () => {
    expect(getEndlessMapLevel('nightmare.1')).toBe(250);
    expect(getEndlessMapLevel('nightmare.3')).toBe(320);
    expect(Number.isNaN(getEndlessMapLevel('home'))).toBe(true);
    expect(Number.isNaN(getEndlessMapLevel(null))).toBe(true);
  });
});

describe('PlayerMeta', () => {
  it('缺省值与原版一致（role=Eyer，currentCareer=角色默认职业）', () => {
    const tables = createTestTables();
    const meta = new PlayerMeta(tables, 'p1');
    expect(meta.key).toBe('p1');
    expect(meta.role).toBe('Eyer');
    expect(meta.currentCareer).toBeNull();
    expect(meta.currentCareerLevel).toBe(0);

    meta.fromJSON({});
    expect(meta.role).toBe('Eyer');
    expect(meta.currentCareer).toBe('warrior');
  });

  it('fromJSON 读取角色 / 职业 / 等级，并保留显式 currentCareer', () => {
    const tables = createTestTables();
    const meta = new PlayerMeta(tables, 'p1').fromJSON({
      role: 'Eyer',
      currentCareer: 'mage',
      currentCareerLevel: 12,
    });
    expect(meta.currentCareer).toBe('mage');
    expect(meta.currentCareerLevel).toBe(12);
    expect(meta.careerData?.name).toBe('法师');
    expect(meta.careerName).toBe('法师');
    expect(meta.name).toBe('艾尔');
  });

  it('未知 role 时 roleData 为 undefined 且不崩', () => {
    const tables = createTestTables();
    const meta = new PlayerMeta(tables, 'p1').fromJSON({ role: 'nobody' });
    expect(meta.roleData).toBeUndefined();
    expect(meta.name).toBe('');
    expect(meta.careerData).toBeUndefined();
    expect(meta.careerName).toBeUndefined();
  });

  it('fromJSON 容忍非对象入参', () => {
    const tables = createTestTables();
    expect(new PlayerMeta(tables, 'k').fromJSON(null).currentCareer).toBe('warrior');
    expect(new PlayerMeta(tables, 'k').fromJSON(42).role).toBe('Eyer');
  });

  it('toJSON 形状稳定', () => {
    const tables = createTestTables();
    const meta = new PlayerMeta(tables, 'p1').fromJSON({ currentCareer: 'mage' });
    expect(meta.toJSON()).toEqual({
      key: 'p1',
      role: 'Eyer',
      currentCareer: 'mage',
      currentCareerLevel: 0,
    });
  });
});
