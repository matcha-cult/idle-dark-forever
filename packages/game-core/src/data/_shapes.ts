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
  AnnouncementData,
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
 * buff hook 的额外参数（第 2 个及以后）的兜底联合：原版签名差异极大
 * （`(value)` / `(val, type)` / `(value, to, damageType)` / `(skill, world)`……）。
 */
export type HookArg = UnitLike | BuffStateLike | SkillStateLike | string | number | boolean | number[] | null | undefined;

/**
 * 原版 hook 的 `value` 参数在少数条目里承载的是「单位」而不是数值
 * （如 `legends.hooks: { killed(effect, unit) }`、`enhances.hooks: { postCostComboPoint(world, value) }`）。
 *
 * 这里用交叉类型让「按数值运算」和「按单位访问」两种写法同时成立，
 * 而不是把参数退化成 `any`；引擎实际传入的是数值，数据层从不写它。
 */
export type HookNumber = number & UnitLike;

/**
 * buff hook 的第 2/3 个参数在同一个字段名下混用了「来源单位」「世界」「伤害/类型字符串」三种语义
 * （`(val, from)` / `(skill, world)` / `(val, type)`）。同样用交叉类型收敛。
 */
export type HookExtra = UnitLike & WorldLike & string;

/** 施法/读条中的技能（原版 `unit.casting` / `unit.reading`）。 */
export interface CastingLike {
  notBreakable?: boolean;
  skill?: CastingLike | null;
  [k: string]: unknown;
}

/** buff 状态（`this` = BuffState 的场景）。 */
export interface BuffStateLike {
  /** `addBuff(type, duration, arg, group)` 传入的载荷；绝大多数是数值，个别是字符串/数组。 */
  arg: number;
  group?: string;
  type?: string;
  level?: number;
  stopped?: boolean;
  skill?: unknown;
  targetBuff: BuffStateLike | null;
  unit: UnitLike;
  over(...extra: HookArg[]): void;
  resetTimer(ms?: number): void;
  remove(): void;
}

/** 技能状态（`this` = SkillState 的场景）。 */
export interface SkillStateLike {
  unit: UnitLike;
  /** 施法者（召唤物的技能状态上才有）。 */
  summoner: UnitLike;
  skillData: Loose<SkillData>;
  notBreakable?: boolean;
  reduceCoolDown(ms: number): void;
  runAttrHooks(value: number, name: string, ...extra: HookArg[]): number;
  runAttrHooks(value: boolean, name: string, ...extra: HookArg[]): boolean;
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
  str: number;
  dex: number;
  int: number;
  sta: number;
  atk: number;
  def: number;
  dmgAdd: number;
  critRate: number;
  critBonus: number;
  comboPoint: number;
  rpOnAttack: number;
  rpOnAttacked: number;
  atkSpeed: number;
  leech: number;
  stunResist: number;
  coldAbsorb: number;
  fireAbsorb: number;
  iceAbsorb: number;
  lightningAbsorb: number;
  darkAbsorb: number;
  allResist: number;
  // 施法 / 读条状态
  reading: CastingLike | null;
  casting: CastingLike | null;
  stopped: boolean;
  // 关系
  /** 原版 `self.target` 在函数体内被直接解引用（只在 `canUse` 里判空），因此这里不标 null。 */
  target: UnitLike;
  summoner: UnitLike;
  player: UnitLike;
  buffs: BuffStateLike[];
  skills: SkillStateLike[];
  /** 刺客连击（`combos`）由技能系统在运行时挂上。 */
  combos: ComboLike[];
  timeline: TimelineLike;
  // 方法
  addBuff(type: string, duration?: number | null, arg?: HookArg, group?: string | null, ...extra: HookArg[]): BuffStateLike;
  removeBuff(buff: HookArg): void;
  hasBuff(type: string): boolean;
  canAttack(unit: UnitLike): boolean;
  willAttack(unit: UnitLike): boolean;
  willAssist(unit: UnitLike): boolean;
  runAttrHooks(value: number, name: string, ...extra: HookArg[]): number;
  runAttrHooks(value: boolean, name: string, ...extra: HookArg[]): boolean;
  runAttrHooks(value: null, name: string, ...extra: HookArg[]): BuffStateLike | null;
  runAttrHooks<T>(value: T, name: string, ...extra: HookArg[]): T;
  kill(all?: boolean, ...extra: HookArg[]): void;
  stun(ms: number, type?: string, force?: boolean, ...extra: HookArg[]): boolean;
  startRead(type: string, ms: number, arg?: HookArg, skillState?: SkillStateLike): void;
  breakCasting(): void;
  transformType(type: string): void;
  testCrit(rate?: number, ...extra: HookArg[]): boolean;
  getCritBonus(crit?: HookArg, bonus?: number): number;
  getSkillLevel(key: string): number;
  /** 原版里 `summonSkill` 既是方法（`unit.summonSkill('x')`）又会被当成技能状态读 `.skillData`。 */
  summonSkill: ((key: string, level?: number) => void) & { skillData: Loose<SkillData>; notBreakable?: boolean };
  useExtraSkill(key: string): void;
  setCamp(camp: string): void;
  setTarget(target: UnitLike | null): void;
  findTarget(): UnitLike | null;
  tryUseSkill(state?: SkillStateLike): void;
  setCleanTimer(ms?: number): void;
  canUseSkill(): SkillStateLike;
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
  atkAdd?: number | null;
  isCrit?: boolean;
}

/**
 * 单位列表：原版给数组挂了 `remove`，且 `find` 的结果在数据层被直接解引用
 * （不看 `undefined`），所以这里把 `find` 重载成必然返回单位。
 */
export interface UnitList extends Array<UnitLike> {
  remove(unit: UnitLike): void;
  find(predicate: (value: UnitLike, index: number, obj: UnitLike[]) => unknown, thisArg?: unknown): UnitLike;
}

/** 世界（所有 `world` 参数）。 */
export interface WorldLike {
  units: UnitList;
  playerUnit: UnitLike;
  /** 当前地图 **key**（原版 `world.map` 是字符串，不是 MapData）。 */
  map: string;
  time?: number;
  addEnemy(type: string, arg?: HookArg, level?: number, summoner?: UnitLike | null, ...extra: HookArg[]): UnitLike;
  removeUnit(unit: UnitLike): void;
  sendDamage(type: string, from: UnitLike | null | undefined, to: UnitLike | null | undefined, skill: unknown, value: number, crit?: boolean | number, ...extra: HookArg[]): void;
  sendHeal(from: UnitLike | null | undefined, to: UnitLike | null | undefined, skill?: unknown, value?: number): void;
  sendSkillUsage(self: UnitLike, targets?: UnitLike[] | null, state?: SkillStateLike | unknown): void;
  sendGeneralMsg(msg: string): void;
  testDodge(from: UnitLike, to: UnitLike | null | undefined, state?: SkillStateLike | unknown): boolean;
}

// ────────────────────────────── hook 签名 ──────────────────────────────

/**
 * 单位属性 hook：`(effect, value) => newValue`。
 * 注意原版 `affixes.hooks` / `medicines.hooks` / `enemies.hooks` 等参数表不同，
 * 见下面各条目类型里的逐条声明。
 */
export type UnitAttrHook = (
  this: UnitLike,
  effect: number,
  value: HookNumber,
  target?: UnitLike,
  damageType?: string,
  source?: string,
) => number | boolean | void;
export type UnitAttrHooks = Record<string, UnitAttrHook>;

/** `enemies.hooks` / `enemyAffixes.hooks` / `passives.hooks` / `enhances.hooks`：`(world, value, ...) => value`。 */
export type UnitWorldHook = (
  this: UnitLike,
  world: WorldLike,
  value: number,
  target: UnitLike,
  damageType: string,
) => number | boolean | string;
export type UnitWorldHooks = Record<string, UnitWorldHook>;

/** `buffs.hooks`：`(value, ...) => value`，`this` = BuffState。原版返回值有数字 / 布尔 / 甚至 `this`。 */
export type BuffHook = (this: BuffStateLike, value: HookNumber, source: HookExtra, damageType: HookExtra) => unknown;
export type BuffHooks = Record<string, BuffHook>;

/** `skills.cost` 的单项：原版既可能是数字，也可能是 `(self) => number`。 */
export type SkillCostEntry = number | ((self: UnitLike) => number);
export type SkillCostKey = 'hp' | 'mp' | 'rp' | 'ep' | 'comboPoint';

/** 掉落条目（允许原版额外字段；`maxLevel` 在原版用的是 `{ type, value }` 而不是 `count`）。 */
export type Loot = Loose<LootEntry> | Loose<{ type: 'maxLevel'; value: number; rate?: number }>;

/** 怪物刷新配置（允许原版额外字段）。 */
export type SpawnConfig = Loose<MonsterSpawnConfig>;

// ────────────────────────────── 各表条目类型 ──────────────────────────────

export type CareerEntry = Loose<CareerData> & {
  expFormula: number[];
};

export type RoleEntry = Loose<Omit<DataTables['roles'][string], 'startup'>> & {
  startup?: DataTables['roles'][string]['startup'];
};

export type GoodEntry = Loose<Omit<GoodData, 'price'>> & {
  /** 契约把 `price` 标成必填，但原版 94 件物品里有 59 件（全部装备）没写。 */
  price?: number;
  loots?: Loot[];
};

export type AnnouncementEntry = Loose<AnnouncementData>;

export type RangeValue = string | number | [number, number];

export type AffixEntry = Loose<Omit<AffixData, 'generate' | 'range' | 'hooks' | 'weight'>> & {
  /** 原版 27 条词缀里只有 9 条写了 `weight`，契约却把它标成必填。 */
  weight?: number;
  generate: (level: number, rng: Rng) => number;
  /** 原版 \`range(level)\` 返回「11~31」这类**展示字符串**，与契约的 [min,max] 不符。 */
  range?: (level: number) => RangeValue;
  hooks?: UnitAttrHooks;
};

export type LegendEntry = Loose<Omit<LegendData, 'generate' | 'range' | 'hooks'>> & {
  generate: (level: number, rng: Rng) => number;
  /** 同 {@link AffixEntry.range}。 */
  range?: (level: number) => RangeValue;
  hooks?: UnitAttrHooks;
};

export type EnemyAffixEntry = Loose<Omit<EnemyAffixData, 'hooks'>> & {
  hooks: UnitWorldHooks;
};

/** 敌人 / 技能引用的技能列表项。 */
export interface SkillRef {
  key: string;
  level: number;
}

export type EnemyEntry = Loose<
  Omit<EnemyData, 'hooks' | 'loots' | 'skills' | 'buffs' | 'onPress' | 'maxHp' | 'atk' | 'atkSpeed' | 'exp' | 'level'>
> & {
  /** 契约把这 5 个数值标成必填，但原版里大量剧情/图腾单位只写其中一部分。 */
  maxHp?: number;
  atk?: number;
  atkSpeed?: number;
  exp?: number;
  level?: number;
  skills?: SkillRef[];
  hooks?: UnitWorldHooks;
  loots?: Loot[];
  /** 原版既有 `string[]`，也有 `{ type }[]`（`simba.goodFriends` 这类带参 buff）。 */
  buffs?: Array<string | { type: string }>;
  onPress?: (this: UnitLike, world: WorldLike) => unknown;
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

export type SkillEntry = Loose<
  Omit<
    SkillData,
    'description' | 'cost' | 'canUse' | 'shouldUse' | 'effect' | 'coolDown' | 'isAttack' | 'group' | 'antiBreak' | 'maxExp'
  >
> & {
  /** 契约把 `isAttack` / `group` 标成必填，但原版不少技能（被动触发的敌方技能）没写。 */
  isAttack?: boolean;
  group?: string;
  /** 契约写的是 `boolean`，原版实际用的是 0~1 的抗打断概率。 */
  antiBreak?: boolean | number;
  description?: string | ((level: number, self: UnitLike) => string);
  /** 契约把 `maxExp` 标成必填，但原版有 30 条技能没写（敌方/被动技能）。 */
  maxExp?: (level: number) => number;
  cost?: Partial<Record<SkillCostKey, SkillCostEntry>> | ((level: number) => Partial<Record<SkillCostKey, SkillCostEntry>>);
  coolDown?: number | ((level: number, unit: UnitLike) => number);
  canUse?: (this: SkillStateLike, world: WorldLike, self: UnitLike, level: number) => boolean;
  shouldUse?: (this: SkillStateLike, world: WorldLike, self: UnitLike, level: number) => boolean;
  effect: (this: SkillStateLike, world: WorldLike, self: UnitLike, level: number) => void;
};

export type MedicineEntry = Loose<Omit<MedicineData, 'hooks'>> & {
  hooks: Record<string, (this: UnitLike, level: number, value: number) => number>;
};

export type HookAbilityEntry = Loose<Omit<HookAbilityData, 'hooks'>> & {
  /** 原版有 2 条强化没有 hooks（纯展示项）。 */
  hooks?: UnitWorldHooks;
};

/** 地图阶段里的怪物项：原版既支持 `type` 也支持 `types` 权重表。 */
export interface PhaseMonster extends Omit<SpawnConfig, 'delay' | 'max'> {
  type?: string;
  types?: Record<string, number>;
  /** 契约把 `delay` / `max` 标成必填，但原版 BOSS 阶段只写 `{ type, total }`。 */
  delay?: number;
  max?: number;
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

export type StoryEntry = Loose<Omit<DataTables['stories'][string], 'taskType' | 'awards' | 'group' | 'name'>> & {
  /** 原版 33 条剧情里只有 17 条带 taskType、2 条带 awards。 */
  taskType?: 'kill' | 'purchase';
  awards?: DataTables['stories'][string]['awards'];
  /** `data/stories/purchaseRates.js` 两条只有 key + script + requirement。 */
  group?: string;
  name?: string;
};

/** 各表条目类型的查表（供 `packages/*` 的 `define` / `extend` 泛型使用）。 */
export interface DataEntryMap {
  announcement: AnnouncementEntry;
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
