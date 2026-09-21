/**
 * 共享 DTO 契约（前后端唯一真相）。
 *
 * 设计原则：
 * - 只描述**线协议载荷**，不含服务端内部实现类型（内部类型在 @idle-dark/game-core）；
 * - 物品/单位等高频结构用「扁平 + 预计算展示字段」形状，前端不做数值推导（服务端权威）；
 * - 所有可选字段显式标 `?`，服务端可增量裁剪。
 */

import type { EquipPosition } from './equip.js';

// ────────────────────────────── 基础枚举 ──────────────────────────────

/**
 * 装备品质 0..2：普通 / 稀有 / 传奇（P4：7 档压到 3 档）。
 *
 * ⚠️ 破坏性契约变更（已获 P4 批准）：旧存档 / 旧 lootRule 键不再兼容（P1 无真实玩家）。
 * ⚠️ 与 `UnitStateDto.quality` 同名**不同义**：后者是敌人词缀条数（可 >2），故那里用 `number`。
 *
 * 档位 1 的**内部代号**仍是「优秀」（`game-core` 阈值表与词缀条数注释沿用该叫法），
 * 但**面向玩家的文案**统一为「稀有」—— 展示文案的唯一真相是 `QUALITY_NAMES`。
 */
export type Quality = 0 | 1 | 2;

export const QUALITY_NAMES: readonly string[] = ['普通', '稀有', '传奇'];

/**
 * **怪物**稀有度档位的展示文案（W11）。
 *
 * ⚠️ 与装备的 `Quality`（3 档：普通/稀有/传奇）是**两条不同的轴**：
 * 这里多出「精英」一档，且第 3 档是**守关 BOSS**（而不是更好的装备品质）。
 * 索引即 {@link UnitStateDto.rarity}。
 */
export const UNIT_RARITY_NAMES: readonly string[] = ['普通', '稀有', '精英', '传奇'];

/** 怪物稀有度档位数（`UNIT_RARITY_NAMES.length`）。 */
export const UNIT_RARITY_MAX = 3;

/** 物品大类。 */
export type GoodType = 'equip' | 'material' | 'junk' | 'package';

/** 物品所在容器（对应原版 InventorySlot.position）。 */
export type ItemPosition = 'equip' | 'inventory' | 'build' | 'award' | 'bank' | 'loot';

/** 自动拾取动作：0 拾取 / 1 出售 / 2 分解。 */
export type LootRuleAction = 0 | 1 | 2;

/** 技能/被动/强化槽位上限随等级变化，由服务端算好下发。 */
export interface SlotLimits {
  maxSkillCount: number;
  maxEnhanceCount: number;
}

// ────────────────────────────── 物品 ──────────────────────────────

/** 一条词缀的展示态（数值与区间由服务端算好）。 */
export interface AffixDto {
  key: string;
  /** 展示名，如「攻击力 +12」。 */
  display: string;
  /** 是否为传奇词缀（来自 legends 表）。 */
  isLegend: boolean;
  /** 已被重铸过（原版 rebuilted 标记）。 */
  rebuilt?: boolean;
}

/** 背包/装备栏中的一个格子。 */
export interface InventorySlotDto {
  /** 稳定实例 id（服务端生成，用于所有针对单件的操作）。 */
  id: string;
  /** 物品基底 key（goods 表 key）；空槽为 null。 */
  key: string | null;
  count: number;
  /** 装备等级（非装备为 0）。 */
  level: number;
  quality: Quality;
  position: ItemPosition;
  displayQuality: Quality;
  name: string;
  description?: string;
  type: GoodType;
  /** 装备专属。 */
  equipClass?: string;
  equipPosition?: EquipPosition;
  atkSpeed?: number;
  /** 需求等级（服务端已做 transformEquipLevel 换算）。 */
  requireLevel?: number;
  /** 预计算的售价。 */
  price: number;
  locked: boolean;
  /** 附魔次数（影响费用）。 */
  enchantTimes: number;
  affixes: AffixDto[];
  /**
   * 是否为钱包物品（R1）：通货 / 精华 / 一般等价物**不占背包格**。
   *
   * 服务端权威标记（`GoodData.wallet`）；前端只据此分流展示，**不做任何推导**。
   * `(battle, loot)` 推送复用同一 `InventorySlotDto`，钱包物品这里为 `true`。
   */
  wallet?: boolean;
  /** 可堆叠上限。 */
  stack?: number;
  /** 分解/炼金能量。 */
  energy?: number;
}

/** 装备栏（9 个固定槽，P2；槽位定义见 `equip.ts`）。 */
export type EquipmentsDto = Partial<Record<EquipPosition, InventorySlotDto | null>>;

/**
 * 钱包条目（R1）。
 *
 * 通货 / 精华 / 一般等价物不占背包格，以「key → 数量」独立承载。
 * `name` / `type` 由服务端算好下发，前端零推导。
 */
export interface WalletEntryDto {
  key: string;
  count: number;
  name: string;
  type: GoodType;
}

// ────────────────────────────── 角色 ──────────────────────────────

/** 角色列表项（轻量，用于选择界面）。 */
export interface PlayerMetaDto {
  key: string;
  name: string;
  role: string;
  roleName: string;
  currentCareer: string;
  currentCareerName: string;
  level: number;
  createdAt: number;
  /** 该角色是否处于战斗中（服务端世界是否在跑）。 */
  inBattle: boolean;
}

/** 单个职业的进度。 */
export interface CareerProgressDto {
  key: string;
  name: string;
  level: number;
  maxLevel: number;
  exp: number;
  maxExp: number;
  /** 该职业下所有技能 key → 解锁等级。 */
  skills: Record<string, number>;
  /** 该职业下所有被动 key → 解锁等级。 */
  passives: Record<string, number>;
  /** 该职业下所有强化 key → 解锁等级。 */
  enhances: Record<string, number>;
  availableClasses: Record<string, boolean>;
}

/** 技能展示态。 */
export interface SkillDto {
  key: string;
  name: string;
  group: string;
  description: string;
  level: number;
  /** 解锁等级（职业等级门槛）。 */
  unlockLevel: number;
  unlocked: boolean;
  selected: boolean;
  isAttack: boolean;
  coolDown: number;
  /** 当前是否满足使用条件（服务端判定）。 */
  usable: boolean;
}

/** 强化（被动）展示态。 */
export interface EnhanceDto {
  key: string;
  name: string;
  description: string;
  unlockLevel: number;
  unlocked: boolean;
  selected: boolean;
}

/** 角色完整状态（进入角色时下发）。 */
export interface PlayerStateDto {
  key: string;
  name: string;
  role: string;
  roleName: string;
  level: number;
  exp: number;
  maxExp: number;
  gold: number;
  /** 账号级神力（跨角色共享，随角色态一并下发便于 UI）。 */
  diamonds: number;
  currentCareer: string;
  careers: CareerProgressDto[];
  equipments: EquipmentsDto;
  inventory: InventorySlotDto[];
  buildInventory: InventorySlotDto[];
  awardInventory: InventorySlotDto[];
  /**
   * 钱包（R1）：通货 / 精华 / 一般等价物，**不占 `inventory` 格**。
   * 仅包含数量 > 0 的条目（服务端已过滤），顺序稳定。
   */
  wallet?: WalletEntryDto[];
  inventorySize: number;
  slotLimits: SlotLimits;
  /** 已选主动技能（顺序即优先级）。 */
  selectedSkills: string[];
  selectedEnhances: string[];
  /** 技能等级：expGroup|skillKey → { level, exp }。 */
  skillExp: Record<string, { level: number; exp: number }>;
  /** 药剂等级。 */
  medicineLevel: Record<string, number>;
  medicineExp: number;
  maxMedicineExp: number;
  /** 当前地图。 */
  map: string;
  /** 离线结算待领取（>0 表示需要弹结算报告）。 */
  pendingOfflineMs: number;
}

// ────────────────────────────── 战斗世界 ──────────────────────────────

/**
 * 玩家单位属性面板（原版 `battle/components/PlayerPanel.js` 的那张表）。
 *
 * ## 这是「展示投影」，不是内核原值
 *
 * 所有 `…Pct` 字段是**已经 ×100 的百分数**（`16.7` 表示 16.7%），
 * `…Recovery5s` 是**已经 ×5 的「每 5 秒回复量」**，整数字段是**已经取整**的值。
 * 换算与取整**全部在服务端**完成（`server/.../internal/player-attributes.ts`），
 * 前端只负责拼 `%` / `次/秒` 后缀与小数位 —— 前端**不做任何算术**（AGENTS §1.6）。
 *
 * ⚠️ 为什么不发内核原值让前端乘：① 违反「前端零推导」；
 * ② 内核浮点原值每帧都可能抖动出无意义的差分（如 `0.1+0.2`），
 * 按显示精度取整后差分才是稳定的（`unit-state-diff.ts` 靠内容比较）。
 *
 * ## 与原版的三处刻意偏离（内核差异，不是遗漏）
 *
 * | 原版 | 本仓 | 依据 |
 * |---|---|---|
 * | `耐力 sta` | **不提供** | E1 属性三化：`sta` 已删除且不引入替代属性 |
 * | 巅峰等级 `peakLevel`（`(39)`） | **不提供** | Q8 删巅峰后无额外等级项 |
 * | `darkResist` / `darkAbsorb`（暗影） | `chaosResist` / `chaosAbsorb`（混沌） | P7：混沌非元素、全抗不作用于它 |
 *
 * 原版「骑士显示圣能 `comboPoint`」一行本次未实现（截图是战士；`comboPoint` 已在
 * `UnitStateDto` 上，需要时由 UI 按职业补一行即可）。
 */
export interface PlayerAttributesDto {
  /** 当前职业显示名（原版 `careerName`）。无当前职业时为 `''`。 */
  careerName: string;
  /** 当前职业的等级上限（原版括号里的「等级上限：N」）。 */
  maxLevel: number;
  // ── 三维（原版还有「耐力」，本仓 E1 已删除） ──
  str: number;
  dex: number;
  int: number;
  // ── 输出 ──
  atk: number;
  /** 次/秒（原版 `atkSpeed`，1 位小数）。 */
  atkSpeed: number;
  /** 速度加成 `(speedRate - 1) × 100`。 */
  speedBonusPct: number;
  critRatePct: number;
  critBonusPct: number;
  /** 法术伤害加成 `(dmgAdd - 1) × 100`。 */
  dmgBonusPct: number;
  // ── 收益 ──
  hpFromKill: number;
  mpFromKill: number;
  /** `(expInc - 1) × 100`。 */
  expBonusPct: number;
  /** `(skillExpInc - 1) × 100`。 */
  skillExpBonusPct: number;
  /** 装备品质提升 `(mf - 1) × 100`。 */
  magicFindPct: number;
  /** 掉落金币提升 `(gf - 1) × 100`。 */
  goldFindPct: number;
  // ── 防御 ──
  dodgeRatePct: number;
  def: number;
  fireResist: number;
  coldResist: number;
  lightningResist: number;
  /** 原版「暗影抗性」；P7 起混沌非元素，不吃智力全抗。 */
  chaosResist: number;
  fireAbsorbPct: number;
  coldAbsorbPct: number;
  lightningAbsorbPct: number;
  /** 原版「暗影吸收」。 */
  chaosAbsorbPct: number;
  /** 物理吸收（内核字段名 `meleeAbsorb`）。 */
  meleeAbsorbPct: number;
  // ── 回复 ──
  /** 每 5 秒回复量 `hpRecovery × 5`。 */
  hpRecovery5s: number;
  mpRecovery5s: number;
  rpRecovery5s: number;
  epRecovery5s: number;
  /** 怒气消耗回复生命。 */
  rpRecHp: number;
  leech: number;
}

/** 单位运行时快照（服务端权威，前端只渲染）。 */
export interface UnitStateDto {
  id: string;
  /** 'player' | 'enemy' | 'summon' | ... */
  kind: string;
  /** 敌方为敌人 key，我方为角色 key。 */
  typeKey: string;
  name: string;
  camp: string;
  level: number;
  /**
   * 敌人词缀条数（`EnemyUnit.quality`）。
   *
   * ⚠️ 与装备 `Quality`（0..2）**同名不同义**：这是「带几条敌人词缀」的计数，可 >2，
   * 因此这里刻意用 `number` 而不是 `Quality`（12 号任务书 §3.6 第 8 条）。
   */
  quality: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  rp: number;
  maxRp: number;
  ep: number;
  maxEp: number;
  comboPoint: number;
  /** 当前目标单位 id。 */
  targetId: string | null;
  /** 施法/读条进度 0..1（无读条为 null）。 */
  castingProgress: number | null;
  /** 生效中的 Buff 展示态。 */
  buffs: Array<{ key: string; name: string; stack: number; remainMs: number }>;
  /** 该单位是否是本图守关 BOSS（供前端高亮；非 BOSS 省略）。 */
  boss?: boolean;
  /**
   * 该单位是否是**精英怪**（W11；非精英省略）。
   *
   * 精英 = 每 10 波定时刷新的一只 **`quality = 2`（两条敌人词缀）** 的普通怪，
   * 并且在清尸时**额外必掉一条通货/精华实例**。
   *
   * ⚠️ 与 `boss` 一样是**出生即固定**的字段：只出现在 `add` / `reset`，不进
   * `MUTABLE_UNIT_FIELDS`。展示用的档位请看 {@link UnitStateDto.rarity}。
   */
  elite?: boolean;
  /**
   * 怪物稀有度档位（W11；**服务端派生**，前端零推导）。
   *
   * ```
   * 0 = 普通   1 = 稀有   2 = 精英   3 = 传奇（守关 BOSS）
   * ```
   *
   * 派生优先级：`boss(3) > elite(2) > clampEnemyQuality(quality)`（`quality` 本身夹到 `0..2`
   * 逐级对应 普通/稀有/精英）。唯一实现见 `game-core` 的 `combat/enemy-rarity.ts`
   * （`enemyRarityOf`），服务端只做序列化。
   *
   * ⚠️ **不要在前端用 `boss` / `elite` / `quality` 自己拼档位** —— `quality` 在本协议里是
   * 「敌人词缀条数」（可 > 2），与装备品质 `Quality` **同名不同义**，正是最容易拼错的地方。
   * 这与 `alive` 同属「服务端派生、前端只渲染」的字段。
   */
  rarity?: number;
  /**
   * 是否存活（P2，服务端按 `camp === 'ghost'` 派生，前端**零推导**）。
   *
   * ⚠️ 引擎里「死亡」不等于「移除」：`Unit.kill()` 只把 `camp` 翻成 `ghost`，
   * `EnemyUnit.clean()` 才真正 `removeUnit`（默认死亡后 3000ms）。因此：
   * - 死亡 = 一帧 `chg { alive:false, hp:0, camp:'ghost', ... }`；
   * - 清尸 = 一帧 `del`；
   * - 缺省（字段未下发）按**存活**处理，兼容旧服务端。
   */
  alive?: boolean;
  /**
   * 角色属性面板（**仅玩家单位携带**，其余单位省略）。
   *
   * 展示投影，已换算 + 已取整（见 {@link PlayerAttributesDto}）。
   * ⚠️ 它在 `MUTABLE_UNIT_FIELDS` 白名单里：升级 / 换装 / 词缀变化会重发整份属性对象
   * （对象只有玩家单位有，且只在真的变化时发）。
   */
  attributes?: PlayerAttributesDto;
  /**
   * 当前职业经验 / 升级所需经验（**仅玩家单位携带**）。
   *
   * ⚠️ 为什么独立于 `attributes`：经验**每次击杀都会变**，塞进属性对象会让「一整份属性」
   * 跟着经验每帧重发（约 400B × 5Hz）。独立字段下这一帧只多约 20B，而且它变化时
   * `gainedExp !== 0` 本来就已经触发了一帧（不会额外制造帧）。
   */
  exp?: number;
  maxExp?: number;
}

/** 地图展示态。 */
export interface MapDto {
  key: string;
  name: string;
  hint?: string;
  level: number;
  /** 未解锁原因（null = 已解锁）。 */
  lockedReason: string | null;
  /**
   * 是否可进入。
   *
   * 与 `lockedReason === null` 同义，单独给出是为了让前端**不必解析文案**即可筛选/排序 ——
   * 数据表里有 47 张图，其中绝大多数在前期是锁定的，服务端会把可进入的排在前面。
   */
  unlocked?: boolean;
}

/** 世界快照。 */
export interface WorldSnapshotDto {
  map: string;
  units: UnitStateDto[];
  /** 当前地图可进入的列表。 */
  maps: MapDto[];
  /** 累计模拟速率（原版 updateRate），用于 UI 展示加速倍率。 */
  updateRate: number;
  paused: boolean;
  /** 当前已完成的波数（W4；服务端权威，前端零推导）。 */
  wave?: number;
  /** 守关 BOSS 的刷新间隔（波；缺省 20）。 */
  bossEvery?: number;
  /**
   * 本图守关 BOSS **是否还会出现**（服务端权威，前端零推导）。
   *
   * - `false`：本图没有守关 BOSS，或（野外图）该图 BOSS **已被击杀** —— 一次性语义，
   *   通关之后不会再刷，UI **不应**再显示「距守关 BOSS N 波」；
   * - `true`：还会出现（未通关的野外图；混沌图可重复刷，恒为 `true`）。
   *
   * ⚠️ 与 `UnitStateDto.quality` 无关，也与「当前是否有 BOSS 在场」无关（那是 `boss` 字段）。
   */
  bossPending?: boolean;
}

/** 战斗事件（推送给前端做日志渲染 / Toast）。 */
export type BattleEventDto =
  | {
      kind: 'damage';
      fromId: string;
      toId: string;
      damageType: string;
      /** 技能数据表的键（如 `thumpHead`）。**不要直接展示**，用 `skillName`。 */
      skill: string;
      /** 技能的展示名（服务端从技能表解析）。缺省时前端回落 `skill`。 */
      skillName?: string;
      value: number;
      crit: boolean;
      absorbed: number;
    }
  | { kind: 'heal'; fromId: string; toId: string; skill: string; skillName?: string; value: number }
  | { kind: 'dodge'; fromId: string; toId: string; skill: string; skillName?: string }
  | { kind: 'death'; unitId: string; name: string; camp: string }
  | { kind: 'buff'; unitId: string; buffKey: string; name: string; on: boolean }
  | { kind: 'exp'; amount: number; level: number; /** 获得经验者的单位 id（日志显示用）。 */ whoId?: string }
  | { kind: 'general'; text: string };

/**
 * 单位补丁操作（P2；**有序**，客户端必须按序应用；同批多帧合并 = 数组直接拼接）。
 *
 * - `reset`：清空本地单位表并重填（进图 / 重连 / 丢帧补推的基线）；
 * - `add`：新出现的单位，携带**全部**字段（含出生后不再变化的标识字段）；
 * - `chg`：仅携带**变化字段**（`MUTABLE_UNIT_FIELDS`，见 `unit-state-diff.ts`）；
 * - `del`：从世界单位表中**移除**（= 清尸，**不是死亡**；死亡是 `chg { alive:false }`）。
 */
export type UnitPatchOpDto =
  | { op: 'reset'; units: UnitStateDto[] }
  | { op: 'add'; unit: UnitStateDto }
  | { op: 'chg'; id: string; fields: Partial<UnitStateDto> }
  | { op: 'del'; id: string };

/** (world, tick) 推送载荷：单位增量 + 可选事件。 */
export interface WorldTickDto {
  /** 服务端时间戳（客户端据此做时间对齐，不用于本地推进）。 */
  serverTime: number;
  /**
   * @deprecated P2 起**停止填充**（恒为 `[]`），改走 `patch`。
   * 字段保留以不破坏冻结契约；空数组的 20B 开销可在后续显式批准后删除。
   */
  units: UnitStateDto[];
  /**
   * @deprecated P2 起**停止填充**（恒为 `[]`），改走 `log`。
   */
  events: BattleEventDto[];
  /** 本次批次内的经验/金币增量，便于 HUD 累加显示。 */
  gainedExp: number;
  gainedGold: number;
  /** 当前已完成的波数（W4；服务端权威，前端零推导）。 */
  wave?: number;
  /** 守关 BOSS 的刷新间隔（波；缺省 20）。 */
  bossEvery?: number;
  /** 本图守关 BOSS **是否还会出现**（见 `WorldSnapshotDto.bossPending`）。 */
  bossPending?: boolean;
  /** P2：本会话已发出的帧序号（单调递增；仅用于观测与调试，不参与一致性判定）。 */
  seq?: number;
  /** P2：本窗口的单位状态净差分（有序）。缺省 / 空数组 = 本窗口无单位变化。 */
  patch?: UnitPatchOpDto[];
  /** P2：本窗口的战斗日志（`events` 的继任者；已按发生顺序排列）。 */
  log?: BattleEventDto[];
  /** P2：本窗口的掉落（原 `(battle, loot)` 推送并帧；`handled:'lost'` 表示包裹已满被丢弃）。 */
  loot?: LootDto[];
}

/** (battle, loot) 推送载荷。 */
export interface LootDto {
  slot: InventorySlotDto;
  /**
   * `'pickup' | 'sell' | 'decompose'` = **实际入包**的处理结果；
   * `'lost'` = **包裹已满被丢弃**（数量在 `slot.count`）—— 前端不得提示「获得」。
   */
  handled: 'pickup' | 'sell' | 'decompose' | 'lost';
  gold?: number;
  materials?: Array<{ key: string; count: number }>;
}

// ────────────────────────────── 生产 ──────────────────────────────

export interface CostDto {
  gold?: number;
  diamonds?: number;
  materials?: Array<{ key: string; count: number }>;
}

export interface EnchantCostsDto {
  /** 逐词缀的重掷费用（锁定的词缀不计费）。 */
  enchant: CostDto;
  /** 锁定某个词缀额外消耗的神力。 */
  lockDiamond: number;
}

export interface RebuildCostsDto {
  diamonds: number;
  /** 已经重铸过的词缀不能再重铸。 */
  rebuildableAffixKeys: string[];
}

export interface DecomposeResultDto {
  materials: Array<{ key: string; count: number }>;
  diamonds: number;
}

export interface MedicineStateDto {
  levels: Record<string, number>;
  exp: number;
  maxExp: number;
  /** 坩埚等级（bowelLevel）与转化倍率。 */
  bowelLevel: number;
  bowelEffect: number;
  bowelUpgradePrice: number;
}

// ────────────────────────────── 商店 / 离线 ──────────────────────────────

export interface ShopStateDto {
  playerSlotCount: number;
  playerSlotMax: number;
  nextSlotPrice: number;
  diamonds: number;
  /** 药剂等级搬运费用预览。 */
  exchangeOptions: Array<{ from: string; to: string; cost: number }>;
}

export interface OfflineReportDto {
  /** 实际参与结算的离线时长（毫秒）。 */
  offlineMs: number;
  /** 被 72h 上限截断的时长。 */
  cappedMs: number;
  /** 真实模拟的时长（有界快进预算内）。 */
  simulatedMs: number;
  /** 超出预算、按速率外推的时长。 */
  extrapolatedMs: number;
  gainedExp: number;
  gainedGold: number;
  kills: number;
  loots: Array<{ key: string; count: number; quality: Quality }>;
  materials: Array<{ key: string; count: number }>;
  /** 是否因超过最大离线时间而暂停生产。 */
  pausedByMaxOffline: boolean;
}

// ────────────────────────────── 认证 ──────────────────────────────

export interface LoginRequestDto {
  username: string;
  password: string;
}

export interface LoginResponseDto {
  token: string;
  expiresAt: number;
  userId: string;
  displayName: string;
}

export interface MeDto {
  userId: string;
  displayName: string;
  diamonds: number;
  playerSlotCount: number;
}

// ────────────────────────────── 系统 ──────────────────────────────

/**
 * 心跳响应（`system.ping`）。
 *
 * ⚠️ 字段名固定为 `serverTime`：客户端 `extractServerTime()` 只识别
 * `serverTime` / `serverTimeMs`（含 `data.*` 嵌套），用于计算与服务端的时钟偏移。
 * 服务端若改用 `timestamp` 等别名，时钟对齐会**静默失效**。
 */
export interface SystemPingDto {
  status: 'ok';
  service: string;
  /** 服务端当前时间戳（ms）。 */
  serverTime: number;
}

/** 版本信息（`system.version`）。 */
export interface SystemVersionDto {
  /** 服务端构建版本（如 `0.1.0`），仅用于展示与排查。 */
  serverVersion: string;
  /**
   * 服务端线协议版本。客户端应与 `PROTOCOL_VERSION` 比对，
   * 不一致时提示刷新（避免新旧字段语义错位）。
   */
  protocolVersion: number;
  /** 服务端当前时间戳（ms）。 */
  serverTime: number;
  /** WS 挂载路径（PROTOCOL §1）。 */
  wsPath: string;
  /** 公告版本（用于判断是否需要弹更新公告）。 */
  noticeVersion?: number;
}

/** 系统公告（`system.notice` 推送载荷）。 */
export interface SystemNoticeDto {
  id: string;
  title: string;
  body: string;
  /** 发布时间（服务端 ms）。 */
  at: number;
}

// ────────────────────────────── 拾取规则 ──────────────────────────────

/** 单条拾取规则。 */
export interface LootRuleEntryDto {
  /** 规则 id。 */
  id: string;
  /** 品质下限 0..2。 */
  minQuality: number;
  /** 等级下限。 */
  minLevel: number;
  /** 0 拾取 / 1 出售 / 2 分解。 */
  action: LootRuleAction;
  enabled: boolean;
}

/** 拾取规则面板。 */
export interface LootRuleStateDto {
  enabled: boolean;
  minLevel: number;
  rules: LootRuleEntryDto[];
}

export interface LootRuleUpdateInput {
  enabled?: boolean;
  rules?: LootRuleEntryDto[];
}

// ────────────────────────────── 职业面板汇总 ──────────────────────────────

/** 职业面板汇总（`career.list` 一次下发，前端不做推导）。 */
export interface CareerPanelDto {
  careers: CareerProgressDto[];
  skills: SkillDto[];
  enhances: EnhanceDto[];
  /** 技能 / 强化槽位上限（服务端算好下发）。 */
  maxSkillCount: number;
  maxEnhanceCount: number;
}

// ────────────────────────────── 混沌仪（无尽，W6） ──────────────────────────────

/** 挑战失败选项：`normal` = 回普通地图挂机；`continue` = 继续挑战（默认重试当前钥石）。 */
export type ChaosFailMode = 'normal' | 'continue';

/** 单个 T 阶的展示态（服务端权威；前端不做任何数值推导）。 */
export interface ChaosTierDto {
  /** 阶（1~16）。 */
  tier: number;
  /** 混沌地图 key（`chaos.t01..t16`）。 */
  mapKey: string;
  name: string;
  level: number;
  keystoneKey: string;
  /** 角色背包里该阶钥石的数量。 */
  keystoneCount: number;
  /** 混沌仪是否已解锁（解锁判据 = 通关全部野外 BOSS）。 */
  unlocked: boolean;
}

/** 混沌仪面板状态。 */
export interface ChaosStateDto {
  unlocked: boolean;
  tiers: ChaosTierDto[];
  /** 玩家编排的钥石序列（规范 key，≤16，可重复）。 */
  sequence: string[];
  failMode: ChaosFailMode;
  /** 是否正在按序列自动推进。 */
  active: boolean;
  /** 当前挑战的阶；未运行 / 序列走完 → null。 */
  currentTier: number | null;
  /** 当前钥石的连续失败次数。 */
  retry: number;
}

/** 保存钥石序列（`chaos.setSequence`）。 */
export interface ChaosSequenceInput {
  sequence: string[];
}

/** 设置失败选项（`chaos.setFailMode`）。 */
export interface ChaosFailModeInput {
  failMode: ChaosFailMode;
}


