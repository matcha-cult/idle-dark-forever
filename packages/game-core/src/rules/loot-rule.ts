/**
 * 拾取规则（原版 `world.getLootRule`）—— **跨域硬约定的唯一定义**。
 *
 * ## 为什么放在 `game-core`
 *
 * 这套编码同时被两侧消费：
 * - **写**：`server` 的拾取规则面板（`lootrule/internal/loot-rule-ops.ts`）；
 * - **读**：战斗掉落结算（`combat/battle-world.ts` 的 `getLootRule`）。
 *
 * 曾经两侧各写一份实现，结果键格式（`class` vs `c:class:quality`）与值类型
 * （`number` vs `number[]`）双双漂移，面板设置**静默失效**、永远回退 `minLootLevel`。
 * 因此编码的唯一定义放在这里：任一侧要改编码，只能改这个文件。
 *
 * ## 持久化编码
 *
 * `Player.lootRule` 是 `Map<string, number>`（原版为 `Map<class, number[]>`），扁平化为：
 * - `__enabled__` → `1 / 0`：全局开关（缺省视为开启）；
 * - `c:${class}:${quality}` → `action`（启用）或 `action + 10`（该条停用）。
 *
 * `action` 取值 0 拾取 / 1 出售 / 2 分解（协议 `LootRuleAction`）。
 *
 * ## 判定顺序（与原版一致）
 *
 * 1. 全局开关关闭 → 一律 `0`（拾取，不做任何自动处理）；
 * 2. 命中的显式规则**已启用且 action 非 0** → 返回该 action；
 * 3. 否则回落 `minLootLevel`：`level < minLootLevel` 时 0 品质出售、其余分解；
 * 4. 再否则 `0`。
 *
 * 注意第 2 步要求 `action !== 0`：**显式设为「拾取」等价于没设**（原版
 * `if (ret) return ret;` 也是这个语义），仍会被 `minLootLevel` 兜底。
 */

/** 拾取动作：0 拾取 / 1 出售 / 2 分解。 */
export type LootRuleAction = 0 | 1 | 2;

/** 全局开关的哨兵 key（`lootRule` 里 `c:...` 之外的单键）。 */
export const LOOT_RULE_ENABLED_KEY = '__enabled__';

/** 单条规则的编码前缀。 */
export const LOOT_RULE_PREFIX = 'c:';

/** 停用一条规则时在 action 上叠加的偏移量。 */
export const LOOT_RULE_DISABLED_OFFSET = 10;

/** 品质维度上限（原版 UI 为 5 格：普通..传说；留 6 容忍历史数据）。 */
export const LOOT_RULE_MAX_QUALITY = 6;

/** 本模块只用到的玩家形状（`Player` 与 `combat` 的 `PlayerLike` 都满足）。 */
export interface LootRulePlayerLike {
  lootRule?: ReadonlyMap<string, number> | null;
  minLootLevel?: number;
}

/** 规则 key：`c:${class}:${quality}`。 */
export function lootRuleKeyOf(clazz: string, quality: number): string {
  return `${LOOT_RULE_PREFIX}${clazz}:${Math.trunc(quality)}`;
}

/** 解析规则 key → `{ clazz, quality }`（非法返回 null）。 */
export function parseLootRuleKey(id: string): { clazz: string; quality: number } | null {
  if (typeof id !== 'string' || !id.startsWith(LOOT_RULE_PREFIX)) return null;
  const rest = id.slice(LOOT_RULE_PREFIX.length);
  const sep = rest.lastIndexOf(':');
  if (sep <= 0 || sep === rest.length - 1) return null;
  const clazz = rest.slice(0, sep);
  const quality = Number(rest.slice(sep + 1));
  if (!Number.isInteger(quality) || quality < 0 || quality > LOOT_RULE_MAX_QUALITY) return null;
  return { clazz, quality };
}

/** 编码：启用 → `action`；停用 → `action + 10`。 */
export function encodeLootRule(action: LootRuleAction, enabled: boolean): number {
  const safe = clampAction(action);
  return enabled ? safe : safe + LOOT_RULE_DISABLED_OFFSET;
}

/** 解码；非数值 / NaN / 越界一律按「拾取且启用」处理。 */
export function decodeLootRule(value: unknown): { action: LootRuleAction; enabled: boolean } {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  if (n >= LOOT_RULE_DISABLED_OFFSET) {
    return { action: clampAction(n - LOOT_RULE_DISABLED_OFFSET), enabled: false };
  }
  return { action: clampAction(n), enabled: true };
}

function clampAction(value: unknown): LootRuleAction {
  if (value === 1) return 1;
  if (value === 2) return 2;
  return 0;
}

/** 全局拾取开关（缺省、NaN 等一律视为启用；仅显式 `0` 关闭）。 */
export function lootRuleEnabledOf(player: LootRulePlayerLike | null | undefined): boolean {
  const raw = player?.lootRule?.get(LOOT_RULE_ENABLED_KEY);
  if (raw === undefined) return true;
  return raw !== 0;
}

/**
 * 原版 `world.getLootRule(clazz, quality, level)` 的唯一实现。
 *
 * @param clazz   装备大类（`slot.goodData.class`）；`undefined` / `''` 视为空类（不会命中规则）
 * @param quality 品质下标
 * @param level   装备等级（与 `minLootLevel` 比较）
 */
export function lootRuleActionOf(
  player: LootRulePlayerLike | null | undefined,
  clazz: string | undefined,
  quality: number,
  level: number,
): LootRuleAction {
  if (!player) return 0;
  if (!lootRuleEnabledOf(player)) return 0;

  const decoded = decodeLootRule(player.lootRule?.get(lootRuleKeyOf(clazz ?? '', quality)));
  if (decoded.enabled && decoded.action !== 0) return decoded.action;

  const minLevel = player.minLootLevel;
  if (typeof minLevel === 'number' && Number.isFinite(minLevel) && level < minLevel) {
    return quality === 0 ? 1 : 2;
  }
  return 0;
}
