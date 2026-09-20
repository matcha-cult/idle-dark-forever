/**
 * `PlayerMeta` 与「存档隐式兼容」工具 + 等级换算函数。
 *
 * ## 为什么 helper 放在这里
 *
 * 原版 `fromJS` 是**极其宽松**的：`v.exp || 0`、`v.locked || 0`、`v.count ? Math.ceil(v.count) : null`……
 * 服务端导入 2016 年的旧存档时必须保留这套「缺失字段兜底」语义。把兜底逻辑收敛成
 * 一组显式 helper，可以让每个模型的 `fromJSON` 一眼看出「原版写了什么」。
 *
 * 与原版 `v.x || fallback` 的对齐程度：
 * - `undefined` / `null` / `''` / `NaN` → fallback（原版假值分支）；
 * - `0` → 0（原版也是 0）；
 * - 负数 / `Infinity` → 原值（原版是原值，保留以免引入额外语义）；
 * - 字符串数字（`'5'`）→ **不再**被隐式转成数字（原版 `Math.ceil('5')` 会转）。
 *   这是刻意收紧：JSON 存档里的数值本来就是 number，字符串数字只可能来自损坏数据。
 */

import type { CareerData, DataTables, RoleData } from '../contracts/data.js';

// ────────────────────────────── JSON 兜底 helper ──────────────────────────────

/** 取对象视图；非对象（含 null / 数组）返回 `{}`。 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Map)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** 取数组视图；非数组返回 `[]`。 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `typeof number && !NaN` 才采信，否则 fallback。 */
export function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

/**
 * 精确对齐原版 `v.x || fallback`（fallback 非 0 时必须用它，而不是 {@link asNumber}）。
 *
 * 差别就在 `0`：`v.level || 1` 会把 `0`/`NaN`/`undefined` **全部**变成 1，
 * 而 `asNumber(v.level, 1)` 会把 `0` 原样保留。
 * 原版受影响的字段：`CareerInfo.level`(1) / `CareerInfo.maxLevel`(60) / `Player.timestamp`(Date.now)。
 */
export function asTruthyNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && value !== 0 && !Number.isNaN(value) ? value : fallback;
}

/** 数字或 `null`。 */
export function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

/** 非空字符串才算命中，否则 fallback（对应原版 `v.x || fallback`）。 */
export function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** 非空字符串或 `null`。 */
export function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 原版 `v.locked || 0`：布尔保持布尔，数字保持数字，其余（含 undefined）→ 0。
 */
export function asLocked(value: unknown): boolean | number {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  return 0;
}

/**
 * 原版 `v.count ? Math.ceil(v.count) : null`。
 *
 * ⚠️ 结果类型是 `number | null`（不是 0）：这是原版 `InventorySlot.count` 的真实形状，
 * `null` 在下游用 `!slot.count` / `slot.count === 0` 判断时都是假值。
 */
export function asCountOrNull(value: unknown): number | null {
  const num = asNumberOrNull(value);
  if (num === null || num === 0) {
    return null;
  }
  return Math.ceil(num);
}

/**
 * 把 Map / ObservableMap 形态 / 普通对象统一成 `[key, value]` 列表。
 *
 * 原版 `fromJS` 同时接受 MobX `ObservableMap` 与普通对象；移植后额外支持 `Map`
 * （服务端内存快照用 Map，落库 JSON 用普通对象）。
 */
export function entriesOf(value: unknown): Array<[string, unknown]> {
  if (value instanceof Map) {
    const out: Array<[string, unknown]> = [];
    for (const [key, item] of value.entries()) {
      out.push([String(key), item]);
    }
    return out;
  }
  if (Array.isArray(value)) {
    const out: Array<[string, unknown]> = [];
    value.forEach((item, index) => out.push([String(index), item]));
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const out: Array<[string, unknown]> = [];
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out.push([key, (value as Record<string, unknown>)[key]]);
    }
    return out;
  }
  return [];
}

/** 字符串数组视图（过滤非字符串项），对应原版对 `selectedSkills` 的处理。 */
export function asStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

// ────────────────────────────── 等级换算（原样移植） ──────────────────────────────

/** 原版 `player.js:106-117`。装备「内部等级」→ 需求等级。 */
export function transformEquipLevel(level: number): number {
  if (level <= 120) {
    return Math.ceil(level / 2);
  }
  if (level <= 180) {
    return 60;
  }
  if (level <= 210) {
    return Math.ceil(level / 3);
  }
  return 70;
}

/** 原版 `player.js:119-127`。需求等级 → 装备「内部等级」。 */
export function untransformEquipLevel(level: number): number {
  if (level < 60) {
    return level * 2;
  } else if (level < 70) {
    return level * 3;
  } else {
    return 250;
  }
}

// ────────────────────────────── PlayerMeta ──────────────────────────────

export interface PlayerMetaJson {
  key: string;
  role: string;
  currentCareer: string | null;
  currentCareerLevel: number;
}

/** 原版 `player.js:546-587`。角色「轻量元数据」（角色选择列表用）。 */
export class PlayerMeta {
  readonly tables: DataTables;
  key: string;
  role = 'Eyer';
  currentCareer: string | null = null;
  currentCareerLevel = 0;

  constructor(tables: DataTables, key: string) {
    this.tables = tables;
    this.key = key;
  }

  get roleData(): RoleData | undefined {
    return this.tables.roles[this.role];
  }

  get name(): string {
    return this.roleData?.name ?? '';
  }

  get careerData(): CareerData | undefined {
    return this.currentCareer === null ? undefined : this.tables.careers[this.currentCareer];
  }

  get careerName(): string | undefined {
    return this.careerData?.name;
  }

  /**
   * 原版 `PlayerMeta.fromJS`：缺失字段兜底 + `currentCareer` 回落到角色默认职业。
   *
   * 注：这里**不提供** `static fromJSON`——`Player extends PlayerMeta`，
   * 子类静态工厂签名（多出 `now` / `account`）会与基类静态侧不兼容（TS2417）。
   * 统一走 `new PlayerMeta(tables, key).fromJSON(v)` 与 `Player.fromJSON(tables, key, now, v, account?)`。
   */
  fromJSON(value: unknown): this {
    const raw = asRecord(value);
    this.role = asString(raw.role, 'Eyer');
    this.currentCareer =
      asStringOrNull(raw.currentCareer) ?? this.roleData?.defaultCareer ?? null;
    this.currentCareerLevel = asNumber(raw.currentCareerLevel, 0);
    return this;
  }

  toJSON(): PlayerMetaJson {
    return {
      key: this.key,
      role: this.role,
      currentCareer: this.currentCareer,
      currentCareerLevel: this.currentCareerLevel,
    };
  }
}
