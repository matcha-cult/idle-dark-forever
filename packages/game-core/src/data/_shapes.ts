/**
 * 数据层内部「视图」类型（**不属于冻结契约**，只是 `src/data/**` 的实现细节）。
 *
 * 背景：`contracts/data.ts` 把数据表函数的 `this` / `world` / `self` / hook 参数一律冻结成
 * `unknown`（这是对的：契约只描述「表里有什么」，不描述「运行时引擎提供什么」）。
 * 但 183 个原始数据文件里有近千个函数直接对这些参数做鸭子类型调用
 * （`world.sendDamage(...)` / `self.runAttrHooks(...)` / `this.unit.timeline...`）。
 *
 * 因此这里按「数据层实际访问到的最小面」逐个声明视图接口，让移植后的函数体保持原样即可通过
 * `strict` + `noUncheckedIndexedAccess` 检查；**没有使用 `any`**：
 *  - 能确定形态的成员给出具体签名；
 *  - 确实无法确定的叶值（如 buff 的第 3/4 个 hook 额外参数）收敛到 {@link HookArg} 联合。
 *
 * 边界：这些视图类型比冻结契约「更宽」，因此 `index.ts` 组装 `DataTables` 时做一次
 * 显式的 `as unknown as DataTables` 收口（见该文件注释）。
 */

import type {
  AffixData,
  BuffData,
  CareerData,
  DataTables,
  EnemyAffixData,
  EnemyData,
  GoodData,
  HookAbilityData,
  LegendData,
  LootEntry,
  MapData,
  MedicineData,
  MonsterSpawnConfig,
  SkillData,
} from '../contracts/data.js';
import type { Rng } from '../contracts/ports.js';

/** 允许携带原版额外字段（`def` / `stunResist` / `element` ...）的数据表条目。 */
export type Loose<T> = T & { [k: string]: unknown };

export type { Rng };

// ────────────────────────────── 运行时视图 ──────────────────────────────

/** 时间轴：数据层只用到这三个方法。 */
export interface TimelineLike {
  setTimeout(fn: () => void, ms?: number): unknown;
  pause(): void;
  resume(): void;
}

/**
 * buff hook 的额外参数（第 2 个及以后）。
 *
 * 原版 buff hook 的签名极不统一：`(value)` / `(val, type)` / `(value, to, damageType)` /
 * `(skill, world)`…… 这里用一个联合收敛，既覆盖实际取值，又不引入 `any`。
 */
export type HookArg = UnitLike | BuffStateLike | string | number | boolean | null | undefined;

/** buff 状态（`this` = BuffState 的场景）。 */
export interface BuffStateLike {
  /** `addBuff(type, duration, arg, group)` 传入的载荷；绝大多数是数值。 */
  arg: number;
  group?: string;
  type?: string;
  /** 剩余时间等由引擎维护，数据层只读。 */
  level?: number;
  stopped?: boolean;
  skill?: unknown;
  targetBuff: BuffStateLike | null;
  unit: UnitLike;
  over(): void;
  resetTimer(ms: number): void;
}

/** 技能状态（`this` = SkillState 的场景）。 */
export interface SkillStateLike {
  unit: UnitLike;
  /** 施法者（召唤物的技能状态上才有）。 */
  summoner?: UnitLike | null;
  skillData?: SkillData;
  reduceCoolDown(ms: number): void;
  runAttrHooks<T>(value: T, name: string, ...extra: HookArg[]): T;
}

/** 单位（`this` = Unit / `self` / `world.units[*]` 的场景）。 */
export interface UnitLike {
  // 身份
  type: string;
  key?: string;
  name?: string;
  camp: string;
  race?: string;
  career?: string;
  level: number;
  // 属性
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  rp: number;
  maxRp?: number;
  ep?: number;
  maxEp?: number;
  atk: number;
  def: number;
  dmgAdd: number;
  critRate: number;
  critBonus: number;
  comboPoint: number;
  rpOnAttack: number;
  rpOnAttacked: number;
  leech?: number;
  stunResist?: number;
  coldAbsorb?: number;
  fireAbsorb?: number;
  iceAbsorb?: number;
  lightningAbsorb?: number;
  darkAbsorb?: number;
  allResist?: number;
  // 关系
  target: UnitLike | null;
  summoner?: UnitLike | null;
  player?: UnitLike;
  buffs: BuffStateLike[];
  skills: SkillStateLike[];
  /** 刺客连击（`combos`）由技能系统在运行时挂上。 */
  combos: ComboLike[];
  timeline: TimelineLike;
  // 方法
  addBuff(type: string, duration?: number | null, arg?: number | null, group?: string | null): BuffStateLike;
  removeBuff(buff: BuffStateLike): void;
  hasBuff(type: string): boolean;
  canAttack(unit: UnitLike): boolean;
  willAttack(unit: UnitLike): boolean;
  willAssist(unit: UnitLike): boolean;
  runAttrHooks<T>(value: T, name: string, ...extra: HookArg[]): T;
  kill(all?: boolean): void;
  stun(ms: number, type?: string, force?: boolean): void;
  startRead(type: string, ms: number, arg?: HookArg, skillState?: SkillStateLike): void;
  breakCasting(): void;
  transformType(type: string): void;
  testCrit(rate?: number): boolean;
  getCritBonus(crit?: boolean, bonus?: number): number;
  getSkillLevel(key: string): number;
  summonSkill(key: string, level?: number): void;
  setCamp(camp: string): void;
  tryUseSkill(state?: SkillStateLike): void;
  canUseSkill(): SkillStateLike;
  addBuffAtk?(type: string): void;
  reduceCoolDown?(ms: number): void;
}

/** 刺客连击对象。 */
export interface ComboLike {
  value: number;
  effect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void;
  postEffect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void;
}

/** 一次攻击的结算上下文（`finalAttack`）。 */
export interface AttackLike {
  dmg: number;
  critRate: number;
  critBonus: number;
  isCrit: boolean;
}

/** 世界（所有 `world` 参数）。 */
export interface WorldLike {
  units: UnitLike[];
  playerUnit: UnitLike;
  map: MapData;
  time?: number;
  addEnemy(type: string, arg?: HookArg, level?: number, summoner?: UnitLike | null): UnitLike;
  removeUnit(unit: UnitLike): void;
  sendDamage(type: string, from: UnitLike | null, to: UnitLike | null, skill: unknown, value: number, crit?: boolean): void;
  sendHeal(from: UnitLike | null, to: UnitLike | null, skill: unknown, value: number): void;
  sendSkillUsage(self: UnitLike, targets: UnitLike[] | null, state: SkillStateLike | unknown): void;
  sendGeneralMsg(msg: string): void;
  testDodge(from: UnitLike, to: UnitLike | null, state: SkillStateLike | unknown): boolean;
}

// ────────────────────────────── hook 签名 ──────────────────────────────

/**
 * 单位属性 hook：`(effect, value) => newValue`。
 * 注意原版 `affixes.hooks` / `medicines.hooks` / `enemies.hooks` 等参数表不同，
 * 见下面各条目类型里的逐条声明。
 */
export type UnitAttrHook = (this: UnitLike, effect: number, value: number, ...extra: HookArg[]) => number;
export type UnitAttrHooks = Record<string, UnitAttrHook>;

/** `enemies.hooks` / `enemyAffixes.hooks`：`(world, value, ...) => value`。 */
export type UnitWorldHook = (this: UnitLike, world: WorldLike, value: number, ...extra: HookArg[]) => number;
export type UnitWorldHooks = Record<string, UnitWorldHook>;

/** `buffs.hooks`：`(value, ...) => value`，`this` = BuffState。 */
export type BuffHook = (this: BuffStateLike, value: number, ...extra: HookArg[]) => number;
export type BuffHooks = Record<string, BuffHook>;

/** `skills.cost` 的单项：原版既可能是数字，也可能是 `(self) => number`。 */
export type SkillCostEntry = number | ((self: UnitLike) => number);
export type SkillCostKey = 'hp' | 'mp' | 'rp' | 'ep' | 'comboPoint';

/** 掉落条目（允许原版额外字段）。 */
export type Loot = Loose<LootEntry>;

/** 怪物刷新配置（允许原版额外字段）。 */
export type SpawnConfig = Loose<MonsterSpawnConfig>;

// ────────────────────────────── 各表条目类型 ──────────────────────────────

export type CareerEntry = Loose<CareerData> & {
  expFormula: number[];
};

export type RoleEntry = Loose<Omit<DataTables['roles'][string], 'startup'>> & {
  startup?: DataTables['roles'][string]['startup'];
};

export type GoodEntry = Loose<GoodData> & {
  loots?: Loot[];
};

export type RangeValue = string | number | [number, number];

export type AffixEntry = Loose<Omit<AffixData, 'generate' | 'range' | 'hooks' | 'weight'>> & {
  /** 原版 27 条词缀里只有 9 条写了 `weight`，契约却把它标成必填。 */
  weight?: number;
  generate: (level: number, rng: Rng) => number;
  /** 原版 \`range(level)\` 返回「11~31」这类**展示字符串**，与契约的 [min,max] 不符。 */
  range?: (level: number) => RangeValue;
  hooks?: UnitAttrHooks;
};

export type LegendEntry = Loose<Omit<LegendData, 'generate' | 'range'>> & {
  generate: (level: number, rng: Rng) => number;
  /** 同 {@link AffixEntry.range}。 */
  range?: (level: number) => RangeValue;
};

export type EnemyAffixEntry = Loose<Omit<EnemyAffixData, 'hooks'>> & {
  hooks: UnitWorldHooks;
};

/** 敌人 / 技能引用的技能列表项。 */
export interface SkillRef {
  key: string;
  level: number;
}

export type EnemyEntry = Loose<Omit<EnemyData, 'hooks' | 'loots' | 'skills'>> & {
  skills: SkillRef[];
  hooks?: UnitWorldHooks;
  loots?: Loot[];
  /** 原版召唤元素「II 型」扩展技能表。 */
  v2Skills?: SkillRef[];
};

export type BuffEntry = Loose<Omit<BuffData, 'description' | 'effectInterval' | 'effect' | 'hooks' | 'willAppear' | 'didAppear' | 'willRemove' | 'didRemove' | 'onOver'>> & {
  description?: string | ((this: BuffStateLike, arg: HookArg, level: number) => string);
  effectInterval?: number | ((this: BuffStateLike, level: number) => number);
  effect?: (this: BuffStateLike, world: WorldLike) => void;
  hooks?: BuffHooks;
  willAppear?: (this: BuffStateLike, world: WorldLike) => void;
  didAppear?: (this: BuffStateLike, world: WorldLike) => void;
  willRemove?: (this: BuffStateLike, world: WorldLike) => void;
  didRemove?: (this: BuffStateLike, world: WorldLike) => void;
  onOver?: (this: BuffStateLike, world: WorldLike) => void;
};

export type SkillEntry = Loose<Omit<SkillData, 'description' | 'cost' | 'canUse' | 'shouldUse' | 'effect' | 'coolDown' | 'cost'>> & {
  description?: string | ((level: number, self: UnitLike) => string);
  cost?: Partial<Record<SkillCostKey, SkillCostEntry>> | ((level: number) => Partial<Record<SkillCostKey, SkillCostEntry>>);
  coolDown?: number | ((level: number) => number);
  canUse?: (this: SkillStateLike, world: WorldLike, self: UnitLike, level: number) => boolean;
  shouldUse?: (this: SkillStateLike, world: WorldLike, self: UnitLike, level: number) => boolean;
  effect: (this: SkillStateLike, world: WorldLike, self: UnitLike, level: number) => void;
};

export type MedicineEntry = Loose<Omit<MedicineData, 'hooks'>> & {
  hooks: Record<string, (this: UnitLike, level: number, value: number) => number>;
};

export type HookAbilityEntry = Loose<Omit<HookAbilityData, 'hooks'>> & {
  hooks: UnitWorldHooks;
};

/** 地图阶段里的怪物项：原版既支持 `type` 也支持 `types` 权重表。 */
export interface PhaseMonster extends SpawnConfig {
  type?: string;
  types?: Record<string, number>;
}

export interface MapPhase {
  description: string;
  monsters: PhaseMonster[];
}

export type MapEntry = Loose<Omit<MapData, 'monsters' | 'phases' | 'loots'>> & {
  monsters?: SpawnConfig[];
  phases?: MapPhase[];
  loots?: Loot[];
};

export type StoryEntry = DataTables['stories'][string];

/** 各表条目类型的查表（供 `packages/*` 的 `define` / `extend` 泛型使用）。 */
export interface DataEntryMap {
  careers: CareerEntry;
  roles: RoleEntry;
  maps: MapEntry;
  enemies: EnemyEntry;
  skills: SkillEntry;
  goods: GoodEntry;
  passives: HookAbilityEntry;
  enhances: HookAbilityEntry;
  buffs: BuffEntry;
  affixes: AffixEntry;
  enemyAffixes: EnemyAffixEntry;
  stories: StoryEntry;
  legends: LegendEntry;
  medicines: MedicineEntry;
}

/** 只包含「Record<key, 条目>」的表名。 */
export type DictTableName = keyof DataEntryMap;
