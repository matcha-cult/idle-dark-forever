import { describe, expect, it } from 'vitest';

import {
  AffixInfo,
  DEFAULT_LEVEL,
  DEF_CLASS_RATE,
  DEF_POSITION_RATE,
  EQUIP_POSITION_NAMES,
  EQUIP_POSITION_ORDER,
  InventorySlot,
} from './inventory-slot.js';
import { createTestTables } from './fixtures.test.js';

const tables = createTestTables();

function slot(position: 'equip' | 'inventory' = 'inventory'): InventorySlot {
  return new InventorySlot(tables, position);
}

describe('AffixInfo', () => {
  it('空实例的派生属性安全（不抛错）', () => {
    const affix = new AffixInfo(tables);
    expect(affix.key).toBeNull();
    expect(affix.value).toBe(0);
    expect(affix.rebuilded).toBe(false);
    expect(affix.affixData).toBeUndefined();
    expect(affix.isLegend).toBe(false);
    expect(affix.display).toBe('');
    expect(affix.rangeDisplay(1)).toBeUndefined();
  });

  it('先查 affixes 再查 legends', () => {
    expect(new AffixInfo(tables).fromJSON({ key: 'atk', value: 3 }).affixData?.key).toBe('atk');
    const legend = new AffixInfo(tables).fromJSON({ key: 'flame', value: 4 });
    expect(legend.affixData?.key).toBe('flame');
    expect(legend.isLegend).toBe(true);
    expect(legend.display).toBe('烈焰4');
    expect(legend.rangeDisplay(1)).toEqual([1, 10]);
  });

  it('fromJSON 兜底与类型收敛', () => {
    const affix = new AffixInfo(tables).fromJSON({ key: '', value: Number.NaN, rebuilded: 1 });
    expect(affix.key).toBeNull();
    expect(affix.value).toBe(0);
    expect(affix.rebuilded).toBe(false);

    const truthy = new AffixInfo(tables).fromJSON({ key: 'atk', value: -5, rebuilded: true });
    expect(truthy.value).toBe(-5);
    expect(truthy.rebuilded).toBe(true);
  });

  it('fromJSON 容忍非对象；toJSON 形状稳定', () => {
    expect(new AffixInfo(tables).fromJSON(undefined).key).toBeNull();
    expect(new AffixInfo(tables).fromJSON({ key: 'atk', value: 2 }).toJSON()).toEqual({
      key: 'atk',
      value: 2,
      rebuilded: false,
    });
  });
});

describe('InventorySlot 基础', () => {
  it('空槽默认值与派生属性', () => {
    const empty = slot();
    expect(empty.key).toBeNull();
    expect(empty.count).toBe(0);
    expect(empty.empty).toBe(true);
    expect(empty.isEquip).toBe(false);
    expect(empty.price).toBe(0);
    expect(empty.totalPrice).toBe(0);
    expect(empty.requireLevel).toBe(0);
    expect(empty.name).toBe('');
    expect(empty.description).toBe('');
    expect(empty.displayQuality).toBeUndefined();
    expect(empty.goodData).toBeUndefined();
    expect(empty.backgroundColor).toBeUndefined();
    expect(empty.nameColor).toBeUndefined();
    expect(empty.originName).toBeUndefined();
    expect(empty.equipPositionName).toBeUndefined();
    expect(empty.equipPositionOrder).toBeUndefined();
    expect(empty.atk).toBe(0);
    expect(empty.def).toBe(0);
    expect(empty.maxHp).toBe(0);
    expect(empty.mpRecovery).toBe(0);
    expect(empty.mpFromKill).toBe(0);
  });

  it('装备价格 / 需求等级 / 攻击（原版公式）', () => {
    const sword = slot().fromJSON({ key: 'stickSword', count: 1, level: 3, quality: 2 });
    expect(sword.isEquip).toBe(true);
    expect(sword.price).toBe(12); // ((0.01*9 + 3) * 4) | 0
    expect(sword.requireLevel).toBe(2); // ceil(3/2)
    expect(sword.atkSpeed).toBe(1.5);
    expect(sword.atk).toBe(2); // (3/3 + 2) / 1.5
    expect(sword.displayQuality).toBe(2);
    expect(sword.equipPositionName).toBe('武器');
    expect(sword.equipPositionOrder).toBe(0);
  });

  it('防御公式：class 倍率 × 部位倍率（武器/饰品为 0）', () => {
    const cloth = slot().fromJSON({ key: 'dress', count: 1, level: 10 });
    expect(cloth.def).toBe((4 + 10) * (DEF_CLASS_RATE.cloth! * DEF_POSITION_RATE.plastron!));
    const light = slot().fromJSON({ key: 'rattanArmor', count: 1, level: 10 });
    expect(light.def).toBe((4 + 10) * 1);
    const heavy = slot().fromJSON({ key: 'boneShinGuard', count: 1, level: 10 });
    expect(heavy.def).toBeCloseTo((4 + 10) * (2 * 0.6), 10);
    expect(slot().fromJSON({ key: 'stickSword', count: 1, level: 10 }).def).toBe(0);
    expect(slot().fromJSON({ key: 'charm', count: 1, level: 10 }).def).toBe(0);
  });

  it('饰品给生命；法杖给回蓝与击杀回蓝', () => {
    expect(slot().fromJSON({ key: 'charm', count: 1, level: 7 }).maxHp).toBe(10 + 14);
    expect(slot().fromJSON({ key: 'stickSword', count: 1, level: 7 }).maxHp).toBe(0);

    const wand = slot().fromJSON({ key: 'stickWand', count: 1, level: 5 });
    expect(wand.mpRecovery).toBeCloseTo(((5 * 1.5 + 9) * 2) / 5, 10);
    expect(wand.mpFromKill).toBeCloseTo((5 * 1.5 + 9) * 3, 10);
    expect(slot().fromJSON({ key: 'dress', count: 1, level: 5 }).mpRecovery).toBe(0);
  });

  it('材料 / 金币 / 神力 / 钥石的展示名与品质', () => {
    expect(slot().fromJSON({ key: 'gold', count: 5 }).name).toBe('金币');
    expect(slot().fromJSON({ key: 'diamonds', count: 5 }).name).toBe('神力');
    expect(slot().fromJSON({ key: 'dust1', count: 5 }).name).toBe('尘1');
    expect(slot().fromJSON({ key: 'potion', count: 5 }).displayQuality).toBe(0);
    expect(slot().fromJSON({ key: 'potion', count: 5 }).isEnergyMaterial).toBe(true);
    expect(slot().fromJSON({ key: 'dust1', count: 5 }).isEnergyMaterial).toBe(false);
    expect(slot().fromJSON({ key: 'box', count: 1 }).isEnergyMaterial).toBe(false);

    const ticket = slot().fromJSON({ key: 'ticket', count: 3, dungeonKey: 'dungeon1' });
    expect(ticket.name).toBe('钥石:试炼地城');
    const endless = slot().fromJSON({ key: 'ticket', count: 3, dungeonKey: 'nightmare.3' });
    expect(endless.name).toBe('钥石:无尽噩梦III');
  });

  it('传奇词缀改写展示名与描述，并保留基底名', () => {
    const legend = slot().fromJSON({
      key: 'stickSword',
      count: 1,
      level: 10,
      quality: 4,
      legendType: 'flame',
      affixes: [{ key: 'flame', value: 5 }],
    });
    expect(legend.name).toBe('烈焰木剑');
    expect(legend.originName).toBe('木剑');
    expect(legend.description).toBe('燃烧吧');
    expect(legend.legendData?.key).toBe('flame');
  });

  it('材料价格不乘品质倍率之外的东西；总数 = price * count', () => {
    const dust = slot().fromJSON({ key: 'dust1', count: 4, quality: 2 });
    expect(dust.price).toBe(1 * 2 ** 2);
    expect(dust.totalPrice).toBe(16);
  });
});

describe('InventorySlot.fromJSON 隐式兼容', () => {
  it('旧装备缺 level 时按 DEFAULT_LEVEL 兜底，未知 key 兜底为 1', () => {
    expect(slot().fromJSON({ key: 'stickSword', count: 1 }).level).toBe(1);
    expect(slot().fromJSON({ key: 'boneShinGuard', count: 1 }).level).toBe(52);
    expect(DEFAULT_LEVEL.stickSword).toBe(1);
    expect(DEFAULT_LEVEL.mithrilSkirt).toBe(52);
  });

  it('显式 level=0 的装备也会被兜底', () => {
    expect(slot().fromJSON({ key: 'rattanArmor', count: 1, level: 0 }).level).toBe(8);
  });

  it('count 采用 `v.count ? Math.ceil(v.count) : null`', () => {
    expect(slot().fromJSON({ key: 'dust1', count: 2.2 }).count).toBe(3);
    expect(slot().fromJSON({ key: 'dust1', count: null }).count).toBeNull();
    // ⚠️ 原版：`count = v.count ? ceil : null`，随后判断 `count === 0` 才会 clear。
    // 由于 0 已经被归一成 null，`count === 0` 永不成立 → 有 key 的格子**不会**因为 count=0 被清空。
    const zero = slot().fromJSON({ key: 'dust1', count: 0 });
    expect(zero.key).toBe('dust1');
    expect(zero.count).toBeNull();
  });

  it('缺 key / key 为空串 → 空格子', () => {
    expect(slot().fromJSON({}).key).toBeNull();
    expect(slot().fromJSON({ key: '', count: 3 }).key).toBeNull();
    expect(slot().fromJSON(null).key).toBeNull();
    expect(slot().fromJSON(7).key).toBeNull();
  });

  it('ticket 缺 dungeonKey → 清空', () => {
    expect(slot().fromJSON({ key: 'ticket', count: 3 }).key).toBeNull();
    expect(slot().fromJSON({ key: 'ticket', count: 3, dungeonKey: 'dungeon1' }).key).toBe('ticket');
  });

  it('locked 保持原版的 boolean | number 形状', () => {
    expect(slot().fromJSON({ key: 'dust1', count: 1 }).locked).toBe(0);
    expect(slot().fromJSON({ key: 'dust1', count: 1, locked: true }).locked).toBe(true);
    expect(slot().fromJSON({ key: 'dust1', count: 1, locked: 1 }).locked).toBe(1);
  });

  it('词缀数组被实例化为 AffixInfo', () => {
    const item = slot().fromJSON({
      key: 'stickSword',
      count: 1,
      level: 10,
      affixes: [{ key: 'atk', value: 4, rebuilded: true }, {}],
    });
    expect(item.affixes).toHaveLength(2);
    expect(item.affixes[0]).toBeInstanceOf(AffixInfo);
    expect(item.affixes[0]!.rebuilded).toBe(true);
    expect(item.affixes[1]!.key).toBeNull();
    expect(item.affixes[0]!.display).toBe('攻击+4');
  });

  it('affixes 非数组时视为空', () => {
    expect(slot().fromJSON({ key: 'dust1', count: 1, affixes: 'x' }).affixes).toEqual([]);
  });

  it('NaN / Infinity / 负数不会破坏 fromJSON', () => {
    const item = slot().fromJSON({
      key: 'stickSword',
      count: 1,
      level: Number.NaN,
      quality: Number.NaN,
      enchantTimes: Number.POSITIVE_INFINITY,
      locked: Number.NaN,
    });
    expect(item.level).toBe(1); // NaN → 0 → DEFAULT_LEVEL
    expect(item.quality).toBe(0);
    expect(item.enchantTimes).toBe(Number.POSITIVE_INFINITY);
    expect(item.locked).toBe(0);
  });

  it('clear 不重置 position 与 locked（原版行为）', () => {
    const equipped = new InventorySlot(tables, 'equip').fromJSON({
      key: 'stickSword',
      count: 1,
      level: 5,
      locked: true,
    });
    equipped.clear();
    expect(equipped.key).toBeNull();
    expect(equipped.count).toBe(0);
    expect(equipped.level).toBe(0);
    expect(equipped.quality).toBe(0);
    expect(equipped.enchantTimes).toBe(0);
    expect(equipped.legendType).toBeNull();
    expect(equipped.dungeonKey).toBeNull();
    expect(equipped.affixes).toEqual([]);
    expect(equipped.position).toBe('equip');
    expect(equipped.locked).toBe(true);
  });

  it('swap 互换内容但各自保留 position', () => {
    const a = new InventorySlot(tables, 'equip').fromJSON({ key: 'stickSword', count: 1, level: 9 });
    const b = new InventorySlot(tables, 'inventory').fromJSON({ key: 'dust1', count: 4 });
    a.swap(b);
    expect(a.key).toBe('dust1');
    expect(a.count).toBe(4);
    expect(a.position).toBe('equip');
    expect(b.key).toBe('stickSword');
    expect(b.level).toBe(9);
    expect(b.position).toBe('inventory');
  });

  it('toJSON → fromJSON 深度等价', () => {
    const original = new InventorySlot(tables, 'bank').fromJSON({
      key: 'stickSword',
      count: 1,
      level: 30,
      quality: 3,
      locked: true,
      enchantTimes: 2,
      legendType: 'flame',
      affixes: [{ key: 'flame', value: 6, rebuilded: true }],
    });
    const restored = new InventorySlot(tables, 'bank').fromJSON(original.toJSON());
    expect(restored.toJSON()).toEqual(original.toJSON());
  });

  it('常量表与契约字段一致', () => {
    expect(EQUIP_POSITION_NAMES.gaiter).toBe('护腿');
    expect(EQUIP_POSITION_ORDER.weapon).toBe(0);
    expect(EQUIP_POSITION_ORDER.ornament).toBe(3);
    expect(DEF_POSITION_RATE.gaiter).toBe(0.6);
    expect(DEF_CLASS_RATE.armor).toBe(2);
  });
});
