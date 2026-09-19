/**
 * `PlayerLike` 适配 + 掉落落地
 *
 * `game-core` 的 `Player` 与 `combat` 的 `PlayerLike` 之间有两处**真实形状差异**：
 *
 * 1. `PlayerLike.lootRule` 被标成 `Map<string, Record<number, number>>`，而 `Player.lootRule`
 *    实际是 `Map<string, number>`（见 `rules/player.ts:fromJSON`）。这里不改 game-core，
 *    运行期行为以 `Player` 为准（`rule[quality]` 取不到 → 回退 `minLootLevel` 规则）。
 * 2. `PlayerLike.careerInfo` 是非可选，而 `Player.careerInfo` 是 `CareerInfo | undefined`。
 *
 * 另外 `BattleWorld.lootGood()` 会把**普通对象**（`{key:'gold'}` / 分解材料）交给
 * `player.loot()`，而 `Player.loot()` 需要 `empty` / `toJSON` / `clear` 方法 → 会抛错。
 * 因此这里用 `Object.create(player)` 生成一个**影子对象**：getter / Map 引用全部沿原型链
 * 指向真实 `Player`（成长与背包改动都落在权威对象上），只把 `loot` 换成能处理两种输入的
 * 包装实现。
 */
import { InventorySlot, Player, type PlayerLike } from '@idle-dark/game-core';
import type { DataTables } from '@idle-dark/game-core';

/** 掉落落地的记录回调（供推送 / 离线报告使用）。 */
export interface LootRecorder {
  record(slot: InventorySlot, handled: string): void;
}

/** 是否是可用的 `Player` 存档对象（而非 `BattleWorld` 内部的普通 LootSlot）。 */
function isSlotLike(value: unknown): value is InventorySlot {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function' &&
    typeof (value as { clear?: unknown }).clear === 'function'
  );
}

/**
 * 把真实 `Player` 适配成 `PlayerLike`。
 *
 * @param recorder 每次掉落被 `Player.loot` 消化后回调（拿到的是**完整** `InventorySlot`，
 *                 sell / decompose 的普通对象会被先转成临时 `InventorySlot`）。
 */
export function toPlayerLike(
  player: Player,
  tables: DataTables,
  recorder?: LootRecorder,
): PlayerLike {
  const like = Object.create(player) as PlayerLike;
  const loot = (input: unknown): void => {
    const slot = isSlotLike(input)
      ? input
      : new InventorySlot(tables, 'loot').fromJSON({
          key: (input as { key?: unknown })?.key ?? null,
          count: (input as { count?: unknown })?.count ?? 0,
          quality: (input as { quality?: unknown })?.quality ?? 0,
          dungeonKey: (input as { dungeonKey?: unknown })?.dungeonKey ?? null,
        });
    const handled = (input as { handled?: unknown })?.handled;
    player.loot(slot);
    recorder?.record(slot, typeof handled === 'string' ? handled : 'pickup');
  };
  Object.defineProperty(like, 'loot', { value: loot, writable: true, enumerable: true });
  return like;
}
