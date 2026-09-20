/**
 * `Player` —— 原版 `src/logics/player.js:589-1367` 的移植。
 *
 * ## 去单例：`PlayerAccountState`
 *
 * 原版 `Player` 直接读写三个全局单例（`game.diamonds` / `game.highestEndlessLevel` /
 * `game.bank` / `game.banned` / `world.updateRate`）。移植后这些账号级状态收敛成
 * {@link PlayerAccountState}，**由调用方注入并共享同一个对象引用**——服务端把
 * account 级别的单例挂在 `PlayerAccountState` 上，行为与原版一致（改动会互相可见）。
 *
 * ## 刻意不移植的部分（IO / 框架）
 *
 * | 原版 | 原因 |
 * |---|---|
 * | `Player.load()` / `Player.create()` | 依赖 `localStorage`、`game.checkCanCreate`、`Date.now()` 生成 key；服务端由存档仓库负责 |
 * | `Player.save()` | 依赖 `localStorage` + `world.stop`；服务端只提供 `toJSON()`，编解码走 `serialize/` |
 * | `constructor` 里的 `autorun(save, {delay: 30000})` | MobX 自动存档；服务端按关键节点显式落库 |
 * | `dispose()` | 只为释放上面的 autorun |
 * | `getInventory()` 里的 `this.save()` | 同上（保留领取逻辑本体） |
 *
 * ## 时间
 *
 * `timestamp` 的兜底原本是 `Date.now()`；移植后由构造参数 `now: () => number` 注入，
 * 因此调用方（服务端 = 真实时钟；离线结算/测试 = 虚拟时钟）完全掌控。
 */

import type { DataTables, GoodData, MapData } from '../contracts/data.js';
import { canEquipOffHand, isTwoHanded, type EquipCategory } from '@idle-dark/protocol';
import { CareerInfo, type CareerInfoJson, type EquipSlot } from './career-info.js';
import { getGoodOrder } from './goods.js';
import { InventorySlot, type InventorySlotJson } from './inventory-slot.js';
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asStringOrNull,
  asTruthyNumber,
  entriesOf,
  getEndlessLevel,
  getEndlessMapLevel,
  PlayerMeta,
  type PlayerMetaJson,
} from './player-meta.js';

/** 原版 `MAX_TICKET_STACK`：钥石堆叠上限。 */
export const MAX_TICKET_STACK = 50;

/** 技能等级上限（原版 `fromJS` 里的 `Math.min(tmp.level, 70)`）。 */
export const MAX_SKILL_LEVEL = 70;

/**
 * 默认背包格数。
 *
 * 原版 `postCreate` / `postLoad` 是 `while (< 4)`；本工程按用户要求**扩到 50 格**
 * （通货 / 精华有 18+ 种，4 格会立刻塞满并把后续掉落静默丢弃）。
 * 神力扩容在此基础上继续叠加（`upgrades.inventoryByDiamonds`）。
 */
export const DEFAULT_INVENTORY_SIZE = 50;

/** 原版 `game` / `world` 单例里被 `Player` 直接读写的那部分账号级状态。 */
export interface PlayerAccountState {
  /** 原版 `game.diamonds`（神力）。 */
  diamonds: number;
  /** 原版 `game.highestEndlessLevel`。 */
  highestEndlessLevel: number;
  /** 原版 `game.banned`。 */
  banned: boolean;
  /** 原版 `game.bank`（储藏箱；`countTicket` / `costTicket` 会读）。 */
  bank: InventorySlot[];
  /** 原版 `world.updateRate`（离线快进倍率；`addSkillExp` 会乘）。 */
  updateRate: number;
}

export function createPlayerAccountState(): PlayerAccountState {
  return { diamonds: 0, highestEndlessLevel: 0, banned: false, bank: [], updateRate: 1 };
}

/** 合同的 `MapData` 里没有 `isEndless`（原版数据表有）；这里按可选字段读取。 */
type MapDataCompat = MapData & { isEndless?: boolean };

/** TODO(port-uncertain): 冻结的 MapData 缺 `isEndless` 字段，暂按可选字段读取，等数据表补齐后收敛。 */
function isEndlessMap(map: MapData | undefined): boolean {
  return !!(map as MapDataCompat | undefined)?.isEndless;
}

export interface PlayerJson extends PlayerMetaJson {
  timestamp: number;
  timelineId: string | null;
  banned: boolean;
  careers: Record<string, CareerInfoJson>;
  gold: number;
  inventory: InventorySlotJson[];
  inventoryDiamondLevel: number;
  skillExp: Record<string, { level: number; exp: number }>;
  buildInventory: InventorySlotJson[];
  awardInventory: InventorySlotJson[];
  migrateMap: Record<string, number>;
  lootRule: Record<string, number>;
  minLootLevel: number;
  dungeonTickets: Record<string, number>;
  /** 钱包（R1）：通货 / 精华 / 一般等价物，key → 数量；**不占背包格**。 */
  wallet: Record<string, number>;
  /** 已击杀野外 BOSS 的地图 key（W4 一次性 BOSS；用于解锁下一段）。 */
  worldBossKilled: string[];
}

/** 原版 `player.js:589-1367`。 */
export class Player extends PlayerMeta {
  /** 注入的时间源（原版这里是 `Date.now()`）。 */
  readonly now: () => number;
  /** 账号级共享状态（原版散落在 `game` / `world` 单例里）。 */
  readonly account: PlayerAccountState;

  timestamp: number;
  timelineId: string | null = null;
  banned = false;

  careers = new Map<string, CareerInfo>();
  gold = 0;
  inventory: InventorySlot[] = [];
  /** 通过神力升级背包的次数。 */
  inventoryDiamondLevel = 0;
  /** Map<expGroup, { level, exp }>。 */
  skillExp = new Map<string, { level: number; exp: number }>();
  /** 锻造/分解空格。 */
  buildInventory: InventorySlot[] = [];
  /** 奖励物品空格。 */
  awardInventory: InventorySlot[] = [];
  migrateMap = new Map<string, number>();
  lootRule = new Map<string, number>();
  minLootLevel = 0;
  dungeonTickets = new Map<string, number>();
  /**
   * 钱包（R1）：通货 / 精华 / 一般等价物，key → 数量，**无容量上限、不占背包格**。
   *
   * 只承载 `GoodData.wallet === true` 的物品；混沌钥石（PoE 式地图物品）**不走钱包**。
   */
  wallet = new Map<string, number>();
  /**
   * 已击杀野外 BOSS 的地图 key 集合（W4）。
   *
   * 一次性语义：命中集合后不再刷新该图的守关 BOSS，但该图**普通怪仍可刷**。
   * 随 `Player.toJSON()` 落入 `characters.state`；`Requirement.bossKilled` 的判定数据源。
   */
  worldBossKilled = new Set<string>();

  constructor(
    tables: DataTables,
    key: string,
    now: () => number,
    account?: PlayerAccountState,
  ) {
    super(tables, key);
    this.now = now;
    this.account = account ?? createPlayerAccountState();
    this.timestamp = now();
  }

  static fromJSON(
    tables: DataTables,
    key: string,
    now: () => number,
    value: unknown,
    account?: PlayerAccountState,
  ): Player {
    return new Player(tables, key, now, account).fromJSON(value);
  }

  // ───────────────────────── 便捷访问器（原版 @computed） ─────────────────────────

  get isBanned(): boolean {
    return this.banned || this.account.banned;
  }

  get careerInfo(): CareerInfo | undefined {
    return this.currentCareer === null ? undefined : this.careers.get(this.currentCareer);
  }

  get level(): number {
    return this.careerInfo?.level ?? 0;
  }

  set level(value: number) {
    const info = this.careerInfo;
    if (!info) {
      // 原版会 TypeError；这里静默忽略（无当前职业时没有 level 可写）
      return;
    }
    info.level = value;
    this.currentCareerLevel = value;
  }

  get maxLevel(): number {
    return this.careerInfo?.maxLevel ?? 0;
  }

  set maxLevel(value: number) {
    const info = this.careerInfo;
    if (info) {
      info.maxLevel = value;
    }
  }

  get exp(): number {
    return this.careerInfo?.exp ?? 0;
  }

  set exp(value: number) {
    const info = this.careerInfo;
    if (info) {
      info.exp = value;
    }
  }

  get equipments(): Record<EquipSlot, InventorySlot> | undefined {
    return this.careerInfo?.equipments;
  }

  /** 升级所需经验。 */
  get maxExp(): number {
    return this.careerInfo?.maxExp ?? 0;
  }

  get maxSkillCount(): number {
    const { level } = this;
    if (level >= 60) {
      return 6;
    } else if (level >= 40) {
      return 5;
    } else if (level >= 20) {
      return 4;
    } else if (level >= 10) {
      return 3;
    }
    return 2;
  }

  get nextSkillUnlockLevel(): number | null {
    const { level } = this;
    if (level >= 60) {
      return null;
    } else if (level >= 40) {
      return 60;
    } else if (level >= 20) {
      return 40;
    } else if (level >= 10) {
      return 20;
    }
    return 10;
  }

  get maxEnhanceCount(): number {
    const { level } = this;
    if (level >= 60) {
      return 4;
    } else if (level >= 30) {
      return 3;
    } else if (level >= 20) {
      return 2;
    } else if (level >= 10) {
      return 1;
    }
    return 0;
  }

  get nextEnhanceUnlockLevel(): number | null {
    const { level } = this;
    if (level >= 60) {
      return null;
    } else if (level >= 30) {
      return 60;
    } else if (level >= 20) {
      return 30;
    } else if (level >= 10) {
      return 20;
    }
    return 10;
  }

  // ───────────────────────── 存档 ─────────────────────────

  /** 原版 `Player.fromJS`（隐式兜底语义逐条保留）。 */
  override fromJSON(value: unknown): this {
    const raw = asRecord(value);
    super.fromJSON(raw);

    // 原版 `v.timestamp || Date.now()`：0 也要回落到「现在」
    this.timestamp = asTruthyNumber(raw.timestamp, this.now());
    this.timelineId = asStringOrNull(raw.timelineId);
    this.minLootLevel = asNumber(raw.minLootLevel, 0);

    this.gold = asNumber(raw.gold, 0);
    this.inventoryDiamondLevel = asNumber(raw.inventoryDiamondLevel, 0);
    // 原版：`this.banned = v.banned`（可能 undefined）；这里收敛为 boolean
    this.banned = asBoolean(raw.banned, false);

    this.skillExp = new Map();
    for (const [key, item] of entriesOf(raw.skillExp)) {
      const record = asRecord(item);
      // 原版：`tmp.level = Math.min(tmp.level, 70)`（无下界；缺失时为 NaN）
      this.skillExp.set(key, {
        level: Math.min(asNumber(record.level, 0), MAX_SKILL_LEVEL),
        exp: asNumber(record.exp, 0),
      });
    }

    this.inventory = [];
    for (const item of asArray(raw.inventory)) {
      const slot = new InventorySlot(this.tables, 'inventory').fromJSON(item ?? {});
      this.inventory.push(slot);
      if (slot.key === 'ticket') {
        const endlessLevel = getEndlessLevel(slot.dungeonKey);
        if (endlessLevel && endlessLevel > this.account.highestEndlessLevel) {
          this.account.highestEndlessLevel = endlessLevel;
        }
      }
    }

    this.buildInventory = [];
    for (const item of asArray(raw.buildInventory)) {
      const slot = new InventorySlot(this.tables, 'build').fromJSON(item ?? {});
      if (!slot.empty) {
        this.buildInventory.push(slot);
      }
    }

    this.awardInventory = [];
    for (const item of asArray(raw.awardInventory)) {
      const slot = new InventorySlot(this.tables, 'award').fromJSON(item ?? {});
      if (!slot.empty) {
        this.awardInventory.push(slot);
      }
    }

    this.careers = new Map();
    for (const [key, item] of entriesOf(raw.careers)) {
      this.careers.set(key, new CareerInfo(this.tables, key).fromJSON(item));
    }

    this.migrateMap = new Map();
    for (const [key] of entriesOf(raw.migrateMap)) {
      this.migrateMap.set(key, 1);
    }

    this.lootRule = new Map();
    for (const [key, item] of entriesOf(raw.lootRule)) {
      this.lootRule.set(key, asNumber(item, 0));
    }

    // 钱包（R1）：负数 / NaN 一律收敛为 0（存档可能被手改，不能污染后续掉落累加）。
    this.wallet = new Map();
    for (const [key, item] of entriesOf(raw.wallet)) {
      const count = asNumber(item, 0);
      if (Number.isFinite(count) && count > 0) {
        this.wallet.set(key, count);
      }
    }

    // 野外 BOSS 击杀记录（W4）：只采信非空字符串，非数组 / 脏元素一律丢弃（fail-safe）。
    this.worldBossKilled = new Set();
    for (const item of asArray(raw.worldBossKilled)) {
      if (typeof item === 'string' && item.length > 0 && !this.worldBossKilled.has(item)) {
        this.worldBossKilled.add(item);
      }
    }

    // dungeonTickets：缺失时按地图配置补齐（原版语义）
    this.dungeonTickets = new Map();
    for (const key of Object.keys(this.tables.maps)) {
      const map = this.tables.maps[key];
      if (!map || !map.isDungeon || isEndlessMap(map)) {
        continue;
      }
      const defaultTickets = typeof map.defaultTicketCount === 'number' ? map.defaultTicketCount : 1;
      const ticketKey = map.group || key;
      const saved = lookupDungeonTicket(raw.dungeonTickets, ticketKey);
      this.dungeonTickets.set(ticketKey, saved !== undefined ? saved : defaultTickets);
    }

    return this;
  }

  override toJSON(): PlayerJson {
    const careers: Record<string, CareerInfoJson> = {};
    for (const [key, info] of this.careers) {
      careers[key] = info.toJSON();
    }
    const skillExp: Record<string, { level: number; exp: number }> = {};
    for (const [key, record] of this.skillExp) {
      skillExp[key] = { level: record.level, exp: record.exp };
    }
    const migrateMap: Record<string, number> = {};
    for (const [key, item] of this.migrateMap) {
      migrateMap[key] = item;
    }
    const lootRule: Record<string, number> = {};
    for (const [key, item] of this.lootRule) {
      lootRule[key] = item;
    }
    const dungeonTickets: Record<string, number> = {};
    for (const [key, item] of this.dungeonTickets) {
      dungeonTickets[key] = item;
    }
    const wallet: Record<string, number> = {};
    for (const [key, item] of this.wallet) {
      wallet[key] = item;
    }

    return {
      ...super.toJSON(),
      timestamp: this.timestamp,
      timelineId: this.timelineId,
      banned: this.banned,
      careers,
      gold: this.gold,
      inventory: this.inventory.map((slot) => slot.toJSON()),
      inventoryDiamondLevel: this.inventoryDiamondLevel,
      skillExp,
      buildInventory: this.buildInventory.map((slot) => slot.toJSON()),
      awardInventory: this.awardInventory.map((slot) => slot.toJSON()),
      migrateMap,
      lootRule,
      minLootLevel: this.minLootLevel,
      dungeonTickets,
      wallet,
      worldBossKilled: Array.from(this.worldBossKilled),
    };
  }

  // ───────────────────────── 职业 ─────────────────────────

  /** 原版 `postCreate`：选默认职业 + 补满背包格 + 发放初始物资。 */
  postCreate(): void {
    this.selectCareer(this.roleData?.defaultCareer ?? '');
    while (this.inventory.length < DEFAULT_INVENTORY_SIZE) {
      this.inventory.push(new InventorySlot(this.tables, 'inventory'));
    }

    const startup = this.roleData?.startup ?? {};
    for (const key of Object.keys(startup)) {
      const entry = startup[key];
      if (typeof entry === 'number') {
        // 材料
        const slot = this.awardInventory.find((item) => item.key === key);
        if (slot) {
          slot.count = (slot.count ?? 0) + entry;
        } else {
          this.awardInventory.push(
            new InventorySlot(this.tables, 'award').fromJSON({ key, count: entry }),
          );
        }
      } else if (entry) {
        // 装备
        this.awardInventory.push(
          new InventorySlot(this.tables, 'award').fromJSON({
            key,
            count: 1,
            quality: entry.quality,
            affixes: entry.affixes,
          }),
        );
      }
    }
  }

  /** 原版 `postLoad`。 */
  postLoad(): void {
    this.selectCareer(this.currentCareer ?? '');
    while (this.inventory.length < DEFAULT_INVENTORY_SIZE) {
      this.inventory.push(new InventorySlot(this.tables, 'inventory'));
    }
  }

  /** 原版 `selectCareer`。 */
  selectCareer(career: string): void {
    this.currentCareer = career;
    const careerData = this.tables.careers[career];

    if (!this.careers.has(career)) {
      const info = new CareerInfo(this.tables, career);
      if (careerData) {
        info.selectedSkills = Object.keys(careerData.skills).filter(
          (key) => (careerData.skills[key] ?? 0) <= 1,
        );
        const weapon = careerData.equipments?.weapon;
        if (weapon) {
          info.equipments.weapon.fromJSON({ key: weapon, count: 1 });
        }
      }
      this.careers.set(career, info);
    }

    this.currentCareerLevel = this.level;

    if (careerData) {
      for (const key of Object.keys(careerData.skills)) {
        const group = this.tables.skills[key]?.expGroup || key;
        if (!this.skillExp.has(group)) {
          this.skillExp.set(group, { level: 0, exp: 0 });
        }
      }
    }
  }

  getCareerLevel(key: string): number {
    const data = this.careers.get(key);
    return data ? data.level : 0;
  }

  // ───────────────────────── 背包 ─────────────────────────

  /** 原版 `emptySlot(target)`：返回第一个空格下标，无空格返回 -1。 */
  emptySlot(target: InventorySlot[]): number {
    for (let i = 0; i < target.length; i++) {
      if (!target[i]!.key) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 原版 `notFullSlot(target, key, stack, dungeonKey)`：找可继续堆叠的格子；
   * 找不到则占用一个空格并写入 key（**副作用**，与原版一致）。
   */
  notFullSlot(
    target: InventorySlot[],
    key: string,
    stack: number,
    dungeonKey: string | null = null,
  ): number {
    for (let i = 0; i < target.length; i++) {
      const slot = target[i]!;
      if (
        slot &&
        slot.key === key &&
        (key !== 'ticket' || dungeonKey === slot.dungeonKey) &&
        (slot.count ?? 0) < stack
      ) {
        return i;
      }
    }
    const ret = this.emptySlot(target);
    if (ret >= 0) {
      target[ret]!.key = key;
      if (key === 'ticket') {
        target[ret]!.dungeonKey = dungeonKey;
      }
    }
    return ret;
  }

  /**
   * 原版 `loot(good, _target)`：入包（金币/神力直接结算，其余按堆叠规则）。
   *
   * R1 起：`GoodData.wallet === true` 的物品（通货 / 精华 / 一般等价物）走**钱包分支** ——
   * 不碰 `inventory`、无容量上限，返回**全部**数量（因此钱包物品永远不会 `lost`）。
   *
   * @returns **实际落地**的数量（0 = 包裹放不下、整份被丢弃）。调用方据此决定是否上报
   *          「获得战利品」—— 否则会出现「弹了提示但背包里没有」。
   */
  loot(good: InventorySlot, target?: InventorySlot[]): number {
    const bag = target ?? this.inventory;
    const { key } = good;

    if (good.empty || key === null) {
      return 0;
    }
    const before = good.count ?? 0;
    if (key === 'gold') {
      this.gold += before;
      good.clear();
      return before;
    }
    if (key === 'diamonds') {
      this.account.diamonds += before;
      good.clear();
      return before;
    }
    // 钱包物品：无容量上限，永远全额落地（负数 / NaN 收敛为 0，不污染钱包）。
    if (this.isWalletGood(key)) {
      const amount = Number.isFinite(before) && before > 0 ? before : 0;
      if (amount > 0) {
        this.wallet.set(key, (this.wallet.get(key) ?? 0) + amount);
      }
      good.clear();
      return amount;
    }
    // 原版 `goods[key].stack`（未知 key 会 TypeError）；这里未知 key 视为不可堆叠
    const limit = key === 'ticket' ? MAX_TICKET_STACK : this.tables.goods[key]?.stack;
    if (!limit) {
      // 不可堆叠物品
      const index = this.emptySlot(bag);
      if (index < 0) {
        return 0;
      }
      bag[index]!.fromJSON(good.toJSON());
      good.clear();
      return before;
    }

    // 可以堆叠物品
    while ((good.count ?? 0) > 0) {
      const index = this.notFullSlot(bag, key, limit, good.dungeonKey);
      if (index < 0) {
        // 没有获取完毕：剩余部分被丢弃。
        break;
      }
      const canPlace = Math.min(good.count ?? 0, limit - (bag[index]!.count ?? 0));
      bag[index]!.count = (bag[index]!.count ?? 0) + canPlace;
      good.count = (good.count ?? 0) - canPlace;
    }

    const remaining = good.count ?? 0;
    if (key === 'ticket' && remaining === 0) {
      const endlessLevel = getEndlessLevel(good.dungeonKey);
      if (endlessLevel && endlessLevel > this.account.highestEndlessLevel) {
        this.account.highestEndlessLevel = endlessLevel;
      }
    }
    if (remaining === 0) {
      good.clear();
    }
    // 实际入包数量（剩余部分 = 包裹放不下，已被丢弃）。
    return before - remaining;
  }

  /** 原版 `sellItem(slot, count)`。 */
  sellItem(slot: InventorySlot, count: number): void {
    if (slot.key === null) {
      return;
    }
    this.gold += slot.price * count;
    if (slot.position === 'build') {
      this.buildInventory = this.buildInventory.filter((item) => item !== slot);
    } else if (slot.position === 'award') {
      this.awardInventory = this.awardInventory.filter((item) => item !== slot);
    } else {
      slot.count = (slot.count ?? 0) - count;
      if (slot.count === 0) {
        slot.clear();
      }
    }
  }

  /** 原版 `countTicket(dungeonKey)`：地城钥匙 = 地图票 + 背包钥石 + 银行钥石。 */
  countTicket(dungeonKey: string): number {
    let count = this.dungeonTickets.get(dungeonKey) ?? 0;
    count += this.inventory.reduce(
      (sum, slot) =>
        slot.key === 'ticket' && slot.dungeonKey === dungeonKey ? sum + (slot.count ?? 0) : sum,
      0,
    );
    count += this.account.bank.reduce(
      (sum, slot) =>
        slot.key === 'ticket' && slot.dungeonKey === dungeonKey ? sum + (slot.count ?? 0) : sum,
      0,
    );
    return count;
  }

  /** 原版 `costTicket(key)`。 */
  costTicket(key: string): void {
    const mapCount = this.dungeonTickets.get(key);
    if (mapCount !== undefined && mapCount > 0) {
      this.dungeonTickets.set(key, mapCount - 1);
      return;
    }
    const finalSlot =
      this.inventory.find((slot) => slot.key === 'ticket' && slot.dungeonKey === key) ??
      this.account.bank.find((slot) => slot.key === 'ticket' && slot.dungeonKey === key);
    if (finalSlot) {
      finalSlot.count = (finalSlot.count ?? 0) - 1;
      if (finalSlot.count === 0) {
        finalSlot.clear();
      }
    }
  }

  /** 原版 `countGood(key)`：只统计背包（不含银行/锻造/奖励格，**也不含钱包**）。 */
  countGood(key: string): number {
    return this.inventory.reduce((sum, slot) => (slot.key === key ? sum + (slot.count ?? 0) : sum), 0);
  }

  /** 该 key 是否为钱包物品（`GoodData.wallet === true`）。未知 key 一律 false。 */
  isWalletGood(key: string): boolean {
    return this.tables.goods[key]?.wallet === true;
  }

  /** 钱包持有量（不存在 / 脏数据 → 0）。 */
  walletCount(key: string): number {
    const count = this.wallet.get(key);
    return typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : 0;
  }

  /** 该地图的野外 BOSS 是否已被本角色击杀（W4）。非法 key → false。 */
  hasWorldBossKilled(map: string): boolean {
    return typeof map === 'string' && map.length > 0 && this.worldBossKilled.has(map);
  }

  /** 登记「该地图野外 BOSS 已击杀」（W4）。幂等；非法 key 忽略。 */
  markWorldBossKilled(map: string): void {
    if (typeof map === 'string' && map.length > 0) {
      this.worldBossKilled.add(map);
    }
  }

  /**
   * 从钱包扣除 `count`，返回**未扣完的剩余数量**（0 = 扣清）。
   *
   * 与 `costGood` 保持同一返回约定；余额不足时不部分扣除（原子语义：要么全扣、要么不动），
   * 调用方按剩余 > 0 判失败。负数 / NaN 的 `count` 视为非法，原样返回（不扣款）。
   */
  costWallet(key: string, count: number): number {
    if (Number.isNaN(count) || count <= 0) {
      return Number.isNaN(count) ? count : 0;
    }
    const have = this.walletCount(key);
    if (have < count) {
      return count - have;
    }
    const rest = have - count;
    if (rest > 0) {
      this.wallet.set(key, rest);
    } else {
      this.wallet.delete(key);
    }
    return 0;
  }

  /** 原版 `costGood(key, count)`：从背包**尾部**开始扣，返回未扣完的剩余数量。 */
  costGood(key: string, count: number): number {
    let rest = count;
    for (let i = this.inventory.length - 1; i >= 0; i--) {
      const slot = this.inventory[i]!;
      if (slot.key === key) {
        const dec = Math.min(rest, slot.count ?? 0);
        slot.count = (slot.count ?? 0) - dec;
        if ((slot.count ?? 0) <= 0) {
          slot.clear();
        }
        rest -= dec;
        if (rest <= 0) {
          return 0;
        }
      }
    }
    return rest;
  }

  /**
   * 原版 `getInventory(target)`：从生产/奖励包裹里领取所有物品
   * （包裹已满时剩余的原样保留在对应包裹里）。
   *
   * 签名变化：原版内部直接调用单例 `world.lootGoods(target)` 并 `this.save()`；
   * 这里把 `lootGoods` 作为参数注入，并去掉存档副作用（服务端在同一事务里显式落库）。
   */
  getInventory(
    target: InventorySlot[],
    lootGoods: (target: InventorySlot[]) => InventorySlot[],
  ): void {
    const next = lootGoods(target);
    target.length = 0;
    target.push(...next);
  }

  // ───────────────────────── 技能 ─────────────────────────

  /** 原版 `getSkillLevel(key)`（按 `expGroup` 共享等级）。 */
  getSkillLevel(key: string): number {
    const group = this.tables.skills[key]?.expGroup || key;
    return this.skillExp.get(group)?.level ?? 0;
  }

  /**
   * 原版 `addSkillExp(key, value)`。
   *
   * 与原版一致的两个门槛：技能等级不得超过 `currentCareerLevel`；升级只结算一次
   * （`if (exp >= maxExp)`，**不是 while**）。
   * 经验倍率取 `account.updateRate`（原版 `world.updateRate`，离线快进的放大系数）。
   */
  addSkillExp(key: string, value: number): void {
    const skillData = this.tables.skills[key];
    if (!skillData) {
      return;
    }
    const record = this.skillExp.get(skillData.expGroup || key);
    if (!record) {
      return;
    }
    if (record.level > this.currentCareerLevel) {
      return;
    }

    const maxExp = skillData.maxExp(record.level);
    record.exp += this.account.updateRate * value;
    if (record.exp >= maxExp) {
      record.exp -= maxExp;
      record.level += 1;
    }
  }

  // ───────────────────────── 装备 ─────────────────────────

  /** 主手武器的装备类别（空槽 / 非武器 → null）。 */
  private mainHandCategory(): EquipCategory | null {
    const main = this.equipments?.weapon;
    if (!main || main.empty) {
      return null;
    }
    return main.goodData?.equipCategory ?? null;
  }

  /**
   * 底材 → 实际落槽（P2 + §2.3 判定表的落地）。
   *
   * - 单手武器：主手空 → 主手；主手是单手武器且副手空 → 副手（**双持**）；否则换主手；
   * - 双手近战 / 弓 → 主手；
   * - 副手专属（盾 / 箭袋）→ 必须过 `canEquipOffHand`，否则拒绝；
   * - 戒指：两个戒指槽里第一个空的；都满则换 ring1。
   */
  private resolveEquipTarget(goodData: GoodData): EquipSlot | null {
    const equipments = this.equipments;
    const position = goodData.position;
    if (!equipments || !position) {
      return null;
    }
    const category = goodData.equipCategory ?? null;

    if (position === 'weapon') {
      if (
        category === 'oneHand' &&
        !equipments.weapon.empty &&
        equipments.weapon.goodData?.equipCategory === 'oneHand' &&
        equipments.offHand.empty
      ) {
        return 'offHand';
      }
      return 'weapon';
    }

    if (position === 'offHand') {
      return canEquipOffHand(this.mainHandCategory(), category) ? 'offHand' : null;
    }

    if (position === 'ring1' || position === 'ring2') {
      if (equipments[position].empty) {
        return position;
      }
      const other: EquipSlot = position === 'ring1' ? 'ring2' : 'ring1';
      return equipments[other].empty ? other : position;
    }

    return position;
  }

  private moveToInventory(item: InventorySlot): boolean {
    const empty = this.emptySlot(this.inventory);
    if (empty < 0) {
      return false;
    }
    this.inventory[empty]!.swap(item);
    return true;
  }

  /**
   * 原版 `equip(slot)`；P2 起返回**是否装备成功**（判定表拒绝 / 无处安放副手时为 false）。
   */
  equip(slot: InventorySlot): boolean {
    const { goodData } = slot;
    if (!goodData || goodData.type !== 'equip') {
      return false;
    }
    const target = this.resolveEquipTarget(goodData);
    const equipments = this.equipments;
    if (!target || !equipments) {
      return false;
    }

    // 双手武器占据副手：先把副手物挪回背包，腾不出空位则拒绝。
    if (target === 'weapon' && isTwoHanded(goodData.equipCategory) && !equipments.offHand.empty) {
      if (!this.moveToInventory(equipments.offHand)) {
        return false;
      }
    }

    equipments[target].swap(slot);
    return true;
  }

  /** 原版 `unequip(slot)`：换到第一个空格。 */
  unequip(slot: InventorySlot): void {
    const empty = this.emptySlot(this.inventory);
    if (empty >= 0) {
      this.inventory[empty]!.swap(slot);
    }
  }

  /**
   * 原版 `sortInventory(target)`：整理背包（类型 → 钥石地图等级 → 品质 → 部位/等级 → goodOrder）。
   *
   * ⚠️ 原版比较两张钥石地图等级时写作 `(mapData1 && mapData2.level)`：
   * 守卫用 `a` 的地图、取值用 `b` 的地图。取值逻辑是正确的，只有守卫写错了
   * （a 的地图不存在时 `level2` 会退化为 0），此处逐行保留。
   *
   * 注：临时格子统一用 `position='inventory'` 构造，但最终是写回 `target` 的**原有格子**
   * （`loot` 只覆盖内容，不覆盖 `position`），因此目标容器的格子归属不会改变。
   */
  sortInventory(target: InventorySlot[] = this.inventory): void {
    const goodOrder = getGoodOrder(this.tables);
    const tmp = target
      .filter((item) => item.key)
      .map((item) => new InventorySlot(this.tables, 'inventory').fromJSON(item.toJSON()));

    const compMap = (a: string, b: string, map: Record<string, number>): number =>
      (map[a] ?? 0) - (map[b] ?? 0);

    tmp.sort((a, b) => {
      const atype = a.goodData ? a.goodData.type : (a.key ?? '');
      const btype = b.goodData ? b.goodData.type : (b.key ?? '');
      if (atype !== btype) {
        return compMap(atype, btype, {
          junk: 0,
          package: 1,
          material: 2,
          ticket: 3,
          equip: 4,
        });
      }
      if (atype === 'ticket' && a.dungeonKey !== b.dungeonKey) {
        // 地图的话，比较地图等级和key
        const mapData1 = a.dungeonKey === null ? undefined : this.tables.maps[a.dungeonKey];
        const mapData2 = b.dungeonKey === null ? undefined : this.tables.maps[b.dungeonKey];
        const level1 = getEndlessMapLevel(a.dungeonKey) || mapData1?.level || 0;
        // 原版写作 `(mapData1 && mapData2.level)`：**守卫**用 mapData1、**取值**用 mapData2。
        // 取值是对的，只有守卫对象写错了（当 a 的地图缺失、b 的等级 >0 时会退化为 0），逐行保留。
        const level2 = getEndlessMapLevel(b.dungeonKey) || (mapData1 ? mapData2?.level : undefined) || 0;
        if (level1 !== level2) {
          return level1 - level2;
        }
        return (a.dungeonKey ?? '') < (b.dungeonKey ?? '') ? -1 : 1;
      }
      const aq = a.displayQuality;
      const bq = b.displayQuality;
      if (aq !== bq) {
        return (aq ?? 0) - (bq ?? 0);
      }
      if (atype === 'equip') {
        const ao = a.equipPositionOrder;
        const bo = b.equipPositionOrder;
        if (ao !== bo) {
          return (ao ?? 0) - (bo ?? 0);
        }
        if (a.level !== b.level) {
          return a.level - b.level;
        }
      }
      return compMap(a.key ?? '', b.key ?? '', goodOrder);
    });

    target.forEach((item) => item.clear());
    for (const slot of tmp) {
      this.loot(slot, target);
    }
  }
}

/** 读取存档里的 `dungeonTickets`（同时支持 Map 与普通对象；原版还支持 ObservableMap）。 */
function lookupDungeonTicket(source: unknown, key: string): number | undefined {
  if (source instanceof Map) {
    const value: unknown = source.get(key);
    return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
  }
  const raw = asRecord(source)[key];
  return typeof raw === 'number' && !Number.isNaN(raw) ? raw : undefined;
}
