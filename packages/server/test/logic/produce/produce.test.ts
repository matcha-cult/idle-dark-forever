import { describe, expect, it } from 'vitest';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { AffixInfo, SeededRngFactory, generateEquip, type DataTables } from '@idle-dark/game-core';
import { OpIdempotencyService } from '../../../src/modules/game/op-idempotency.service.js';
import { RateLimiterService } from '../../../src/common/services/rate-limiter.service.js';
import { ProduceLogicService } from '../../../src/modules/logic/produce/produce.logic.service.js';
import { InProcessEventBus } from '../../../src/modules/logic/shared/event-bus.js';
import { OpError } from '../../../src/modules/logic/shared/op-error.js';
import {
  enchantCostParts,
  enchantCostsOf,
  opDecompose,
  opEnchant,
  opRebuild,
  rebuildCostOf,
} from '../../../src/modules/logic/produce/internal/produce-ops.js';
import {
  grantMedicineExp,
  maxMedicineExp,
  opMedicineReset,
  opMedicineUse,
  totalMedicineLevel,
} from '../../../src/modules/logic/produce/internal/medicine.js';
import {
  FIXED_NOW,
  giveInventory,
  makeFakeBatcher,
  makeFakeCharacters,
  makeFakeContexts,
  makeFixture,
} from '../_helpers.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof OpError) return error.code;
    throw error;
  }
  throw new Error('expected throw');
}

function equipOf(tables: DataTables, quality: number) {
  return generateEquip(tables, 'stickSword', 10, quality, null, new SeededRngFactory().create(2024));
}

function makeService(fixture: ReturnType<typeof makeFixture>) {
  const opIds = new OpIdempotencyService();
  const service = new ProduceLogicService(
    makeFakeContexts(fixture),
    makeFakeCharacters(),
    opIds,
    new RateLimiterService(),
    makeFakeBatcher(),
    () => FIXED_NOW,
    new InProcessEventBus(),
  );
  return { service, opIds };
}

describe('produce 费用公式', () => {
  it('附魔费用随品质 / 次数上升，锁定额外消耗神力', () => {
    const fixture = makeFixture();
    const slot = equipOf(fixture.tables, 2);
    const base = enchantCostParts(slot, 0);
    expect(base.gold).toBeGreaterThan(0);
    expect(base.materials.length).toBeGreaterThan(0);
    expect(base.diamonds).toBe(0);

    const locked = enchantCostParts(slot, 1);
    expect(locked.diamonds).toBeGreaterThan(0);

    slot.enchantTimes = 3;
    expect(enchantCostParts(slot, 0).gold).toBeGreaterThan(base.gold);
    expect(enchantCostsOf(slot).lockDiamond).toBeGreaterThan(0);
  });

  it('重铸费用 = 1 + ceil(level/25 * 2^quality)', () => {
    const fixture = makeFixture();
    const slot = equipOf(fixture.tables, 3);
    expect(rebuildCostOf(slot)).toBe(1 + Math.ceil((10 / 25) * 2 ** 3));
  });
});

describe('produce 附魔 / 重铸 / 分解边界', () => {
  it('普通品质附魔 → INVALID_PARAM', () => {
    const fixture = makeFixture();
    const slot = equipOf(fixture.tables, 0);
    expect(codeOf(() => opEnchant(fixture.player, fixture.tables, slot, [], new SeededRngFactory().create(1)))).toBe(
      BusinessErrorCode.INVALID_PARAM,
    );
  });

  it('金币不足 → NOT_ENOUGH_GOLD', () => {
    const fixture = makeFixture();
    fixture.player.gold = 0;
    const slot = equipOf(fixture.tables, 1);
    expect(codeOf(() => opEnchant(fixture.player, fixture.tables, slot, [], new SeededRngFactory().create(1)))).toBe(
      BusinessErrorCode.NOT_ENOUGH_GOLD,
    );
  });

  it('材料不足 → NOT_ENOUGH_MATERIAL 且不扣金币（原子性）', () => {
    const fixture = makeFixture();
    fixture.player.gold = 10_000_000;
    const slot = equipOf(fixture.tables, 1);
    const goldBefore = fixture.player.gold;
    expect(codeOf(() => opEnchant(fixture.player, fixture.tables, slot, [], new SeededRngFactory().create(1)))).toBe(
      BusinessErrorCode.NOT_ENOUGH_MATERIAL,
    );
    expect(fixture.player.gold).toBe(goldBefore);
    expect(slot.enchantTimes).toBe(0);
  });

  it('锁定全部词缀 → INVALID_PARAM', () => {
    const fixture = makeFixture();
    const slot = equipOf(fixture.tables, 1);
    const keys = slot.affixes.map((affix) => affix.key).filter((key): key is string => key !== null);
    expect(codeOf(() => opEnchant(fixture.player, fixture.tables, slot, keys, new SeededRngFactory().create(1)))).toBe(
      BusinessErrorCode.INVALID_PARAM,
    );
  });

  it('附魔成功：扣费 + enchantTimes + 词缀重掷', () => {
    const fixture = makeFixture();
    const slot = equipOf(fixture.tables, 1);
    const cost = enchantCostParts(slot, 0);
    fixture.player.gold = cost.gold;
    giveInventory(fixture, { key: cost.materials[0]!.key, count: cost.materials[0]!.count }, 0);
    opEnchant(fixture.player, fixture.tables, slot, [], new SeededRngFactory().create(7));
    expect(slot.enchantTimes).toBe(1);
    expect(fixture.player.gold).toBe(0);
  });

  it('传奇词缀 / 已重铸词缀不可重铸；神力不足报错', () => {
    const fixture = makeFixture();
    const legendKey = Object.keys(fixture.tables.legends)[0]!;
    const affixKey = Object.keys(fixture.tables.affixes)[0]!;
    const legend = equipOf(fixture.tables, 1);
    legend.affixes = [new AffixInfo(fixture.tables).fromJSON({ key: legendKey, value: 1 })];
    expect(codeOf(() => opRebuild(fixture.player, fixture.tables, legend, legendKey, new SeededRngFactory().create(1)))).toBe(
      BusinessErrorCode.INVALID_PARAM,
    );

    const rebuilt = equipOf(fixture.tables, 1);
    const rebuiltAffix = new AffixInfo(fixture.tables).fromJSON({ key: affixKey, value: 1 });
    rebuiltAffix.rebuilded = true;
    rebuilt.affixes = [rebuiltAffix];
    expect(codeOf(() => opRebuild(fixture.player, fixture.tables, rebuilt, affixKey, new SeededRngFactory().create(1)))).toBe(
      BusinessErrorCode.INVALID_PARAM,
    );

    const normal = equipOf(fixture.tables, 1);
    normal.affixes = [new AffixInfo(fixture.tables).fromJSON({ key: affixKey, value: 1 })];
    fixture.account.diamonds = 0;
    expect(codeOf(() => opRebuild(fixture.player, fixture.tables, normal, affixKey, new SeededRngFactory().create(1)))).toBe(
      BusinessErrorCode.NOT_ENOUGH_DIAMONDS,
    );

    fixture.account.diamonds = 1000;
    opRebuild(fixture.player, fixture.tables, normal, affixKey, new SeededRngFactory().create(1));
    expect(normal.affixes[0]!.rebuilded).toBe(true);
    expect(fixture.account.diamonds).toBe(1000 - rebuildCostOf(normal));
  });

  it('分解：锁定 → ITEM_LOCKED；只有非装备 → INVALID_PARAM', () => {
    const fixture = makeFixture();
    const locked = equipOf(fixture.tables, 3);
    locked.locked = true;
    expect(
      codeOf(() => opDecompose(fixture.player, fixture.tables, [{ position: 'inventory', slot: locked }])),
    ).toBe(BusinessErrorCode.ITEM_LOCKED);

    const material = giveInventory(fixture, { key: 'dust1', count: 5 }, 0);
    expect(
      codeOf(() => opDecompose(fixture.player, fixture.tables, [{ position: 'inventory', slot: material }])),
    ).toBe(BusinessErrorCode.INVALID_PARAM);
  });

  it('分解成功：产出材料进 build 背包并返还神力', () => {
    const fixture = makeFixture();
    const slot = equipOf(fixture.tables, 3);
    const diamonds = fixture.account.diamonds;
    const result = opDecompose(fixture.player, fixture.tables, [{ position: 'inventory', slot }]);
    expect(result.materials.length).toBeGreaterThan(0);
    expect(result.diamonds).toBeGreaterThan(0);
    expect(fixture.account.diamonds).toBe(diamonds + result.diamonds);
    expect(slot.empty).toBe(true);
    expect(fixture.player.buildInventory.length).toBeGreaterThan(0);
  });
});

describe('produce 炼金', () => {
  it('投入非能量材料 → INVALID_PARAM；数量非法 → INVALID_PARAM', () => {
    const fixture = makeFixture();
    expect(
      codeOf(() => opMedicineUse(fixture.player, fixture.tables, fixture.extras, 'stickSword', 1, new SeededRngFactory().create(1))),
    ).toBe(BusinessErrorCode.INVALID_PARAM);
    expect(
      codeOf(() => opMedicineUse(fixture.player, fixture.tables, fixture.extras, 'dust1', 0, new SeededRngFactory().create(1))),
    ).toBe(BusinessErrorCode.INVALID_PARAM);
  });

  it('材料不足 → NOT_ENOUGH_MATERIAL', () => {
    const fixture = makeFixture();
    expect(
      codeOf(() => opMedicineUse(fixture.player, fixture.tables, fixture.extras, 'dust1', 3, new SeededRngFactory().create(1))),
    ).toBe(BusinessErrorCode.NOT_ENOUGH_MATERIAL);
  });

  it('投入材料提升经验并可升级药剂', () => {
    const fixture = makeFixture();
    giveInventory(fixture, { key: 'dust1', count: 1000 }, 0);
    opMedicineUse(fixture.player, fixture.tables, fixture.extras, 'dust1', 1000, new SeededRngFactory().create(1));
    expect(fixture.extras.medicineExp).toBeGreaterThan(0);
    expect(totalMedicineLevel(fixture.tables, fixture.extras.medicineLevel)).toBeGreaterThan(0);
  });

  it('药剂重置：等级为 0 时幂等不收费；有等级且金币不足 → NOT_ENOUGH_GOLD', () => {
    const fixture = makeFixture();
    opMedicineReset(fixture.player, fixture.tables, fixture.extras, 'gold');
    expect(fixture.player.gold).toBe(0);

    fixture.extras.medicineLevel = { mainPoint: 2 };
    expect(codeOf(() => opMedicineReset(fixture.player, fixture.tables, fixture.extras, 'gold'))).toBe(
      BusinessErrorCode.NOT_ENOUGH_GOLD,
    );

    fixture.player.gold = 10_000_000;
    opMedicineReset(fixture.player, fixture.tables, fixture.extras, 'gold');
    expect(totalMedicineLevel(fixture.tables, fixture.extras.medicineLevel)).toBe(0);
  });

  it('maxMedicineExp 与 grantMedicineExp 分配一致', () => {
    const fixture = makeFixture();
    expect(maxMedicineExp(0)).toBe(1600);
    const raised = grantMedicineExp(fixture.tables, fixture.extras, maxMedicineExp(0), new SeededRngFactory().create(3));
    expect(raised).toHaveLength(1);
    expect(totalMedicineLevel(fixture.tables, fixture.extras.medicineLevel)).toBe(1);
  });
});

describe('ProduceLogicService 幂等', () => {
  it('opId 重复提交附魔 → DUPLICATE_OPERATION 且只扣一次', async () => {
    const fixture = makeFixture();
    const slot = equipOf(fixture.tables, 1);
    const cost = enchantCostParts(slot, 0);
    fixture.player.gold = cost.gold * 2;
    giveInventory(fixture, { key: cost.materials[0]!.key, count: cost.materials[0]!.count * 2 }, 0);
    giveInventory(fixture, slot.toJSON() as Record<string, unknown>, 1);
    const { service } = makeService(fixture);
    const id = 'inventory:1';

    const first = await service.enchant(1, id, [], 'op-x');
    expect(first.success).toBe(true);
    const goldAfter = fixture.player.gold;
    const timesAfter = fixture.player.inventory[1]!.enchantTimes;

    const second = await service.enchant(1, id, [], 'op-x');
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.data.code).toBe(BusinessErrorCode.DUPLICATE_OPERATION);
    expect(fixture.player.gold).toBe(goldAfter);
    expect(fixture.player.inventory[1]!.enchantTimes).toBe(timesAfter);
  });
});
