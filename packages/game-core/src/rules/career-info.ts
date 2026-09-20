/**
 * `CareerInfo` —— 原版 `player.js:175-253` 的移植。
 *
 * 去 MobX：`@observable`/`@computed` → 普通字段 + getter；
 * `expFormula` 从注入的 `DataTables` 读取（不 import `src/data/`）。
 */

import type { DataTables } from '../contracts/data.js';
import { EQUIP_POSITIONS, type EquipPosition } from '@idle-dark/protocol';
import { asNumber, asRecord, asStringArray, asTruthyNumber } from './player-meta.js';
import { InventorySlot, type InventorySlotJson } from './inventory-slot.js';

/**
 * 装备槽（**9 个**，P2）。
 *
 * 类型与顺序的唯一真相在 `@idle-dark/protocol` 的 `equip.ts`（前后端共用同一份）；
 * 这里只做别名导出，避免第 4 份重复定义。
 */
export type EquipSlot = EquipPosition;

export const EQUIP_SLOTS: readonly EquipSlot[] = EQUIP_POSITIONS;

export interface CareerInfoJson {
  type: string;
  exp: number;
  level: number;
  peakExp: number;
  peakLevel: number;
  maxLevel: number;
  equipments: Record<EquipSlot, InventorySlotJson>;
  selectedSkills: string[];
  selectedEnhances: string[];
}

/** 原版 `player.js:175-253`：单职业的等级 / 巅峰 / 装备 / 已选技能。 */
export class CareerInfo {
  readonly tables: DataTables;
  type: string;
  /** 经验值。 */
  exp = 0;
  level = 1;
  peakExp = 0;
  peakLevel = 0;
  maxLevel = 60;
  equipments: Record<EquipSlot, InventorySlot>;
  selectedSkills: string[] = [];
  selectedEnhances: string[] = [];

  constructor(tables: DataTables, type = '') {
    this.tables = tables;
    this.type = type;
    this.equipments = Object.fromEntries(
      EQUIP_SLOTS.map((slot) => [slot, new InventorySlot(tables, 'equip')]),
    ) as Record<EquipSlot, InventorySlot>;
  }

  static fromJSON(tables: DataTables, type: string, value: unknown): CareerInfo {
    return new CareerInfo(tables, type).fromJSON(value);
  }

  /** 原版 `maxExp`：`expFormula.map((v, i) => v * level ** i)` 求和。 */
  get maxExp(): number {
    const career = this.tables.careers[this.type];
    if (!career) {
      // 原版会 `console.warn` 后返回 10000000；这里静默返回同一数值（日志走 Logger 端口，规则层不持有）
      return 10000000;
    }
    return career.expFormula.map((v, i) => v * this.level ** i).reduce((a, b) => a + b, 0);
  }

  /** 原版 `maxPeakExp`：把 `peakLevel + 60` 代回同一条多项式。 */
  get maxPeakExp(): number {
    const career = this.tables.careers[this.type];
    if (!career) {
      return 10000000;
    }
    const level = this.peakLevel + 60;
    return career.expFormula.map((v, i) => v * level ** i).reduce((a, b) => a + b, 0);
  }

  /** 原版 `CareerInfo.fromJS`。 */
  fromJSON(value: unknown): this {
    const raw = asRecord(value);
    this.exp = asNumber(raw.exp, 0);
    // 原版是 `v.level || 1` / `v.maxLevel || 60`：0 也要落到默认值
    this.level = asTruthyNumber(raw.level, 1);
    this.peakExp = asNumber(raw.peakExp, 0);
    this.peakLevel = asNumber(raw.peakLevel, 0);
    this.maxLevel = asTruthyNumber(raw.maxLevel, 60);

    if (raw.equipments) {
      const equipments = asRecord(raw.equipments);
      for (const slot of EQUIP_SLOTS) {
        this.equipments[slot].fromJSON(equipments[slot] ?? {});
      }
    }

    const career = this.tables.careers[this.type];
    // 原版：`v.selectedSkills` 为假值（undefined/null）时保留旧值；这里保持同样的「只在有值时覆盖」
    if (raw.selectedSkills != null) {
      const selected = asStringArray(raw.selectedSkills);
      // 原版会因 `careers[this.type]` 缺失而 TypeError；这里退化为「清空选择」
      this.selectedSkills = career ? selected.filter((key) => !!career.skills[key]) : [];
    }
    if (raw.selectedEnhances != null) {
      const selected = asStringArray(raw.selectedEnhances);
      this.selectedEnhances = career ? selected.filter((key) => !!career.enhances[key]) : [];
    }
    return this;
  }

  toJSON(): CareerInfoJson {
    return {
      type: this.type,
      exp: this.exp,
      level: this.level,
      peakExp: this.peakExp,
      peakLevel: this.peakLevel,
      maxLevel: this.maxLevel,
      equipments: Object.fromEntries(
        EQUIP_SLOTS.map((slot) => [slot, this.equipments[slot].toJSON()]),
      ) as Record<EquipSlot, InventorySlotJson>,
      selectedSkills: [...this.selectedSkills],
      selectedEnhances: [...this.selectedEnhances],
    };
  }
}
