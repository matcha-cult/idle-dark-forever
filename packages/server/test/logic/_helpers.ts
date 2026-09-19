/**
 * 面板域单测公共夹具。
 *
 * 全部单据都是**内存夹具**：`DataTables` 用 `createDefaultTables()`（真实数据表），
 * `Player` 用 game-core 的真实类，`PlayerContextService` 用结构替身（不碰 DB）。
 */
import {
  InventorySlot,
  Player,
  createDefaultTables,
  createPlayerAccountState,
  type DataTables,
  type PlayerAccountState,
} from '@idle-dark/game-core';
import type { PlayerContextService } from '../../src/modules/logic/shared/player-context.service.js';
import {
  createAccountExtras,
  type AccountExtras,
} from '../../src/modules/logic/shared/player-dto.js';
import type { PanelCharacterService } from '../../src/modules/logic/shared/panel-character.service.js';
import type { NotificationBatcher } from '../../src/modules/game/notification-batcher.js';

export const FIXED_NOW = 1_700_000_000_000;

export interface Fixture {
  tables: DataTables;
  player: Player;
  account: PlayerAccountState;
  extras: AccountExtras;
}

export function makeFixture(role = 'Eyer', career?: string): Fixture {
  const tables = createDefaultTables();
  const account = createPlayerAccountState();
  const player = new Player(tables, 'char-1', () => FIXED_NOW, account);
  player.role = role;
  player.postCreate();
  if (career !== undefined && career !== player.currentCareer) player.selectCareer(career);
  return { tables, player, account, extras: createAccountExtras() };
}

/** 在指定背包下标写入一件物品（越界则追加），返回该槽。 */
export function giveInventory(
  fixture: Fixture,
  json: Record<string, unknown>,
  index = 0,
): InventorySlot {
  const existing = fixture.player.inventory[index];
  if (existing) {
    existing.fromJSON(json);
    return existing;
  }
  const slot = new InventorySlot(fixture.tables, 'inventory').fromJSON(json);
  fixture.player.inventory.push(slot);
  return slot;
}

/** 造一件可装备的武器（默认细木剑，需求等级 1）。 */
export function giveWeapon(
  fixture: Fixture,
  overrides: Record<string, unknown> = {},
  index = 0,
): InventorySlot {
  return giveInventory(
    fixture,
    { key: 'stickSword', level: 1, count: 1, quality: 0, ...overrides },
    index,
  );
}

export function makeFakeContexts(fixture: Fixture): PlayerContextService {
  const fake = {
    tables: fixture.tables,
    has: () => true,
    peek: () => fixture.player,
    load: async () => fixture.player,
    create: async () => fixture.player,
    adopt: async () => fixture.player,
    invalidate: () => {},
    accountEntryOf: async () => ({ account: fixture.account, extras: fixture.extras, dirty: false }),
    accountOf: async () => fixture.account,
    extrasOf: async () => fixture.extras,
    markAccountDirty: () => {},
    evictAccount: async () => {},
    markDirty: () => {},
    flush: async () => true,
    flushAccount: async () => true,
    evict: async () => {},
    flushDirty: async () => 0,
    flushAll: async () => 0,
    reset: () => {},
  };
  return fake as unknown as PlayerContextService;
}

export function makeFakeCharacters(characterId = 'char-1'): PanelCharacterService {
  const fake = {
    setActive: () => {},
    peekActive: () => characterId,
    clear: () => {},
    resolve: async (_userId: number, explicit?: string) => explicit ?? characterId,
  };
  return fake as unknown as PanelCharacterService;
}

export function makeFakeBatcher(): NotificationBatcher {
  const fake = {
    enqueue: () => true,
    registerMerger: () => {},
    start: () => {},
    stop: () => {},
    flushUser: () => 0,
    flushAll: () => ({ users: 0, frames: 0 }),
    stats: { flushed: 0, dropped: 0, resyncs: 0, pendingUsers: 0 },
  };
  return fake as unknown as NotificationBatcher;
}
