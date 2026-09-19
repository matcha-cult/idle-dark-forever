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
 *
 * ⚠️ 拾取规则的**编码与判定**（`c:class:quality` / `+10 = 停用` / `minLootLevel` 兜底）
 * 已统一到 `game-core` 的 `rules/loot-rule.ts`。本文件**只消费**，不得再复制一份实现
 * （历史上这里与 `combat/battle-world.ts` 各写一份，编码漂移导致面板设置静默失效）。
 */
import {
  InventorySlot,
  generateEquip,
  getDecomposeMatrials,
  lootRuleActionOf,
  randomEquip,
  untransformEquipLevel,
  type DataTables,
  type LootEntry,
  type Player,
  type Rng,
} from '@idle-dark/game-core';

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
