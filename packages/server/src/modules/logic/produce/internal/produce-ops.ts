/**
 * 附魔 / 重铸 / 分解纯逻辑（原版 `produce/*` 的服务端权威版）。
 *
 * 费用公式逐条对齐原版：
 * - 附魔：`Enchants.js#getCosts`（金币 + 材料随 `enchantTimes` / `quality` / 锁定量变化，
 *   锁定额外消耗神力）；
 * - 重铸：`Rebuild.js#getCosts`（`1 + ceil(level/25 * 2^quality)` 神力）；
 * - 分解：`Decompose.js#decompose` + `rules/goods.ts#getDecomposeMatrials`。
 *
 * 与原版的差异（见交付报告）：
 * - 材料数量做 `Math.ceil` 且下限 1（原版在高锁定量下会得到 0.5 / 负数，
 *   负数会把材料「加回去」）；
 * - 重铸拒绝传奇词缀与已重铸词缀（协议 `RebuildCostsDto.rebuildableAffixKeys` 的语义）。
 */
import {
  InventorySlot,
  getDecomposeMatrials,
  getMaterialLevel,
  isValidAffix,
  randomAffixes,
  randomAffixValue,
  type DataTables,
  type Player,
  type Rng,
} from '@idle-dark/game-core';
import { BusinessErrorCode, type CostDto, type DecomposeResultDto, type EnchantCostsDto } from '@idle-dark/protocol';
import { OpError } from '../../shared/op-error.js';
import { MATERIAL_KEY } from '@idle-dark/game-core';

export interface MaterialCost {
  key: string;
  count: number;
}

export interface EnchantCostParts {
  gold: number;
  materials: MaterialCost[];
  diamonds: number;
}

function materialIndexFor(level: number): number {
  return getMaterialLevel(level);
}

/** 附魔费用（原版 `getCosts`）。`lockCount` = 被锁定的词缀条数。 */
export function enchantCostParts(slot: InventorySlot, lockCount: number): EnchantCostParts {
  const level = Number.isFinite(slot.level) ? slot.level : 0;
  const quality = Number.isFinite(slot.quality) ? Math.trunc(slot.quality) : 0;
  const enchantTimes = Number.isFinite(slot.enchantTimes) ? slot.enchantTimes : 0;
  const locks = Math.max(0, Math.trunc(lockCount));

  const gold = Math.ceil(
    (0.1 * level * level + 2 * level) *
      2 ** quality *
      (1 + enchantTimes * 0.2 + enchantTimes * enchantTimes * 0.01),
  );

  const materials: MaterialCost[] = [];
  if (level >= 5) {
    const tier = materialIndexFor(level);
    const dust = MATERIAL_KEY[1]?.[tier];
    if (dust) {
      const raw = 2 ** (quality - 1 - locks);
      if (raw > 0) materials.push({ key: dust, count: Math.max(1, Math.ceil(raw)) });
    }
    if (quality - locks >= 2) {
      const piece = MATERIAL_KEY[2]?.[tier];
      if (piece) {
        const raw = 2 ** (quality - 2 - locks);
        if (raw > 0) materials.push({ key: piece, count: Math.max(1, Math.ceil(raw)) });
      }
    }
  }

  const diamonds =
    locks > 0 ? 1 + Math.ceil((level / 50) * (locks + locks * locks * 0.2)) : 0;

  return { gold, materials, diamonds };
}

/** 单条锁定词缀的额外神力（`enchantCosts.lockDiamond`，锁定 1 条时的边际费用）。 */
export function lockDiamondOf(slot: InventorySlot): number {
  return enchantCostParts(slot, 1).diamonds;
}

function costDtoOf(parts: EnchantCostParts): CostDto {
  const dto: CostDto = { gold: parts.gold };
  if (parts.materials.length > 0) dto.materials = parts.materials.map((m) => ({ ...m }));
  if (parts.diamonds > 0) dto.diamonds = parts.diamonds;
  return dto;
}

/** `produce.enchantCosts` 载荷。 */
export function enchantCostsOf(slot: InventorySlot): EnchantCostsDto {
  const parts = enchantCostParts(slot, 0);
  return { enchant: costDtoOf(parts), lockDiamond: lockDiamondOf(slot) };
}

function assertEnchantable(slot: InventorySlot): void {
  if (slot.empty) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  if (!slot.isEquip) throw new OpError(BusinessErrorCode.ITEM_NOT_EQUIPPABLE);
  if (!(slot.quality > 0)) throw new OpError(BusinessErrorCode.INVALID_PARAM, '普通品质物品无法附魔');
  if (slot.affixes.length === 0) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '该装备没有可附魔的词缀');
  }
}

/**
 * 附魔（重掷未锁定词缀）。
 *
 * @returns 实际扣费明细（供调用方审计）。
 */
export function opEnchant(
  player: Player,
  tables: DataTables,
  slot: InventorySlot,
  lockedAffixKeys: readonly string[],
  rng: Rng,
): EnchantCostParts {
  assertEnchantable(slot);

  const locked = new Set(lockedAffixKeys);
  const lockedIndexes = new Set<number>();
  slot.affixes.forEach((affix, index) => {
    if (affix.key !== null && locked.has(affix.key)) lockedIndexes.add(index);
  });
  const lockCount = lockedIndexes.size;
  if (lockCount >= slot.affixes.length) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '至少要保留一条可重掷的词缀');
  }

  const parts = enchantCostParts(slot, lockCount);
  chargeCost(player, parts);

  slot.enchantTimes += 1;
  const next = slot.affixes.map((affix, index) =>
    lockedIndexes.has(index) ? affix : randomAffixValue(tables, affix, slot.level, rng),
  );
  slot.affixes = next;
  return parts;
}

/** 重铸费用：`1 + ceil(level/25 * 2^quality)` 神力。 */
export function rebuildCostOf(slot: InventorySlot): number {
  const level = Number.isFinite(slot.level) ? slot.level : 0;
  const quality = Number.isFinite(slot.quality) ? Math.trunc(slot.quality) : 0;
  return 1 + Math.ceil((level / 25) * 2 ** quality);
}

/** 可重铸词缀 key（非传奇且未重铸过）。 */
export function rebuildableAffixKeys(slot: InventorySlot): string[] {
  const out: string[] = [];
  for (const affix of slot.affixes) {
    if (affix.key === null || affix.isLegend || affix.rebuilded) continue;
    out.push(affix.key);
  }
  return out;
}

/** 重铸单条词缀（原版 `Rebuild.rebuild`）。 */
export function opRebuild(
  player: Player,
  tables: DataTables,
  slot: InventorySlot,
  affixKey: string,
  rng: Rng,
): number {
  if (slot.empty) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  if (!slot.isEquip) throw new OpError(BusinessErrorCode.ITEM_NOT_EQUIPPABLE);

  const index = slot.affixes.findIndex((affix) => affix.key === affixKey);
  const target = index >= 0 ? slot.affixes[index] : undefined;
  if (!target) throw new OpError(BusinessErrorCode.INVALID_PARAM, '该词缀不存在');
  if (target.isLegend) throw new OpError(BusinessErrorCode.INVALID_PARAM, '传奇词缀无法重铸');
  if (target.rebuilded) throw new OpError(BusinessErrorCode.INVALID_PARAM, '该词缀已重铸过');

  const cost = rebuildCostOf(slot);
  if (player.account.diamonds < cost) {
    throw new OpError(BusinessErrorCode.NOT_ENOUGH_DIAMONDS, undefined, { required: cost });
  }

  const goodKey = slot.key;
  if (goodKey === null) throw new OpError(BusinessErrorCode.ITEM_NOT_FOUND);
  const validAffixes = Object.keys(tables.affixes).filter(
    (key) => (tables.affixes[key]?.minLevel ?? 0) <= slot.level,
  ).filter((key) => isValidAffix(tables, goodKey, key, slot.level));
  if (validAffixes.length === 0) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '没有可用的词缀池');
  }

  const blacklist: Record<string, boolean> = {};
  for (const affix of slot.affixes) {
    if (affix.key !== null) blacklist[affix.key] = true;
  }

  player.account.diamonds -= cost;
  const next = randomAffixes(tables, validAffixes, slot.level, blacklist, rng);
  next.rebuilded = true;
  slot.affixes[index] = next;
  return cost;
}

/** 扣费（金币 + 材料 + 神力）；不足即抛对应业务码，**不做部分扣费**。 */
export function chargeCost(player: Player, parts: EnchantCostParts): void {
  if (parts.gold > 0 && player.gold < parts.gold) {
    throw new OpError(BusinessErrorCode.NOT_ENOUGH_GOLD, undefined, { required: parts.gold });
  }
  for (const material of parts.materials) {
    if (player.countGood(material.key) < material.count) {
      throw new OpError(BusinessErrorCode.NOT_ENOUGH_MATERIAL, undefined, {
        material: material.key,
        required: material.count,
      });
    }
  }
  if (parts.diamonds > 0 && player.account.diamonds < parts.diamonds) {
    throw new OpError(BusinessErrorCode.NOT_ENOUGH_DIAMONDS, undefined, {
      required: parts.diamonds,
    });
  }

  if (parts.gold > 0) player.gold -= parts.gold;
  for (const material of parts.materials) player.costGood(material.key, material.count);
  if (parts.diamonds > 0) player.account.diamonds -= parts.diamonds;
}

export interface DecomposeTarget {
  position: 'inventory' | 'build' | 'award';
  slot: InventorySlot;
}

function addBuildMaterial(player: Player, tables: DataTables, key: string, count: number): void {
  const existing = player.buildInventory.find((item) => item.key === key);
  if (existing) {
    existing.count = (existing.count ?? 0) + count;
    return;
  }
  player.buildInventory.push(new InventorySlot(tables, 'build').fromJSON({ key, count }));
}

/**
 * 分解若干件装备。
 *
 * - 装备栏物品与锁定物品拒绝；
 * - 非装备在整批分解里被**忽略**（build 背包里可能混有上一次分解产出的材料）；
 * - 产出材料进 `buildInventory`，神力进账号，格子清空（build/award 的空格从数组移除）。
 */
export function opDecompose(
  player: Player,
  tables: DataTables,
  targets: readonly DecomposeTarget[],
): DecomposeResultDto {
  const materials = new Map<string, number>();
  let diamonds = 0;
  let decomposed = 0;

  for (const target of targets) {
    const { slot } = target;
    if (slot.empty) continue;
    if (!slot.isEquip) continue; // 整批里的非装备跳过（见文件头注释）
    if (slot.locked) throw new OpError(BusinessErrorCode.ITEM_LOCKED);

    const result = getDecomposeMatrials({ level: slot.level, quality: slot.quality });
    for (const key of Object.keys(result)) {
      const amount = result[key] ?? 0;
      if (amount <= 0) continue;
      if (key === 'diamonds') {
        diamonds += amount;
        continue;
      }
      materials.set(key, (materials.get(key) ?? 0) + amount);
    }
    slot.clear();
    decomposed += 1;
  }

  if (decomposed === 0) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '没有可分解的装备');
  }

  for (const [key, count] of materials) addBuildMaterial(player, tables, key, count);
  player.account.diamonds += diamonds;

  for (const position of ['build', 'award'] as const) {
    const list = position === 'build' ? player.buildInventory : player.awardInventory;
    const kept = list.filter((item) => !item.empty);
    if (position === 'build') player.buildInventory = kept;
    else player.awardInventory = kept;
  }

  return {
    materials: [...materials.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([key, count]) => ({ key, count })),
    diamonds,
  };
}
