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
 * 装备品质 0..2：普通 / 优秀 / 传奇（P4：7 档压到 3 档）。
 *
 * ⚠️ 破坏性契约变更（已获 P4 批准）：旧存档 / 旧 lootRule 键不再兼容（P1 无真实玩家）。
 * ⚠️ 与 `UnitStateDto.quality` 同名**不同义**：后者是敌人词缀条数（可 >2），故那里用 `number`。
 */
export type Quality = 0 | 1 | 2;

export const QUALITY_NAMES: readonly string[] = ['普通', '优秀', '传奇'];

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
  /** 副本钥匙所属 group（如 'nightmare.3'）。 */
  dungeonKey?: string;
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
  peakLevel: number;
  createdAt: number;
  /** 该角色是否处于战斗中（服务端世界是否在跑）。 */
  inBattle: boolean;
}

/** 单个职业的进度。 */
export interface CareerProgressDto {
  key: string;
  name: string;
  level: number;
  peakLevel: number;
  maxLevel: number;
  exp: number;
  maxExp: number;
  peakExp: number;
  maxPeakExp: number;
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
  peakLevel: number;
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
  /** 副本钥匙计数：group|key → count。 */
  dungeonTickets: Record<string, number>;
  /** 药剂等级。 */
  medicineLevel: Record<string, number>;
  medicineExp: number;
  maxMedicineExp: number;
  /** 当前地图与无尽层。 */
  map: string;
  endlessLevel: number;
  /** 离线结算待领取（>0 表示需要弹结算报告）。 */
  pendingOfflineMs: number;
}

// ────────────────────────────── 战斗世界 ──────────────────────────────

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
}

/** 地图展示态。 */
export interface MapDto {
  key: string;
  name: string;
  hint?: string;
  isDungeon: boolean;
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
  /** 进入需要的钥匙 group。 */
  ticketGroup?: string;
  ticketCount: number;
}

/** 挑战队列条目（结构同 `WorldSnapshotDto.pendingMaps`）。 */
export interface ChallengeEntryDto {
  key: string;
  endlessLevel: number;
}

/** 单个票键的冷却 / 可挑战状态（09 §5.4）。 */
export interface DungeonTicketStateDto {
  /** `group ?? mapKey`（无尽为 `nightmare.<level>`）。 */
  ticketKey: string;
  /** 当前可挑战层数。 */
  stacks: number;
  available: boolean;
  /** 下一次回满的周期边界时刻（ms 时间戳）。 */
  nextResetAt: number;
}

/** 挑战队列 + 本角色各票键状态（`dungeon.queueGet`）。 */
export interface ChallengeQueueDto {
  entries: ChallengeEntryDto[];
  tickets: DungeonTicketStateDto[];
}

/** 神力重置结果（`dungeon.reset`）。 */
export interface DungeonResetResultDto {
  ticketKey: string;
  /** 实际消耗的神力。 */
  cost: number;
  stacks: number;
  nextResetAt: number;
}

/** 世界快照。 */
export interface WorldSnapshotDto {
  map: string;
  endlessLevel: number;
  units: UnitStateDto[];
  /** 当前地图可进入的列表。 */
  maps: MapDto[];
  /** 挑战队列（原版 pendingMaps）。 */
  pendingMaps: Array<{ key: string; endlessLevel: number }>;
  /** 累计模拟速率（原版 updateRate），用于 UI 展示加速倍率。 */
  updateRate: number;
  paused: boolean;
}

/** 战斗事件（推送给前端做日志渲染 / Toast）。 */
export type BattleEventDto =
  | { kind: 'damage'; fromId: string; toId: string; damageType: string; skill: string; value: number; crit: boolean; absorbed: number }
  | { kind: 'heal'; fromId: string; toId: string; skill: string; value: number }
  | { kind: 'dodge'; fromId: string; toId: string; skill: string }
  | { kind: 'death'; unitId: string; name: string; camp: string }
  | { kind: 'buff'; unitId: string; buffKey: string; name: string; on: boolean }
  | { kind: 'exp'; amount: number; level: number; peak: boolean }
  | { kind: 'general'; text: string };

/** (world, tick) 推送载荷：单位增量 + 可选事件。 */
export interface WorldTickDto {
  /** 服务端时间戳（客户端据此做时间对齐，不用于本地推进）。 */
  serverTime: number;
  units: UnitStateDto[];
  events: BattleEventDto[];
  /** 本次批次内的经验/金币增量，便于 HUD 累加显示。 */
  gainedExp: number;
  gainedGold: number;
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
  highestEndlessLevel: number;
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

