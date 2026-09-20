/**
 * 游戏数据表类型契约（**冻结**：并行开发期间禁止改动已有字段，新增请用可选字段）。
 *
 * 数据来源：原版《永夜2016典藏重置版》`data/**`（183 个 JS 文件，其中 37 个内嵌函数）。
 *
 * 重要事实：
 * 1. 数据表**混入行为**——`generate` / `hooks` / `effect` / `canUse` 都是函数，属于规则而非可下发配置。
 *    因此本包由服务端独占，前端只消费 `@idle-dark/protocol` 的 DTO 投影。
 * 2. 原版 `data/packages/*` 通过 `util.extend` **原地改写全局注册表**（import 顺序即行为）。
 *    移植后必须改为显式 `register*(tables)` 组合，禁止模块级副作用。
 * 3. hook 的 `this` 绑定不统一，见每个 Hook 类型的注释；移植时逐条对齐，禁止隐式 any。
 */

import type { EquipCategory, EquipPosition, Quality } from '@idle-dark/protocol';
import type { Rng } from './ports.js';

// ────────────────────────────── 通用 ──────────────────────────────

/** 属性 hook：`(effect, value) => newValue`，`this` = 单位（Unit）。 */
export type AttrHook = (this: unknown, effect: number, value: number, ...extra: unknown[]) => number;

/** 属性表：属性名 → hook 列表。 */
export type AttrHooks = Record<string, AttrHook>;

/** 掉落条目：要么是具体物品 key，要么是特殊类型（装备/钥匙/满级/传奇）。 */
export type LootEntry =
  | {
      key: string;
      rate: number;
      count: [number, number] | number;
      mfRate?: number;
      qualityRate?: number;
      /** 掉落等级门槛。判定等级 = **min(怪物等级, 地图等级)**（用户口径）。 */
      minLevel?: number;
      maxLevel?: number;
    }
  | { type: 'equip'; rate: number; mfRate?: number; qualityRate?: number; position?: string; minLevel?: number; maxLevel?: number }
  | { type: 'specialEquip'; rate: number; items: string[]; mfRate?: number }
  | { type: 'maxLevel'; rate: number; count: [number, number] };

// ────────────────────────────── 物品 ──────────────────────────────

export interface GoodData {
  key: string;
  type: 'equip' | 'material' | 'junk' | 'package';
  name: string;
  description?: string;
  /** 装备大类（sword/dagger/cloth/armor/ornament/base…）。 */
  class?: string;
  position?: EquipPosition;
  /**
   * 装备类别（P2 + §2.3）：主手武器 `oneHand | twoHandMelee | bow`，
   * 副手专属 `shield | quiver`。判定表见 `@idle-dark/protocol` 的 `canEquipOffHand`。
   */
  equipCategory?: EquipCategory;
  quality?: Quality;
  /** 可堆叠上限；不可堆叠为 undefined。 */
  stack?: number;
  /**
   * 是否为**钱包物品**（R1）：通货 / 精华 / 将来的「一般等价物」不占背包格，
   * 由 `Player.loot` 计入 `Player.wallet`（无容量上限）。
   *
   * ⚠️ 混沌钥石（PoE 式地图物品）**不是**钱包物品，仍走背包。
   */
  wallet?: boolean;
  price: number;
  /** 炼金能量（material）。 */
  energy?: number;
  minLevel?: number;
  maxLevel?: number;
  atkSpeed?: number;
  mpFromKill?: number;
  mpRecovery?: number;
  backgroundColor?: string;
  nameColor?: string;
  /** 装备初始词缀池（按部位/阶段）。 */
  affixGroup?: string;
  /** package 专属：开包需要的最小空位。 */
  requireInventory?: number;
  /** package 专属：开包掉落等级（可固定或区间）。 */
  lootLevel?: number | [number, number];
  /** package 专属：开包掉落表。 */
  loots?: LootEntry[];
  /** 排序用的稳定序号。 */
  goodOrder?: number;
}

// ────────────────────────────── 词缀 / 传奇 ──────────────────────────────

export interface AffixData {
  key: string;
  /** 展示函数：`(effect, level) => string`。 */
  display: (effect: number, level?: number) => string;
  /** 抽取权重。 */
  weight: number;
  minLevel?: number;
  maxLevel?: number;
  validClasses?: string[];
  validPositions?: string[];
  /**
   * 前后缀归属（P5 预分类骨架）。
   *
   * 缺省视为 `'prefix'`（历史数据未标注时的兜底）。词缀条数按「前缀池 / 后缀池」分开抽：
   * 普通 1+1、优秀 3+3（传奇的特殊池下期，P5）。
   */
  affixType?: 'prefix' | 'suffix';
  /**
   * 词缀标签（P5 预分类骨架）。
   *
   * 不变式：**同一 tag 只归属前缀或后缀之一**（不会两边都出现）。
   * 本期只做骨架，tag → 具体分布下期。
   */
  tag?: string;
  /**
   * 数值生成：`(level, rng) => value`。
   * ⚠️ 原版内部直接调用 `Math.random()`；移植后**必须**改为注入 `Rng`，否则掉落不可重放。
   */
  generate: (level: number, rng: Rng) => number;
  /** 数值区间展示：`(level) => [min, max]`（纯展示，无随机）。 */
  range?: (level: number) => [number, number];
  /** 生效 hook：`this` = 单位。 */
  hooks?: AttrHooks;
}

export interface LegendData {
  key: string;
  /** 对应 `GoodData.key`。 */
  type: string;
  itemName: string;
  itemDescription?: string;
  minLevel?: number;
  maxLevel?: number;
  special?: boolean;
  display: (effect: number, level?: number) => string;
  /** 同 `AffixData.generate`：随机必须注入。 */
  generate: (level: number, rng: Rng) => number;
  range?: (level: number) => [number, number];
  hooks?: AttrHooks;
}

export interface EnemyAffixData {
  key: string;
  name: string;
  /** hook：`(world, value) => newValue`，`this` = 敌人单位。 */
  hooks: Record<string, (this: unknown, world: unknown, value: number) => number>;
}

// ────────────────────────────── 敌人 ──────────────────────────────

export interface EnemyData {
  key: string;
  name: string;
  description?: string;
  camp: string;
  race?: string;
  career?: string;
  maxHp: number;
  atk: number;
  atkSpeed: number;
  exp: number;
  level: number;
  hpRecovery?: number;
  skills: Array<{ key: string; level: number }>;
  affixes?: Record<string, number>;
  loots?: LootEntry[];
  /**
   * 初始 Buff。
   * ⚠️ 真实数据是**对象数组**（如 `data/enemies/chapter3.beast.js` 的 `{ type: 'simba.goodFriends' }`），
   * 不是字符串数组；这里放宽为联合以兼容两种写法。
   */
  buffs?: Array<string | { type: string; time?: number; arg?: unknown }>;
  /** v2 技能表（部分敌人用它替代 `skills`）。 */
  v2Skills?: Array<{ key: string; level: number }>;
  /** 点击交互（剧情单位用）。 */
  onPress?: (world: unknown) => void;
  hooks?: Record<string, (this: unknown, world: unknown, value: number) => number>;

  // ── 以下为原版实际读取、但此前未在契约声明的可选属性（按原版数据统计补全） ──
  maxMp?: number;
  maxRp?: number;
  maxEp?: number;
  mpRecovery?: number;
  rpRecovery?: number;
  epRecovery?: number;
  /** 攻击方回怒 / 受击方回怒。 */
  rpOnAttack?: number;
  rpOnAttacked?: number;
  def?: number;
  /** 抗性 / 吸收（按伤害类型，键为 `allResist`、`fireResist`、`fireAbsorb`…）。 */
  allResist?: number;
  fireResist?: number;
  coldResist?: number;
  lightningResist?: number;
  iceResist?: number;
  chaosResist?: number;
  fireAbsorb?: number;
  coldAbsorb?: number;
  lightningAbsorb?: number;
  iceAbsorb?: number;
  chaosAbsorb?: number;
  critRate?: number;
  critBonus?: number;
  /** 吸血比例。 */
  leech?: number;
  /** 增伤。 */
  dmgAdd?: number;
  /** 免控 / 免疫概率。 */
  stunResist?: number;
  /** 攻速倍率（正数；用于替代 `atkSpeed` 的乘算）。 */
  speedRate?: number;
  /** 死亡后是否清理尸体。 */
  willClean?: boolean;
}

// ────────────────────────────── 地图 ──────────────────────────────

export interface MonsterSpawnConfig {
  type?: string;
  /** 加权随机类型。 */
  types?: Record<string, number>;
  warmup?: number;
  delay: number;
  max: number;
  total?: number;
  quality?: number[];
  randomPosition?: boolean;
}

export interface MapData {
  key: string;
  name: string;
  hint?: string;
  /** 进入条件。 */
  requirement?: Requirement;
  monsters?: MonsterSpawnConfig[];
  level?: number;
  exp?: number;
  /**
   * 守关 BOSS 的敌人 key（W3 新增）。
   *
   * 野外战斗图每 20 波刷出的 BOSS；由 W4 生成、W6 的「通关全部野外 BOSS」解锁判据消费。
   * 旧地图 / 秘境图不写该字段（缺省 = 无守关 BOSS）。
   */
  boss?: string;
  loots?: LootEntry[];
}

// ────────────────────────────── 条件 ──────────────────────────────

/** 地图解锁条件（原版 `src/logics/check.js`）。 */
export interface Requirement {
  debug?: boolean;
  role?: string;
  career?: string;
  level?: number;
  map?: string;
  atMostMaxLevel?: number;
  atLeastMaxLevel?: number;
  /**
   * 需要**已击杀**的地图 key 的野外 BOSS（W4 解锁链）。
   *
   * 判定数据由 `RequirementContext.bossKilled`（= 角色的 `Player.worldBossKilled`）提供；
   * 上下文缺失时该条件**不成立**（fail-closed）。
   */
  bossKilled?: string;
  $or?: Requirement[];
  $and?: Requirement[];
}

// ────────────────────────────── 技能 / Buff ──────────────────────────────

export interface SkillData {
  key: string;
  name: string;
  /** 互斥分组（同组只能装一个）。 */
  group: string;
  description: string | ((level: number, self: unknown) => string);
  isAttack: boolean;
  castTime?: number;
  coolDown: number | ((level: number) => number);
  cost?: Partial<Record<'hp' | 'mp' | 'rp' | 'ep' | 'comboPoint', number>> | ((level: number) => Partial<Record<'hp' | 'mp' | 'rp' | 'ep' | 'comboPoint', number>>);
  maxExp: (level: number) => number;
  /** `this` = SkillState。 */
  canUse?: (this: unknown, world: unknown, self: unknown, level: number) => boolean;
  shouldUse?: (this: unknown, world: unknown, self: unknown, level: number) => boolean;
  notBreakable?: boolean;
  antiBreak?: boolean;
  /** 技能等级经验的共享分组。 */
  expGroup?: string;
  /** `this` = SkillState。 */
  effect: (this: unknown, world: unknown, self: unknown, level: number) => void;
}

export interface BuffData {
  key: string;
  name: string;
  description?: string | ((arg: unknown, level: number) => string);
  hidden?: boolean;
  /** 不写入存档（战斗临时状态）。 */
  notSave?: boolean;
  effectInterval?: number | ((level: number) => number);
  /** `this` = BuffState。 */
  effect?: (this: unknown, world: unknown) => void;
  /** hook：`(value) => newValue`，`this` = BuffState。 */
  hooks?: Record<string, (this: unknown, value: number, ...extra: unknown[]) => number>;
  willAppear?: (this: unknown, world: unknown) => void;
  didAppear?: (this: unknown, world: unknown) => void;
  willRemove?: (this: unknown, world: unknown) => void;
  didRemove?: (this: unknown, world: unknown) => void;
  onOver?: (this: unknown, world: unknown) => void;
  /** 同组替换优先级：值高的覆盖值低的。 */
  compBuff?: number;
  notRemoveWhenTransform?: boolean;
}

// ────────────────────────────── 职业 / 角色 / 强化 / 药剂 ──────────────────────────────

export interface CareerData {
  key: string;
  name: string;
  description: string;
  requirement: Requirement;
  /**
   * 角色等级上限（可选）。缺失 → `CareerInfo` 的默认值 100（Q8）。
   *
   * 仅在数据表显式配置时覆写默认上限；当前没有职业设置它。
   */
  maxLevel?: number;
  equipments: Partial<Record<EquipPosition, string>>;
  /** 等级 → 升级所需经验的系数多项式，`expFormula.map((v, i) => v * level ** i)`。 */
  expFormula: number[];
  /** 三维成长（P3：耐力 `sta` 已删除，不引入替代属性）。 */
  attrGrow: Record<'str' | 'dex' | 'int', number>;
  skills: Record<string, number>;
  passives: Record<string, number>;
  enhances: Record<string, number>;
  availableClasses: Record<string, boolean>;
}

export interface RoleData {
  key: string;
  name: string;
  description: string;
  defaultCareer: string;
  atk: number;
  atkSpeed: number;
  /** 建卡三维基础值（P3：耐力 `sta` 已删除）。 */
  attrBase: Record<'str' | 'dex' | 'int', number>;
  startup: Record<string, number | { quality: number; affixes: string[] }>;
}

/** 被动 / 强化共用形状：hook 的 `this` = 单位。 */
export interface HookAbilityData {
  key: string;
  name: string;
  description: string;
  hooks: AttrHooks;
}

export interface MedicineData {
  key: string;
  name: string;
  description: (level: number) => string;
  /** hook：`(level, value) => newValue`，`this` = PlayerUnit。 */
  hooks: Record<string, (this: unknown, level: number, value: number) => number>;
}

// ────────────────────────────── 公告 / 升级 ──────────────────────────────

export interface UpgradesData {
  bankByDiamonds: number[];
  inventoryByDiamonds: number[];
  inventory: Array<Record<string, number>>;
}

export interface AnnouncementData {
  version: string;
  title?: string;
  content?: string;
}

// ────────────────────────────── 总表 ──────────────────────────────

/** 全部数据表的聚合根。由 `src/data/index.ts` 的 `createDefaultTables()` 产出。 */
export interface DataTables {
  careers: Record<string, CareerData>;
  roles: Record<string, RoleData>;
  maps: Record<string, MapData>;
  enemies: Record<string, EnemyData>;
  skills: Record<string, SkillData>;
  goods: Record<string, GoodData>;
  passives: Record<string, HookAbilityData>;
  enhances: Record<string, HookAbilityData>;
  buffs: Record<string, BuffData>;
  affixes: Record<string, AffixData>;
  /**
   * 「词缀池分组」表（P5 挂点，可选）。
   *
   * key = `GoodData.affixGroup`；value = 该组可抽取的词缀 key 列表。
   * 缺省 / 未命中该组时回落到**全池**（`Object.keys(affixes)`）——本期所有底材共用一个默认池，
   * 具体分组分布下期（P5）。
   */
  affixGroups?: Record<string, readonly string[]>;
  enemyAffixes: Record<string, EnemyAffixData>;
  legends: Record<string, LegendData>;
  medicines: Record<string, MedicineData>;
  upgrades: UpgradesData;
  announcement: AnnouncementData;
}

/** 可变数据表（供 `register*` 组合函数原地扩展）。 */
export type MutableDataTables = {
  -readonly [K in keyof DataTables]: DataTables[K];
};
