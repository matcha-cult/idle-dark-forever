/**
 * 炼金（药剂）纯逻辑（原版 `game.js` 的药剂部分 + `produce/Medicine.js`）。
 *
 * 数值公式逐条对齐原版：
 * - `maxMedicineExp = 200t³ + 400t² + 800t + 1600`（`t = totalMedicineLevel`）；
 * - `resetMedicineCost = 10l³ + 100l² + 1000l + 2000`，`resetMedicineDiamondsCost = 2l + 20`
 *   （`l = t - 1`）；
 * - `bowelEffect = 1.5^bowelLevel`，`bowelUpgradePrice = 1000 * 2^bowelLevel`。
 *
 * ⚠️ `bowelLevel`（坩埚等级）在 `PlayerAccountState` / `AccountExtras` 里**没有字段**
 * （game-core 未移植），因此本工程恒为 0（倍率 1.0）。见交付报告「未完成项」。
 */
import { type DataTables, type Player, type Rng } from '@idle-dark/game-core';
import { BusinessErrorCode, type MedicineStateDto } from '@idle-dark/protocol';
import type { AccountExtras } from '../../shared/index.js';
import { OpError } from '../../inventory/internal/op-error.js';

export const DEFAULT_BOWEL_LEVEL = 0;

export function totalMedicineLevel(tables: DataTables, levels: Record<string, number>): number {
  let total = 0;
  for (const key of Object.keys(tables.medicines)) {
    const value = levels[key];
    total += typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  }
  return total;
}

export function maxMedicineExp(total: number): number {
  const t = Math.max(0, Math.trunc(total));
  return 200 * t * t * t + 400 * t * t + 800 * t + 1600;
}

export function resetMedicineGoldCost(total: number): number {
  const l = Math.trunc(total) - 1;
  return 10 * l * l * l + 100 * l * l + 1000 * l + 2000;
}

export function resetMedicineDiamondCost(total: number): number {
  const l = Math.trunc(total) - 1;
  return 2 * l + 20;
}

export function bowelEffect(bowelLevel: number = DEFAULT_BOWEL_LEVEL): number {
  return Math.pow(1.5, bowelLevel);
}

export function bowelUpgradePrice(bowelLevel: number = DEFAULT_BOWEL_LEVEL): number {
  return 1000 * Math.pow(2, bowelLevel);
}

/** 补齐 `levels` 里缺失的药剂 key（0 起）。 */
export function normalizedLevels(
  tables: DataTables,
  levels: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(tables.medicines)) {
    const value = levels[key];
    out[key] = typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  }
  return out;
}

export function medicineStateOf(tables: DataTables, extras: AccountExtras): MedicineStateDto {
  const levels = normalizedLevels(tables, extras.medicineLevel);
  const total = totalMedicineLevel(tables, levels);
  const exp = Number.isFinite(extras.medicineExp) ? extras.medicineExp : 0;
  return {
    levels,
    exp,
    maxExp: maxMedicineExp(total),
    bowelLevel: DEFAULT_BOWEL_LEVEL,
    bowelEffect: bowelEffect(),
    bowelUpgradePrice: bowelUpgradePrice(),
  };
}

/**
 * 原版 `game.gotMedicineExp`：加经验，溢出的每一级随机分配到一个药剂上。
 *
 * @returns 本次提升的药剂 key 列表（按提升先后）。
 */
export function grantMedicineExp(
  tables: DataTables,
  extras: AccountExtras,
  amount: number,
  rng: Rng,
): string[] {
  if (!Number.isFinite(amount) || amount <= 0) return [];
  const keys = Object.keys(tables.medicines);
  if (keys.length === 0) return [];
  extras.medicineExp = (Number.isFinite(extras.medicineExp) ? extras.medicineExp : 0) + amount;
  const raised: string[] = [];
  let guard = 0;
  for (;;) {
    const total = totalMedicineLevel(tables, extras.medicineLevel);
    const need = maxMedicineExp(total);
    if (!(extras.medicineExp >= need)) break;
    extras.medicineExp -= need;
    const picked = keys[rng.int(keys.length)];
    if (picked === undefined) break;
    extras.medicineLevel[picked] = (extras.medicineLevel[picked] ?? 0) + 1;
    raised.push(picked);
    guard += 1;
    if (guard > 100_000) break; // 防病态数据下的死循环
  }
  return raised;
}

/** 投入能量材料：校验 + 扣背包 + 加经验。 */
export function opMedicineUse(
  player: Player,
  tables: DataTables,
  extras: AccountExtras,
  material: string,
  count: number,
  rng: Rng,
): void {
  if (!Number.isInteger(count) || count <= 0) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '投入数量非法');
  }
  const good = tables.goods[material];
  if (!good || good.type !== 'material' || !good.energy) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '该物品不是能量材料');
  }
  if (player.countGood(material) < count) {
    throw new OpError(BusinessErrorCode.NOT_ENOUGH_MATERIAL, undefined, {
      material,
      required: count,
    });
  }

  player.costGood(material, count);
  const energyPerItem = good.energy * bowelEffect();
  grantMedicineExp(tables, extras, energyPerItem * count, rng);
}

/**
 * 药剂重置：支付金币或神力，把全部药剂等级与经验清零。
 *
 * ⚠️ 前端 `produce.medicineReset` 只带 `{ currency }`，**没有目标药剂 key**
 * （原版 `upgradeMedicine(key)` 需要 key），因此本工程把语义收敛为「付费洗点」：
 * 清空等级与经验，之后重新投入材料由服务端随机分配。见交付报告。
 */
export function opMedicineReset(
  player: Player,
  tables: DataTables,
  extras: AccountExtras,
  currency: 'gold' | 'diamonds',
): void {
  const total = totalMedicineLevel(tables, extras.medicineLevel);
  if (total <= 0) return; // 没有可重置的等级：不收费，幂等成功

  if (currency === 'gold') {
    const cost = resetMedicineGoldCost(total);
    if (player.gold < cost) {
      throw new OpError(BusinessErrorCode.NOT_ENOUGH_GOLD, undefined, { required: cost });
    }
    player.gold -= cost;
  } else {
    const cost = resetMedicineDiamondCost(total);
    if (player.account.diamonds < cost) {
      throw new OpError(BusinessErrorCode.NOT_ENOUGH_DIAMONDS, undefined, { required: cost });
    }
    player.account.diamonds -= cost;
  }

  extras.medicineLevel = {};
  extras.medicineExp = 0;
}
