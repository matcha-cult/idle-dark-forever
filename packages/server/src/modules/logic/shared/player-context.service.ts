/**
 * `PlayerContextService` —— DB ↔ game-core 的胶水层
 *
 * 这是整个逻辑域的**关键抽象**：`game-core` 只提供纯内存的 `Player`
 * （`fromJSON` / `toJSON`），不提供任何 IO（原版的 `Player.load/create/save` 与 30s
 * `autorun` 都没移植）。本服务负责：
 *
 * 1. **读**：`characters.state`(JSONB) + `account_state` → `Player.fromJSON` 重建；
 * 2. **写**：脏标记 + 择机 `flush`（**不每 tick 落库**，见 `AGENTS.md` §1 与方案 §9.1）；
 * 3. **账号级共享**：同账号所有 `Player` 共享**同一个** `PlayerAccountState` 对象引用
 *    （game-core 明确要求；否则神力 / 银行跨角色不一致）；
 * 4. **单例 `DataTables`**：`createDefaultTables()` 只跑一次（`registerYear2018` 会改表）。
 *
 * 时间一律走注入的 `GAME_CLOCK`，禁止裸 `Date.now()`。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  InventorySlot,
  Player,
  createPlayerAccountState,
  type DataTables,
  type PlayerAccountState,
  type PlayerJson,
} from '@idle-dark/game-core';
import { GameDatabaseService } from '../../game/game-database.service.js';
import { DATA_TABLES, GAME_CLOCK, type NowSource } from './game-clock.js';
import {
  createAccountExtras,
  type AccountExtras,
  type ChallengeEntry,
  type DungeonCooldownEntry,
} from './player-dto.js';
import { normalizeChallengeQueue } from './challenge-queue.js';

/** 默认落库节流间隔（供 world tick 定期 flush 参考；本服务不主动起定时器）。 */
export const DEFAULT_PERSIST_INTERVAL_MS = 30_000;

interface CharacterStateRow {
  id: string;
  user_id: string;
  role: string;
  career: string;
  state: unknown;
}

interface AccountStateRow {
  diamonds: number | null;
  highest_endless_level: number | null;
  data: unknown;
}

interface CacheEntry {
  player: Player;
  dirty: boolean;
}

interface AccountEntry {
  account: PlayerAccountState;
  extras: AccountExtras;
  dirty: boolean;
}

/** `account_state.data` 的落库形状。 */
interface AccountDataJson {
  banned?: boolean;
  updateRate?: number;
  bank?: unknown[];
  storiesMap?: Record<string, string>;
  enemyTasks?: Record<string, Record<string, number>>;
  medicineLevel?: Record<string, number>;
  medicineExp?: number;
  worldSeeds?: Record<string, number>;
  worldMaps?: Record<string, { map?: unknown; endlessLevel?: unknown }>;
  challengeQueue?: Record<string, unknown>;
  dungeonCooldowns?: Record<string, unknown>;
}

@Injectable()
export class PlayerContextService {
  /** 只读数据表单例（数据表内含函数与活动注册顺序，必须全局唯一）。 */
  readonly tables: DataTables;

  private readonly logger = new Logger(PlayerContextService.name);
  private readonly now: NowSource;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly accounts = new Map<number, AccountEntry>();

  constructor(
    private readonly db: GameDatabaseService,
    @Inject(GAME_CLOCK) now: NowSource,
    @Inject(DATA_TABLES) tables: DataTables,
  ) {
    this.now = now;
    this.tables = tables;
  }

  // ────────────────────────────── 缓存 key ──────────────────────────────

  private cacheKey(userId: number, characterId: string): string {
    return `${userId}\u0000${characterId}`;
  }

  has(userId: number, characterId: string): boolean {
    return this.cache.has(this.cacheKey(userId, characterId));
  }

  /** 当前内存中的角色（未加载返回 null；不触发 IO）。 */
  peek(userId: number, characterId: string): Player | null {
    return this.cache.get(this.cacheKey(userId, characterId))?.player ?? null;
  }

  /** 已加载角色数 / 脏角色数（运维与测试可见）。 */
  get stats(): { loaded: number; dirty: number; accounts: number } {
    let dirty = 0;
    for (const entry of this.cache.values()) if (entry.dirty) dirty += 1;
    return { loaded: this.cache.size, dirty, accounts: this.accounts.size };
  }

  // ────────────────────────────── 读 ──────────────────────────────

  /**
   * 加载角色。命中缓存直接返回；否则读 DB 重建。
   *
   * @returns 角色不存在（或不属于该用户）返回 `null`，不抛错。
   */
  async load(userId: number, characterId: string): Promise<Player | null> {
    if (!isPositiveInt(userId) || characterId.trim() === '') return null;

    const key = this.cacheKey(userId, characterId);
    const cached = this.cache.get(key);
    if (cached) return cached.player;

    const rows = await this.db.query<CharacterStateRow>(
      `SELECT id, user_id, role, career, state
         FROM characters
        WHERE id = $1 AND user_id = $2`,
      [characterId, userId],
    );
    const row = rows.rows[0];
    if (!row) return null;

    const accountEntry = await this.accountEntryOf(userId);
    const player = Player.fromJSON(
      this.tables,
      characterId,
      this.now,
      row.state,
      accountEntry.account,
    );

    if (isBlankState(row.state)) {
      // 旧占位行（`state = '{}'`）：按列里的 role/career 重建初始存档，避免空档角色。
      hydrateFresh(player, row.role, row.career);
      this.cache.set(key, { player, dirty: true });
      await this.flush(userId, characterId);
      return player;
    }

    player.postLoad();
    this.cache.set(key, { player, dirty: false });
    return player;
  }

  /**
   * 创建角色：用默认存档逻辑生成初始 `Player` 并**立即落库**。
   *
   * 前置条件：`characters` 行已存在（由 `CharacterService` / player Action 负责插入）。
   */
  async create(
    userId: number,
    characterId: string,
    role: string,
    career?: string,
  ): Promise<Player> {
    const accountEntry = await this.accountEntryOf(userId);
    const player = new Player(this.tables, characterId, this.now, accountEntry.account);
    hydrateFresh(player, role, career);
    this.cache.set(this.cacheKey(userId, characterId), { player, dirty: true });
    await this.flush(userId, characterId);
    return player;
  }

  /** 用一份现成的存档对象覆盖创建（`importSave` 用）：不经过 `postCreate`。 */
  async adopt(
    userId: number,
    characterId: string,
    state: unknown,
  ): Promise<Player> {
    const accountEntry = await this.accountEntryOf(userId);
    const player = Player.fromJSON(this.tables, characterId, this.now, state, accountEntry.account);
    player.key = characterId;
    player.postLoad();
    this.cache.set(this.cacheKey(userId, characterId), { player, dirty: true });
    await this.flush(userId, characterId);
    return player;
  }

  /** 丢弃内存副本，下次 `load` 重新读库（导入存档 / 外部改库后用）。 */
  invalidate(userId: number, characterId: string): void {
    this.cache.delete(this.cacheKey(userId, characterId));
  }

  // ────────────────────────────── 账号级状态 ──────────────────────────────

  /** 账号级共享对象（同 userId 同引用）。 */
  async accountEntryOf(userId: number): Promise<AccountEntry> {
    const cached = this.accounts.get(userId);
    if (cached) return cached;

    const rows = await this.db.query<AccountStateRow>(
      `SELECT diamonds, highest_endless_level, data FROM account_state WHERE user_id = $1`,
      [userId],
    );
    const row = rows.rows[0];
    const account = createPlayerAccountState();
    const extras = createAccountExtras();
    if (row) {
      account.diamonds = finiteOr(row.diamonds, 0);
      account.highestEndlessLevel = finiteOr(row.highest_endless_level, 0);
      applyAccountData(row.data, this.tables, account, extras);
    }
    const entry: AccountEntry = { account, extras, dirty: false };
    this.accounts.set(userId, entry);
    return entry;
  }

  async accountOf(userId: number): Promise<PlayerAccountState> {
    return (await this.accountEntryOf(userId)).account;
  }

  async extrasOf(userId: number): Promise<AccountExtras> {
    return (await this.accountEntryOf(userId)).extras;
  }

  /**
   * 同步取已缓存的账号级扩展状态（未加载返回 `null`，**不触发 IO**）。
   *
   * 供**同步事件订阅方**使用（如 battle 击杀 → quest 递减击杀任务，发生在仿真热路径内，
   * 不能 await）。调用方必须保证该账号此前已 `load`/`extrasOf` 过。
   */
  peekExtras(userId: number): AccountExtras | null {
    return this.accounts.get(userId)?.extras ?? null;
  }

  markAccountDirty(userId: number): void {
    const entry = this.accounts.get(userId);
    if (entry) entry.dirty = true;
  }

  /** 登出 / 长时间空闲时释放账号级缓存（先 flush）。 */
  async evictAccount(userId: number): Promise<void> {
    await this.flushAccount(userId);
    this.accounts.delete(userId);
  }

  // ────────────────────────────── 写 / 脏标记 ──────────────────────────────

  markDirty(userId: number, characterId: string): void {
    const entry = this.cache.get(this.cacheKey(userId, characterId));
    if (entry) entry.dirty = true;
  }

  /**
   * 落库单个角色（连同账号级状态）。
   *
   * @returns 是否真正写了库（未命中缓存或非脏返回 false）。
   */
  async flush(userId: number, characterId: string): Promise<boolean> {
    const entry = this.cache.get(this.cacheKey(userId, characterId));
    if (!entry || !entry.dirty) return false;

    const player = entry.player;
    const career = player.currentCareer;
    const state: PlayerJson = player.toJSON();
    await this.db.query(
      `UPDATE characters
          SET state = $1::jsonb,
              role = $2,
              career = $3,
              level = $4,
              peak_level = $5,
              last_settle_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND user_id = $7`,
      [
        JSON.stringify(state),
        player.role,
        career ?? '',
        finiteInt(player.level, 1),
        finiteInt(player.peakLevel, 0),
        characterId,
        userId,
      ],
    );
    entry.dirty = false;
    await this.flushAccount(userId);
    return true;
  }

  /** 当前角色可选注入的落库锚点（`last_settle_at` 由 DB 时间维护）。 */
  async flushAccount(userId: number): Promise<boolean> {
    const entry = this.accounts.get(userId);
    if (!entry || !entry.dirty) return false;
    const data: AccountDataJson = {
      banned: entry.account.banned,
      updateRate: entry.account.updateRate,
      bank: entry.account.bank.map((slot) => slot.toJSON()),
      storiesMap: { ...entry.extras.storiesMap },
      enemyTasks: cloneTasks(entry.extras.enemyTasks),
      medicineLevel: { ...entry.extras.medicineLevel },
      medicineExp: entry.extras.medicineExp,
      worldSeeds: { ...entry.extras.worldSeeds },
      worldMaps: cloneWorldMaps(entry.extras.worldMaps),
      challengeQueue: cloneChallengeQueue(entry.extras.challengeQueue),
      dungeonCooldowns: cloneDungeonCooldowns(entry.extras.dungeonCooldowns),
    };
    await this.db.query(
      `INSERT INTO account_state (user_id, diamonds, highest_endless_level, data, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE
          SET diamonds = EXCLUDED.diamonds,
              highest_endless_level = EXCLUDED.highest_endless_level,
              data = EXCLUDED.data,
              updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        finiteInt(entry.account.diamonds, 0),
        finiteInt(entry.account.highestEndlessLevel, 0),
        JSON.stringify(data),
      ],
    );
    entry.dirty = false;
    return true;
  }

  /** 切人 / 登出：先落库再移出内存（绝不丢脏数据）。 */
  async evict(userId: number, characterId: string): Promise<void> {
    await this.flush(userId, characterId);
    this.cache.delete(this.cacheKey(userId, characterId));
  }

  /**
   * 定时批量落库（world tick 每 ~30s 调一次；**不要每 tick 调**）。
   *
   * @returns 实际落库的角色数。
   */
  async flushDirty(): Promise<number> {
    let flushed = 0;
    for (const [key, entry] of [...this.cache]) {
      if (!entry.dirty) continue;
      const sep = key.indexOf('\u0000');
      const userId = Number(key.slice(0, sep));
      const characterId = key.slice(sep + 1);
      if (await this.flush(userId, characterId)) flushed += 1;
    }
    for (const [userId, entry] of [...this.accounts]) {
      if (entry.dirty) await this.flushAccount(userId);
    }
    return flushed;
  }

  /** 全部落库（关服 / 测试）。 */
  async flushAll(): Promise<number> {
    return this.flushDirty();
  }

  /** 清空全部内存（测试）。 */
  reset(): void {
    this.cache.clear();
    this.accounts.clear();
  }
}

// ────────────────────────────── 纯函数辅助 ──────────────────────────────

/** 用 role/career 生成一份初始存档（等价 `Player.postCreate`，但不依赖 roleData 存在）。 */
function hydrateFresh(player: Player, role: string, career?: string): void {
  const roleKey = player.tables.roles[role] ? role : Object.keys(player.tables.roles)[0] ?? '';
  player.role = roleKey;
  player.postCreate();
  const target = career && player.tables.careers[career] ? career : undefined;
  if (target && target !== player.currentCareer) {
    player.selectCareer(target);
  }
}

function isBlankState(state: unknown): boolean {
  if (state === null || state === undefined) return true;
  if (typeof state !== 'object' || Array.isArray(state)) return true;
  return Object.keys(state as Record<string, unknown>).length === 0;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteInt(value: unknown, fallback: number): number {
  const n = finiteOr(value, fallback);
  return Math.trunc(n);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function applyAccountData(
  raw: unknown,
  tables: DataTables,
  account: PlayerAccountState,
  extras: AccountExtras,
): void {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return;
  const data = raw as AccountDataJson;
  if (typeof data.banned === 'boolean') account.banned = data.banned;
  if (typeof data.updateRate === 'number' && Number.isFinite(data.updateRate)) {
    account.updateRate = data.updateRate;
  }
  if (Array.isArray(data.bank)) {
    account.bank = data.bank
      .map((item) => new InventorySlot(tables, 'bank').fromJSON(item ?? {}))
      .filter((slot) => !slot.empty);
  }
  if (data.storiesMap && typeof data.storiesMap === 'object') {
    for (const key of Object.keys(data.storiesMap)) {
      const value = data.storiesMap[key];
      if (typeof value === 'string') extras.storiesMap[key] = value;
    }
  }
  if (data.enemyTasks && typeof data.enemyTasks === 'object') {
    for (const key of Object.keys(data.enemyTasks)) {
      const inner = data.enemyTasks[key];
      if (!inner || typeof inner !== 'object') continue;
      const out: Record<string, number> = {};
      for (const storyKey of Object.keys(inner)) {
        const count = inner[storyKey];
        if (typeof count === 'number' && Number.isFinite(count)) out[storyKey] = count;
      }
      extras.enemyTasks[key] = out;
    }
  }
  if (data.medicineLevel && typeof data.medicineLevel === 'object') {
    for (const key of Object.keys(data.medicineLevel)) {
      const level = data.medicineLevel[key];
      if (typeof level === 'number' && Number.isFinite(level)) extras.medicineLevel[key] = level;
    }
  }
  if (typeof data.medicineExp === 'number' && Number.isFinite(data.medicineExp)) {
    extras.medicineExp = data.medicineExp;
  }
  if (data.worldSeeds && typeof data.worldSeeds === 'object') {
    for (const key of Object.keys(data.worldSeeds)) {
      const seed = data.worldSeeds[key];
      if (typeof seed === 'number' && Number.isFinite(seed)) extras.worldSeeds[key] = seed;
    }
  }
  if (data.worldMaps && typeof data.worldMaps === 'object') {
    for (const key of Object.keys(data.worldMaps)) {
      const entry = data.worldMaps[key];
      if (!entry || typeof entry !== 'object') continue;
      const map = typeof entry.map === 'string' && entry.map !== '' ? entry.map : 'home';
      const endlessLevel =
        typeof entry.endlessLevel === 'number' && Number.isFinite(entry.endlessLevel)
          ? Math.trunc(entry.endlessLevel)
          : 0;
      extras.worldMaps[key] = { map, endlessLevel };
    }
  }
  if (data.challengeQueue && typeof data.challengeQueue === 'object') {
    const queueByCharacter = data.challengeQueue as Record<string, unknown>;
    for (const characterId of Object.keys(queueByCharacter)) {
      extras.challengeQueue[characterId] = normalizeChallengeQueue(queueByCharacter[characterId], tables);
    }
  }
  if (data.dungeonCooldowns && typeof data.dungeonCooldowns === 'object') {
    const cooldownByCharacter = data.dungeonCooldowns as Record<string, unknown>;
    for (const characterId of Object.keys(cooldownByCharacter)) {
      const perChar = cooldownByCharacter[characterId];
      if (!perChar || typeof perChar !== 'object' || Array.isArray(perChar)) continue;
      const perCharMap = perChar as Record<string, unknown>;
      const out: Record<string, DungeonCooldownEntry> = {};
      for (const ticketKey of Object.keys(perCharMap)) {
        const cdRaw: unknown = perCharMap[ticketKey];
        if (!cdRaw || typeof cdRaw !== 'object') continue;
        out[ticketKey] = {
          stacks: finiteInt((cdRaw as { stacks?: unknown }).stacks, 0),
          lastResetAt: finiteOr((cdRaw as { lastResetAt?: unknown }).lastResetAt, 0),
          lastUsedAt: finiteOr((cdRaw as { lastUsedAt?: unknown }).lastUsedAt, 0),
        };
      }
      if (Object.keys(out).length > 0) extras.dungeonCooldowns[characterId] = out;
    }
  }
}

function cloneTasks(source: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const key of Object.keys(source)) {
    const inner = source[key];
    if (inner) out[key] = { ...inner };
  }
  return out;
}

function cloneWorldMaps(
  source: Record<string, { map: string; endlessLevel: number }>,
): Record<string, { map: string; endlessLevel: number }> {
  const out: Record<string, { map: string; endlessLevel: number }> = {};
  for (const key of Object.keys(source)) {
    const entry = source[key];
    if (entry) out[key] = { map: entry.map, endlessLevel: entry.endlessLevel };
  }
  return out;
}

function cloneChallengeQueue(
  source: Record<string, ChallengeEntry[]>,
): Record<string, ChallengeEntry[]> {
  const out: Record<string, ChallengeEntry[]> = {};
  for (const key of Object.keys(source)) {
    const entries = source[key];
    if (entries) out[key] = entries.map((e) => ({ key: e.key, endlessLevel: e.endlessLevel }));
  }
  return out;
}

function cloneDungeonCooldowns(
  source: Record<string, Record<string, DungeonCooldownEntry>>,
): Record<string, Record<string, DungeonCooldownEntry>> {
  const out: Record<string, Record<string, DungeonCooldownEntry>> = {};
  for (const characterId of Object.keys(source)) {
    const perChar = source[characterId];
    if (!perChar) continue;
    const inner: Record<string, DungeonCooldownEntry> = {};
    for (const ticketKey of Object.keys(perChar)) {
      const entry = perChar[ticketKey];
      if (entry) {
        inner[ticketKey] = {
          stacks: entry.stacks,
          lastResetAt: entry.lastResetAt,
          lastUsedAt: entry.lastUsedAt,
        };
      }
    }
    out[characterId] = inner;
  }
  return out;
}
