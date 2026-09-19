/**
 * 掉落表结算（服务端权威）。
 *
 * ⚠️ 这是原版 `world.loots()` 的**面板域最小复刻**，只服务 `inventory.usePackage`
 * （开包）。世界战斗内的掉落由 `world/` 域实现，两者共用 `rules/goods.ts` 的
 * `randomEquip` / `generateEquip` / `getDecomposeMatrials`，随机一律经 `Rng`。
 *
 * 与 `world.loots()` 的差异：
 * - 不乘 `account.updateRate`（开包固定 `updateRate = 1`，与原版 `usePackage` 调
 *   `loots(..., noUpdateRate=true)` 一致）；
 * - 不处理 `world._endlessLevel` 的等级加成（开包不在无尽副本里结算）；
 * - 不弹提示（服务端只改状态，前端从 `inventory.list` 拿结果）。
 */
import {
  InventorySlot,
  generateEquip,
  getDecomposeMatrials,
  randomEquip,
  untransformEquipLevel,
  type DataTables,
  type LootEntry,
  type Player,
  type Rng,
} from '@idle-dark/game-core';

/** 拾取动作：0 拾取 / 1 出售 / 2 分解。 */
export type LootAction = 0 | 1 | 2;

/** 全局开关的哨兵 key（`player.lootRule` 里 `class|quality` 之外的单键）。 */
export const LOOT_RULE_ENABLED_KEY = '__enabled__';
/** 单条规则的编码前缀。 */
export const LOOT_RULE_PREFIX = 'c:';

/** 规则 key：`c:${class}:${quality}`。 */
export function lootRuleKeyOf(clazz: string, quality: number): string {
  return `${LOOT_RULE_PREFIX}${clazz}:${Math.trunc(quality)}`;
}

/** 解析规则 key → `{ class, quality }`（非法返回 null）。 */
export function parseLootRuleKey(id: string): { clazz: string; quality: number } | null {
  if (!id.startsWith(LOOT_RULE_PREFIX)) return null;
  const rest = id.slice(LOOT_RULE_PREFIX.length);
  const sep = rest.lastIndexOf(':');
  if (sep <= 0 || sep === rest.length - 1) return null;
  const clazz = rest.slice(0, sep);
  const quality = Number(rest.slice(sep + 1));
  if (!Number.isInteger(quality) || quality < 0 || quality > 6) return null;
  return { clazz, quality };
}

/** 编码：启用 → `action`；停用 → `action + 10`。 */
export function encodeLootRule(action: LootAction, enabled: boolean): number {
  return enabled ? action : action + 10;
}

export function decodeLootRule(value: unknown): { action: LootAction; enabled: boolean } {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  if (n >= 10) {
    const action = n - 10;
    return { action: clampAction(action), enabled: false };
  }
  return { action: clampAction(n), enabled: true };
}

function clampAction(value: number): LootAction {
  if (value === 1) return 1;
  if (value === 2) return 2;
  return 0;
}

/** 全局拾取开关（缺省视为启用）。 */
export function lootRuleEnabledOf(player: Player): boolean {
  const raw = player.lootRule.get(LOOT_RULE_ENABLED_KEY);
  if (raw === undefined) return true;
  return raw !== 0;
}

/**
 * 原版 `world.getLootRule(clazz, quality, level)`：
 * 先看显式规则，未命中再看 `minLootLevel`（低于则 0 品质卖钱、其余分解）。
 */
export function lootRuleActionOf(
  player: Player,
  clazz: string | undefined,
  quality: number,
  level: number,
): LootAction {
  if (!lootRuleEnabledOf(player)) return 0;
  const decoded = decodeLootRule(player.lootRule.get(lootRuleKeyOf(clazz ?? '', quality)));
  if (decoded.enabled && decoded.action !== 0) return decoded.action;
  if (level < player.minLootLevel) return quality === 0 ? 1 : 2;
  return 0;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function intOr(value: unknown, fallback: number): number {
  const n = finiteNumber(value, fallback);
  return Math.trunc(n);
}

/**
 * 结算一组掉落表（原版 `world.loots` 的精简版）。
 *
 * 掉落物直接经 `player.loot` 入包；分解 / 出售按拾取规则处理。
 */
export function rollLoots(
  player: Player,
  tables: DataTables,
  entries: readonly LootEntry[],
  level: number,
  rng: Rng,
): void {
  const lootLevel = Number.isFinite(level) && level > 0 ? Math.trunc(level) : 1;
  for (const entry of entries) {
    const raw = entry as unknown as Record<string, unknown>;
    const type = typeof raw['type'] === 'string' ? (raw['type'] as string) : undefined;
    const rate = finiteNumber(raw['rate'], 0);
    const rolls = type === 'maxLevel' ? 1 : Math.ceil(rate - rng.next());
    for (let i = 0; i < rolls; i++) {
      if (type === 'ticket') {
        rollTicket(player, tables, raw, rng);
      } else if (type === 'equip' || type === 'specialEquip') {
        rollEquip(player, tables, raw, type, lootLevel, rng);
      } else if (type === 'maxLevel') {
        const value = intOr(raw['value'], 0);
        if (value > player.maxLevel) player.maxLevel = value;
      } else if (typeof raw['key'] === 'string' && raw['key'] !== '') {
        rollKey(player, tables, raw, rolls, rng);
        break; // 原版 `i = count`：key 类一次性结算
      }
    }
  }
}

function rollTicket(
  player: Player,
  tables: DataTables,
  raw: Record<string, unknown>,
  rng: Rng,
): void {
  const dungeons = raw['dungeons'];
  if (dungeons === null || typeof dungeons !== 'object' || Array.isArray(dungeons)) return;
  const table = dungeons as Record<string, unknown>;
  const keys = Object.keys(table);
  const totalWeight = keys.reduce((sum, key) => sum + Math.max(0, finiteNumber(table[key], 0)), 0);
  if (totalWeight <= 0) return;
  let dice = rng.next() * totalWeight;
  let picked: string | undefined;
  for (const key of keys) {
    const weight = Math.max(0, finiteNumber(table[key], 0));
    if (dice < weight) {
      picked = key;
      break;
    }
    dice -= weight;
  }
  if (picked === undefined) return;
  player.loot(
    new InventorySlot(tables, 'loot').fromJSON({
      key: 'ticket',
      dungeonKey: picked,
      count: 1,
    }),
  );
}

function rollEquip(
  player: Player,
  tables: DataTables,
  raw: Record<string, unknown>,
  type: 'equip' | 'specialEquip',
  lootLevel: number,
  rng: Rng,
): void {
  let slot: InventorySlot;
  if (type === 'specialEquip') {
    const items = Array.isArray(raw['items'])
      ? raw['items'].filter((item): item is string => typeof item === 'string')
      : [];
    if (items.length === 0) return;
    const legendType = items[rng.int(items.length)];
    if (legendType === undefined) return;
    const legend = tables.legends[legendType];
    if (!legend) return;
    const eLevel = Math.max(1, untransformEquipLevel(player.level));
    slot = generateEquip(tables, legend.type, eLevel, 4, legendType, rng);
  } else {
    const minLevel = Math.max(1, Math.min(lootLevel - 15, lootLevel * 0.8));
    const eLevel = Math.max(1, Math.ceil(minLevel + rng.next() * (lootLevel - minLevel)));
    const mfRate = finiteNumber(raw['mfRate'], 1) * finiteNumber(raw['qualityRate'], 1);
    const position = typeof raw['position'] === 'string' ? raw['position'] : undefined;
    slot = randomEquip(tables, eLevel, mfRate > 0 ? mfRate : 1, position, rng);
  }

  const action = lootRuleActionOf(player, slot.goodData?.class, slot.quality, slot.level);
  if (action === 1) {
    player.loot(new InventorySlot(tables, 'loot').fromJSON({ key: 'gold', count: slot.price }));
    return;
  }
  if (action === 2) {
    const materials = getDecomposeMatrials({ level: slot.level, quality: slot.quality });
    for (const key of Object.keys(materials)) {
      player.loot(
        new InventorySlot(tables, 'build').fromJSON({ key, count: materials[key] ?? 1 }),
      );
    }
    return;
  }
  player.loot(slot);
}

function rollKey(
  player: Player,
  tables: DataTables,
  raw: Record<string, unknown>,
  rolls: number,
  rng: Rng,
): void {
  const key = raw['key'] as string;
  const range = raw['count'];
  let min = 1;
  let max = 1;
  if (Array.isArray(range)) {
    const lo = range[0];
    const hi = range[1];
    min = finiteNumber(lo, 1);
    max = Math.max(min, finiteNumber(hi, min));
  } else if (typeof range === 'number' && Number.isFinite(range)) {
    min = range;
    max = range;
  }
  const total = (rng.next() * (max - min + 1) + min) * rolls;
  const count = Math.trunc(total);
  if (count <= 0) return;
  player.loot(new InventorySlot(tables, 'loot').fromJSON({ key, count }));
}
