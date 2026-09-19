import { describe, expect, it } from 'vitest';

import { CareerInfo } from './career-info.js';
import { createTestTables } from './fixtures.test.js';

const tables = createTestTables();

describe('CareerInfo', () => {
  it('默认值与原版一致', () => {
    const info = new CareerInfo(tables, 'warrior');
    expect(info.type).toBe('warrior');
    expect(info.exp).toBe(0);
    expect(info.level).toBe(1);
    expect(info.peakExp).toBe(0);
    expect(info.peakLevel).toBe(0);
    expect(info.maxLevel).toBe(60);
    expect(info.selectedSkills).toEqual([]);
    expect(info.selectedEnhances).toEqual([]);
    expect(Object.keys(info.equipments)).toEqual(['weapon', 'plastron', 'gaiter', 'ornament']);
    expect(info.equipments.weapon.empty).toBe(true);
    expect(info.equipments.weapon.position).toBe('equip');
  });

  it('maxExp 使用 expFormula 多项式（100 + 10L + L²）', () => {
    const info = new CareerInfo(tables, 'warrior');
    expect(info.maxExp).toBe(100 + 10 * 1 + 1);
    info.level = 3;
    expect(info.maxExp).toBe(100 + 30 + 9);
    info.level = 60;
    expect(info.maxExp).toBe(100 + 600 + 3600);
  });

  it('maxPeakExp 把 peakLevel + 60 代回同一多项式', () => {
    const info = new CareerInfo(tables, 'warrior');
    info.peakLevel = 0;
    expect(info.maxPeakExp).toBe(100 + 10 * 60 + 60 ** 2);
    info.peakLevel = 5;
    expect(info.maxPeakExp).toBe(100 + 10 * 65 + 65 ** 2);
  });

  it('未知职业的 maxExp/maxPeakExp 回退 10000000', () => {
    const info = new CareerInfo(tables, 'nobody');
    expect(info.maxExp).toBe(10000000);
    expect(info.maxPeakExp).toBe(10000000);
  });

  it('fromJSON：缺失字段兜底，level 至少为 1', () => {
    const info = new CareerInfo(tables, 'warrior').fromJSON({});
    expect(info.exp).toBe(0);
    expect(info.level).toBe(1);
    expect(info.peakExp).toBe(0);
    expect(info.peakLevel).toBe(0);
    expect(info.maxLevel).toBe(60);

    const zeros = new CareerInfo(tables, 'warrior').fromJSON({ level: 0, maxLevel: 0 });
    expect(zeros.level).toBe(1);
    expect(zeros.maxLevel).toBe(60);
  });

  it('fromJSON：装备位缺字段时保留空槽，已有字段被载入', () => {
    const info = new CareerInfo(tables, 'warrior').fromJSON({
      equipments: {
        weapon: { key: 'stickSword', count: 1, level: 10, quality: 1 },
      },
    });
    expect(info.equipments.weapon.key).toBe('stickSword');
    expect(info.equipments.weapon.level).toBe(10);
    expect(info.equipments.plastron.empty).toBe(true);
    expect(info.equipments.gaiter.empty).toBe(true);
    expect(info.equipments.ornament.empty).toBe(true);
  });

  it('fromJSON：selectedSkills/selectedEnhances 按职业表过滤', () => {
    const info = new CareerInfo(tables, 'warrior').fromJSON({
      selectedSkills: ['slash', 'bash', 'not-a-skill'],
      selectedEnhances: ['fury', 'not-an-enhance'],
    });
    expect(info.selectedSkills).toEqual(['slash', 'bash']);
    expect(info.selectedEnhances).toEqual(['fury']);
  });

  it('fromJSON：selectedSkills 缺失/为 null 时保留旧值（原版只在有值时覆盖）', () => {
    const info = new CareerInfo(tables, 'warrior');
    info.selectedSkills = ['slash'];
    info.fromJSON({ exp: 5 });
    expect(info.selectedSkills).toEqual(['slash']);

    info.fromJSON({ selectedSkills: null });
    expect(info.selectedSkills).toEqual(['slash']);

    // 空数组是「有值」，会被覆盖为空
    info.fromJSON({ selectedSkills: ['nope'] });
    expect(info.selectedSkills).toEqual([]);
  });

  it('fromJSON：未知职业不清空已有选择（原版会 TypeError，这里退化为清空）', () => {
    const info = new CareerInfo(tables, 'nobody').fromJSON({ selectedSkills: ['slash'] });
    expect(info.selectedSkills).toEqual([]);
  });

  it('fromJSON 容忍非对象与 NaN', () => {
    expect(new CareerInfo(tables, 'warrior').fromJSON(null).level).toBe(1);
    const info = new CareerInfo(tables, 'warrior').fromJSON({
      level: Number.NaN,
      exp: Number.POSITIVE_INFINITY,
      maxLevel: Number.NaN,
    });
    expect(info.level).toBe(1);
    expect(info.exp).toBe(Number.POSITIVE_INFINITY);
    expect(info.maxLevel).toBe(60);
  });

  it('toJSON → fromJSON 深度等价', () => {
    const info = new CareerInfo(tables, 'warrior').fromJSON({
      exp: 12,
      level: 7,
      peakExp: 3,
      peakLevel: 2,
      maxLevel: 62,
      equipments: { weapon: { key: 'stickSword', count: 1, level: 14 } },
      selectedSkills: ['slash'],
      selectedEnhances: ['fury'],
    });
    const restored = new CareerInfo(tables, 'warrior').fromJSON(info.toJSON());
    expect(restored.toJSON()).toEqual(info.toJSON());
  });
});
