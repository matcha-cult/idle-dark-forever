/**
 * 存档 → 线协议 DTO 投影（服务端权威）
 *
 * 全部展示字段在服务端算好：前端只渲染，不做任何数值推导（`AGENTS.md` §1.6）。
 * 本文件是**纯函数**（不注入、不 IO），便于单测覆盖边界。
 */
import type {
  AffixDto,
  CareerProgressDto,
  EnhanceDto,
  EquipPosition,
  EquipmentsDto,
  GoodType,
  InventorySlotDto,
  ItemPosition,
  PlayerMetaDto,
  PlayerStateDto,
  Quality,
  SkillDto,
  SlotLimits,
  WalletEntryDto,
} from '@idle-dark/protocol';
import type { DataTables } from '@idle-dark/game-core';
import type { WorldMapState } from './world-map-state.js';
import {
  CareerInfo,
  EQUIP_SLOTS,
  InventorySlot,
  Player,
  type AffixInfo,
  type EquipSlot,
} from '@idle-dark/game-core';

/** 账号级、`Player` 之外的附加状态（服务端侧车，落在 `account_state.data`）。 */
export interface AccountExtras {
  /** 药剂等级：type → level。 */
  medicineLevel: Record<string, number>;
  medicineExp: number;
  /**
   * 每角色战斗世界的持久化随机种子（characterId → seed）。
   *
   * `game-core` 明确要求「用 `SeededRngFactory` 生成并持久化种子以保证可复算」；
   * 但 `Player` 存档里没有种子字段（也不该有）。这里落在账号侧车：
   * 既保证重启后同一角色继续同一随机序列，又不污染 `Player.toJSON()`。
   */
  worldSeeds: Record<string, number>;
  /**
   * 每角色当前所在地图 + 该图 run 进度（characterId → {@link WorldMapState}）。
   *
   * 原版 `worldState`（在飞的战斗快照）按方案 §9.2 **不迁**；但「玩家上次在哪张图」
   * 必须记住，否则每次重连都回到 `home`。
   *
   * 这里是**世界侧车状态**：按角色 + 当前地图记录已完成波数与里程碑
   * （W4 `wave` / W11 `lastEliteWave` / `lastBossWave`），会话重启
   * （刷新 / 断线重连 / 空闲回收）不丢进度。它**不进** `characters.state`
   * （`Player` 存档只放角色自身状态），也不占 Prisma 迁移 —— 它住在
   * `account_state.data` 这个 JSONB 侧车里。
   *
   * ⚠️ **读写都必须走 `world-map-state.ts`**（`parseWorldMapState` / `writeWorldMapState`）：
   * 曾经 `WorldService` 与 `IdleLogicService` 各拼一次对象字面量，后者少写 `wave`
   * ⇒ 每次登录都把波数抹掉（详版见该文件注释）。
   */
  worldMaps: Record<string, WorldMapState>;
}

export function createAccountExtras(): AccountExtras {
  return {
    medicineLevel: {},
    medicineExp: 0,
    worldSeeds: {},
    worldMaps: {},
  };
}

/** 角色名 / 职业名的真实展示名（替换占位回退）。 */
export function roleDisplayName(tables: DataTables, role: string): string {
  return tables.roles[role]?.name ?? role;
}

export function careerDisplayName(tables: DataTables, career: string | null | undefined): string {
  if (!career) return '';
  return tables.careers[career]?.name ?? career;
}

/** 品质夹取到 `Quality`（0..2，P4）。非法 / 缺失 / 越界 → 夹到端点。 */
function asQuality(value: unknown): Quality {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  if (n < 0) return 0;
  if (n > 2) return 2;
  return n as Quality;
}

/**
 * 物品实例稳定 id。
 *
 * ⚠️ `game-core` 的 `InventorySlot` **没有**稳定实例 id（原版也没有），
 * 而协议 DTO 要求 `id` 供单件操作使用。这里用「容器 + 下标」合成：
 * 在**同一存档快照内**稳定（前端一次拉到的是同一快照），跨快照不保证。
 * 后续 `inventory` 域若要长期稳定 id，应在 `InventorySlot` 上新增字段（需改 game-core）。
 */
export function slotIdOf(position: ItemPosition, index: number): string {
  return `${position}:${index}`;
}

function toAffixDto(affix: AffixInfo): AffixDto {
  const dto: AffixDto = {
    key: affix.key ?? '',
    display: affix.display,
    isLegend: affix.isLegend,
  };
  if (affix.rebuilded) dto.rebuilt = true;
  return dto;
}

/** 单格 → DTO。空槽也会输出（`key: null`），前端按 `key` 判断。 */
export function slotDtoOf(slot: InventorySlot, index: number): InventorySlotDto {
  const good = slot.goodData;
  const position = slot.position as ItemPosition;
  const quality = asQuality(slot.quality);
  const dto: InventorySlotDto = {
    id: slotIdOf(position, index),
    key: slot.key,
    count: typeof slot.count === 'number' && Number.isFinite(slot.count) ? slot.count : 0,
    level: Number.isFinite(slot.level) ? slot.level : 0,
    quality,
    position,
    displayQuality: asQuality(slot.displayQuality ?? slot.quality),
    name: slot.name,
    type: (good?.type ?? 'material') as GoodType,
    price: Number.isFinite(slot.price) ? slot.price : 0,
    locked: !!slot.locked,
    enchantTimes: Number.isFinite(slot.enchantTimes) ? slot.enchantTimes : 0,
    affixes: slot.affixes.map(toAffixDto),
  };
  const description = slot.description;
  if (description) dto.description = description;
  if (good) {
    if (good.class) dto.equipClass = good.class;
    if (good.position) dto.equipPosition = good.position;
    if (typeof good.stack === 'number' && good.stack > 0) dto.stack = good.stack;
    if (typeof good.energy === 'number') dto.energy = good.energy;
    // R1：钱包物品标记（前端据此把掉落分流到钱包展示，不当作背包格）。
    if (good.wallet === true) dto.wallet = true;
  }
  if (slot.isEquip) {
    const atkSpeed = slot.atkSpeed;
    if (Number.isFinite(atkSpeed)) dto.atkSpeed = atkSpeed;
    const requireLevel = slot.requireLevel;
    if (Number.isFinite(requireLevel)) dto.requireLevel = requireLevel;
  }
  return dto;
}

/** 数组 → DTO 列表（按容器 position 生成稳定 id）。 */
export function slotListDtoOf(slots: readonly InventorySlot[]): InventorySlotDto[] {
  return slots.map((slot, index) => slotDtoOf(slot, index));
}

/** 九个装备槽 → DTO（固定部位键；空槽为 `null`）。 */
export function equipmentsDtoOf(career: CareerInfo | undefined): EquipmentsDto {
  const out: EquipmentsDto = {};
  const slots: readonly EquipSlot[] = EQUIP_SLOTS;
  if (!career) {
    for (const key of slots) out[key as EquipPosition] = null;
    return out;
  }
  for (const key of slots) {
    const slot = career.equipments[key];
    out[key as EquipPosition] = slot ? slotDtoOf(slot, 0) : null;
  }
  return out;
}

/**
 * 钱包投影（R1）。
 *
 * - 只输出数量 > 0 的条目（NaN / Infinity / 负数一律丢弃，不污染 UI）；
 * - `name` / `type` 由服务端从数据表补全，前端零推导；
 * - 排序：`goodOrder` 优先，其次 key —— 保证存档往返后顺序稳定。
 */
export function walletDtoOf(tables: DataTables, player: Player): WalletEntryDto[] {
  const out: WalletEntryDto[] = [];
  for (const [key, count] of player.wallet) {
    if (!Number.isFinite(count) || count <= 0) continue;
    const good = tables.goods[key];
    out.push({
      key,
      count,
      name: good?.name ?? key,
      type: (good?.type ?? 'material') as GoodType,
    });
  }
  out.sort((a, b) => {
    const ao = tables.goods[a.key]?.goodOrder ?? 0;
    const bo = tables.goods[b.key]?.goodOrder ?? 0;
    if (ao !== bo) return ao - bo;
    if (a.key === b.key) return 0;
    return a.key < b.key ? -1 : 1;
  });
  return out;
}

/** 单职业进度 DTO。 */
export function careerProgressDtoOf(tables: DataTables, info: CareerInfo): CareerProgressDto {
  const data = tables.careers[info.type];
  return {
    key: info.type,
    name: data?.name ?? info.type,
    level: info.level,
    maxLevel: info.maxLevel,
    exp: info.exp,
    maxExp: info.maxExp,
    skills: { ...(data?.skills ?? {}) },
    passives: { ...(data?.passives ?? {}) },
    enhances: { ...(data?.enhances ?? {}) },
    availableClasses: { ...(data?.availableClasses ?? {}) },
  };
}

export function careerProgressListDtoOf(tables: DataTables, player: Player): CareerProgressDto[] {
  const out: CareerProgressDto[] = [];
  for (const info of player.careers.values()) {
    out.push(careerProgressDtoOf(tables, info));
  }
  return out;
}

/** 技能展示态列表（按当前职业的技能表；`usableByKey` 由战斗运行时提供）。 */
export function skillListDtoOf(
  tables: DataTables,
  player: Player,
  usableByKey: Readonly<Record<string, boolean>> = {},
): SkillDto[] {
  const careerData = player.careerData;
  const info = player.careerInfo;
  const out: SkillDto[] = [];
  if (!careerData) return out;
  const selected = new Set(info?.selectedSkills ?? []);
  for (const key of Object.keys(careerData.skills)) {
    const skill = tables.skills[key];
    if (!skill) continue;
    const unlockLevel = careerData.skills[key] ?? 0;
    const description = typeof skill.description === 'string' ? skill.description : '';
    const coolDown = resolveDisplayCoolDown(skill.coolDown);
    out.push({
      key,
      name: skill.name,
      group: skill.group,
      description,
      level: player.getSkillLevel(key),
      unlockLevel,
      unlocked: (info?.level ?? 0) >= unlockLevel,
      selected: selected.has(key),
      isAttack: !!skill.isAttack,
      coolDown: Number.isFinite(coolDown) ? coolDown : 0,
      usable: usableByKey[key] === true,
    });
  }
  return out;
}

/**
 * 求「展示用」的技能冷却数值。
 *
 * ⚠️ 数据表里 89 处 `coolDown` 形如 `(level, unit) => unit.runAttrHooks(8000, 'xxxCoolDown')`
 * —— 即**第二参是战斗单位**。这些 hook 属于战斗运行时，面板展示阶段并没有真实单位，
 * 直接 `skill.coolDown(0)` 会在 hook 内抛 `Cannot read properties of undefined (reading 'runAttrHooks')`，
 * 把 `career.list` 变成 500（这是实际发生过的缺陷）。
 *
 * 因此这里传一个**最小 unit 替身**（`runAttrHooks` 直接返回原值，等价于「无任何属性加成」），
 * 并用 try/catch 兜底：冷却只是展示值，任何异常都不该让整个面板失败。
 */
function resolveDisplayCoolDown(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'function') return 0;
  try {
    const value = (raw as (level: number, unit: unknown) => unknown)(0, DISPLAY_UNIT_STUB);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** 展示阶段的单位替身：属性 hook 原值返回（= 无加成）。 */
const DISPLAY_UNIT_STUB = {
  runAttrHooks: (value: number, _key?: string): number => value,
} as const;

/** 强化（被动）展示态列表。 */
export function enhanceListDtoOf(tables: DataTables, player: Player): EnhanceDto[] {
  const careerData = player.careerData;
  const info = player.careerInfo;
  const out: EnhanceDto[] = [];
  if (!careerData) return out;
  const selected = new Set(info?.selectedEnhances ?? []);
  for (const key of Object.keys(careerData.enhances)) {
    const enhance = tables.enhances[key];
    if (!enhance) continue;
    const unlockLevel = careerData.enhances[key] ?? 0;
    out.push({
      key,
      name: enhance.name,
      description: enhance.description,
      unlockLevel,
      unlocked: (info?.level ?? 0) >= unlockLevel,
      selected: selected.has(key),
    });
  }
  return out;
}

export function slotLimitsOf(player: Player): SlotLimits {
  return { maxSkillCount: player.maxSkillCount, maxEnhanceCount: player.maxEnhanceCount };
}

/** 角色列表项。 */
export function playerMetaDtoOf(
  tables: DataTables,
  player: Player,
  inBattle: boolean,
): PlayerMetaDto {
  const career = player.currentCareer;
  return {
    key: player.key,
    name: player.name,
    role: player.role,
    roleName: roleDisplayName(tables, player.role),
    currentCareer: career ?? '',
    currentCareerName: careerDisplayName(tables, career),
    level: player.level,
    createdAt: player.timestamp,
    inBattle,
  };
}

export interface PlayerStateOptions {
  extras: AccountExtras;
  /** 当前地图（来自 world 运行时；不在存档里）。 */
  map: string;
  pendingOfflineMs: number;
  usableByKey?: Readonly<Record<string, boolean>>;
}

/** 角色完整态（`player.select` 下发）。 */
export function playerStateDtoOf(
  tables: DataTables,
  player: Player,
  options: PlayerStateOptions,
): PlayerStateDto {
  const career = player.careerInfo;
  return {
    key: player.key,
    name: player.name,
    role: player.role,
    roleName: roleDisplayName(tables, player.role),
    level: player.level,
    exp: player.exp,
    maxExp: player.maxExp,
    gold: player.gold,
    diamonds: player.account.diamonds,
    currentCareer: player.currentCareer ?? '',
    careers: careerProgressListDtoOf(tables, player),
    equipments: equipmentsDtoOf(career),
    inventory: slotListDtoOf(player.inventory),
    buildInventory: slotListDtoOf(player.buildInventory),
    awardInventory: slotListDtoOf(player.awardInventory),
    wallet: walletDtoOf(tables, player),
    inventorySize: player.inventory.length,
    slotLimits: slotLimitsOf(player),
    selectedSkills: [...(career?.selectedSkills ?? [])],
    selectedEnhances: [...(career?.selectedEnhances ?? [])],
    skillExp: skillExpRecord(player.skillExp),
    medicineLevel: { ...options.extras.medicineLevel },
    medicineExp: options.extras.medicineExp,
    maxMedicineExp: 0,
    map: options.map,
    pendingOfflineMs: options.pendingOfflineMs,
  };
}

function skillExpRecord(
  source: ReadonlyMap<string, { level: number; exp: number }>,
): Record<string, { level: number; exp: number }> {
  const out: Record<string, { level: number; exp: number }> = {};
  for (const [key, value] of source) out[key] = { level: value.level, exp: value.exp };
  return out;
}
