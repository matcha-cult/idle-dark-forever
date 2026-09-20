/**
 * `AffixInfo` / `InventorySlot` —— 原版 `player.js:255-544` 的移植。
 *
 * 去 MobX 后的形状：普通 class + 显式 `toJSON()` / `fromJSON()`，
 * 但**完整保留** `fromJS` 的隐式兼容语义：
 * - 缺失字段兜底（`v.level || 0`、`v.locked || 0`…）；
 * - `count` 是 `number | null`（原版 `v.count ? Math.ceil(v.count) : null`）；
 * - 旧装备缺等级时用 `DEFAULT_LEVEL` 兜底，再兜底为 1；
 * - `key`/`count===0` 直接清空格子。
 */

import type { AffixData, DataTables, GoodData, LegendData } from '../contracts/data.js';
import { EQUIP_POSITION_NAMES, EQUIP_POSITION_ORDER } from '@idle-dark/protocol';
import {
  asArray,
  asCountOrNull,
  asLocked,
  asNumber,
  asRecord,
  asStringOrNull,
  transformEquipLevel,
} from './player-meta.js';

// 槽位中文名 / 排序权重：唯一真相在 `@idle-dark/protocol` 的 `equip.ts`，这里只转发（原有消费方不变）。
export { EQUIP_POSITION_NAMES, EQUIP_POSITION_ORDER };

/** 格子所属容器（原版 `InventorySlot.position`）。 */
export type SlotPosition = 'equip' | 'inventory' | 'build' | 'award' | 'bank' | 'loot';

/** 旧装备缺少 `level` 时的兜底等级表（原版 `player.js:36-79`，硬编码的数值事实）。 */
export const DEFAULT_LEVEL: Readonly<Record<string, number>> = {
  stickSword: 1,
  stickWand: 1,
  woodSword: 6,
  woodWand: 6,
  dress: 2,
  skirt: 2,
  rattanArmor: 8,
  rattanShinGuard: 8,
  hardDress: 8,
  boot: 8,
  boneSword: 16,
  boneWand: 16,
  wolfTeethMace: 24,
  wolfTeethWand: 24,
  leatherArmor: 20,
  leatherTrousers: 20,
  leatherDress: 20,
  leatherSkirt: 20,
  copperSword: 32,
  copperBigSword: 36,
  copperSword2: 40,
  copperBigSword2: 44,
  copperArmor: 32,
  copperShinGuard: 32,
  zombieBoneHandyWand: 32,
  zombieBoneWand: 36,
  mithrilShortWand: 40,
  mithrilWand: 44,
  silkDress: 32,
  silkSocks: 32,
  magicBoneSword: 50,
  magicBoneBigSword: 54,
  mithrilCopperSword: 60,
  mithrilCopperBigSword: 64,
  boneArmor: 52,
  boneShinGuard: 52,
  ghostCreamShortWand: 50,
  ghostCreamStick: 50,
  mithrilStannumShortWand: 60,
  mithrilStannumWand: 64,
  mithrilDress: 52,
  mithrilSkirt: 52,
};

/** 原版 `DEF_CLASS_RATE`（护甲类型倍率）。 */
export const DEF_CLASS_RATE: Readonly<Record<string, number>> = {
  cloth: 0.5, // 布甲
  lightArmor: 1, // 轻甲
  armor: 2, // 重甲
};

/**
 * 部位倍率（P2：9 槽；武器 / 副手 / 饰品没有倍率 → 防御为 0）。
 *
 * P2 之前只有 `plastron` / `gaiter` 两项，新手套 / 腰带 / 鞋子的 `def` 恒为 0（§3.5 第 15 条）。
 */
export const DEF_POSITION_RATE: Readonly<Record<string, number>> = {
  plastron: 1,
  boots: 0.6,
  belt: 0.5,
  gloves: 0.4,
};

// ────────────────────────────── AffixInfo ──────────────────────────────

export interface AffixInfoJson {
  key: string | null;
  value: number;
  rebuilded: boolean;
}

/** 原版 `player.js:255-291`：一条词缀实例（普通词缀或传奇词缀）。 */
export class AffixInfo {
  readonly tables: DataTables;
  key: string | null = null;
  value = 0;
  rebuilded = false;

  constructor(tables: DataTables) {
    this.tables = tables;
  }

  /** 原版 `affixData`：先查 `affixes`，再查 `legends`。 */
  get affixData(): AffixData | LegendData | undefined {
    if (this.key === null) {
      return undefined;
    }
    return this.tables.affixes[this.key] ?? this.tables.legends[this.key];
  }

  get isLegend(): boolean {
    return this.key !== null && !!this.tables.legends[this.key];
  }

  /** 原版 `display`（原版在数据缺失时会 TypeError，这里返回空串）。 */
  get display(): string {
    const data = this.affixData;
    return data ? data.display(this.value) : '';
  }

  /** 原版 `rangeDisplay(level)`。 */
  rangeDisplay(level: number): [number, number] | undefined {
    return this.affixData?.range?.(level);
  }

  static fromJSON(tables: DataTables, value: unknown): AffixInfo {
    return new AffixInfo(tables).fromJSON(value);
  }

  fromJSON(value: unknown): this {
    const raw = asRecord(value);
    this.key = asStringOrNull(raw.key);
    this.value = asNumber(raw.value, 0);
    this.rebuilded = raw.rebuilded === true;
    return this;
  }

  toJSON(): AffixInfoJson {
    return { key: this.key, value: this.value, rebuilded: this.rebuilded };
  }
}

// ────────────────────────────── InventorySlot ──────────────────────────────

export interface InventorySlotJson {
  position: SlotPosition;
  key: string | null;
  count: number | null;
  level: number;
  quality: number;
  affixes: AffixInfoJson[];
  enchantTimes: number;
  locked: boolean | number;
  legendType: string | null;
}

/** 原版 `player.js:293-544`：统一物品模型（装备 / 材料 / 空槽）。 */
export class InventorySlot {
  readonly tables: DataTables;
  position: SlotPosition;
  key: string | null = null;
  count: number | null = 0;
  level = 0;
  affixes: AffixInfo[] = [];
  quality = 0;
  /** 重铸次数。 */
  enchantTimes = 0;
  locked: boolean | number = false;
  legendType: string | null = null;

  constructor(tables: DataTables, position: SlotPosition) {
    this.tables = tables;
    this.position = position;
  }

  static fromJSON(tables: DataTables, position: SlotPosition, value: unknown): InventorySlot {
    return new InventorySlot(tables, position).fromJSON(value);
  }

  get goodData(): GoodData | undefined {
    return this.key === null ? undefined : this.tables.goods[this.key];
  }

  get isEnergyMaterial(): boolean {
    const data = this.goodData;
    return !!data && data.type === 'material' && !!data.energy;
  }

  get legendData(): LegendData | undefined {
    return this.legendType === null ? undefined : this.tables.legends[this.legendType];
  }

  get backgroundColor(): string | undefined {
    return this.goodData?.backgroundColor;
  }

  get nameColor(): string | undefined {
    return this.goodData?.nameColor;
  }

  get description(): string {
    if (!this.key) {
      return '';
    }
    if (this.legendData) {
      return this.legendData.itemDescription ?? '';
    }
    return this.goodData?.description ?? '';
  }

  /** 原版 `name`。 */
  get name(): string {
    if (!this.key) {
      return '';
    }
    if (this.key === 'gold') {
      return '金币';
    }
    if (this.key === 'diamonds') {
      return '神力';
    }
    if (this.legendData) {
      return this.legendData.itemName;
    }
    return this.goodData?.name ?? '';
  }

  get originName(): string | undefined {
    if (!this.legendData) {
      return undefined;
    }
    return this.goodData?.name;
  }

  get isEquip(): boolean {
    return this.goodData?.type === 'equip';
  }

  get displayQuality(): number | undefined {
    if (this.isEquip) {
      return this.quality;
    }
    if (this.goodData) {
      return this.goodData.quality ?? 0;
    }
    return undefined;
  }

  get empty(): boolean {
    return !this.key;
  }

  get price(): number {
    if (!this.key) {
      return 0;
    }
    if (this.isEquip) {
      const { level } = this;
      return ((0.01 * level * level + 1 * level) * 2 ** this.quality) | 0;
    }
    return (this.goodData?.price ?? 0) * 2 ** this.quality;
  }

  get totalPrice(): number {
    return this.price * (this.count ?? 0);
  }

  get requireLevel(): number {
    if (!this.isEquip) {
      return 0;
    }
    return transformEquipLevel(this.level);
  }

  // 基础属性计算
  get atkSpeed(): number {
    return this.goodData?.atkSpeed ?? 0;
  }

  get atk(): number {
    const { level, atkSpeed } = this;
    if (!atkSpeed) {
      return 0;
    }
    return (level / 3 + 2) / atkSpeed;
  }

  get def(): number {
    const { level, goodData } = this;
    const rate =
      (DEF_CLASS_RATE[goodData?.class ?? ''] ?? 0) *
        (DEF_POSITION_RATE[goodData?.position ?? ''] ?? 0) || 0;
    return (4 + level) * rate;
  }

  get equipPositionName(): string | undefined {
    const position = this.goodData?.position;
    return position ? EQUIP_POSITION_NAMES[position] : undefined;
  }

  get equipPositionOrder(): number | undefined {
    const position = this.goodData?.position;
    return position ? EQUIP_POSITION_ORDER[position] : undefined;
  }

  get maxHp(): number {
    const { level, goodData } = this;
    if (goodData?.class !== 'ornament') {
      return 0;
    }
    return 10 + level * 2;
  }

  get mpRecovery(): number {
    const { level, goodData } = this;
    if (!goodData?.mpRecovery) {
      return 0;
    }
    return ((level * 1.5 + 9) * goodData.mpRecovery) / 5;
  }

  get mpFromKill(): number {
    const { level, goodData } = this;
    if (!goodData?.mpFromKill) {
      return 0;
    }
    return (level * 1.5 + 9) * goodData.mpFromKill;
  }

  /** 原版 `swap`：两个格子整体互换（`position` 不变）。 */
  swap(other: InventorySlot): void {
    const temp = this.toJSON();
    this.fromJSON(other.toJSON());
    other.fromJSON(temp);
  }

  /** 原版 `clear`：注意**不重置** `position` 与 `locked`。 */
  clear(): void {
    this.key = null;
    this.count = 0;
    this.quality = 0;
    this.level = 0;
    this.enchantTimes = 0;
    this.legendType = null;
    this.affixes = [];
  }

  /** 原版 `fromJS`（逐行对齐的兜底顺序）。 */
  fromJSON(value: unknown): this {
    const raw = asRecord(value);
    this.locked = asLocked(raw.locked);
    this.key = asStringOrNull(raw.key);
    this.count = asCountOrNull(raw.count);
    this.quality = asNumber(raw.quality, 0);
    this.level = asNumber(raw.level, 0);
    this.enchantTimes = asNumber(raw.enchantTimes, 0);
    this.legendType = asStringOrNull(raw.legendType);
    if (this.isEquip && !this.level) {
      this.level = DEFAULT_LEVEL[this.key ?? ''] ?? 1;
    }
    this.affixes = asArray(raw.affixes).map((item) => new AffixInfo(this.tables).fromJSON(item));
    if (!this.key || this.count === 0) {
      this.clear();
    }
    return this;
  }

  toJSON(): InventorySlotJson {
    return {
      position: this.position,
      key: this.key,
      count: this.count,
      level: this.level,
      quality: this.quality,
      affixes: this.affixes.map((affix) => affix.toJSON()),
      enchantTimes: this.enchantTimes,
      locked: this.locked,
      legendType: this.legendType,
    };
  }
}
