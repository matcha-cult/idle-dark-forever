/**
 * 拾取规则域纯逻辑。
 *
 * ## 持久化编码（重要，world 掉落逻辑必须对齐）
 *
 * `game-core` 的 `Player.lootRule` 是 `Map<string, number>`（原版是 `Map<class, number[]>`）。
 * 本域把它展开为扁平键值：
 * - `__enabled__` → `1 / 0`：全局开关；
 * - `c:${class}:${quality}` → `action`（启用）或 `action + 10`（停用）。
 *
 * `Action` 值 0 拾取 / 1 出售 / 2 分解（协议 `LootRuleAction`）。
 * 未命中显式规则时回落到 `player.minLootLevel`（低于阈值：0 品质卖钱、其余分解）。
 *
 * ⚠️ 两处**都不是本文件定义的**：编码与判定逻辑的唯一定义在
 * `@idle-dark/game-core` 的 `rules/loot-rule.ts`（`lootRuleKeyOf` / `encodeLootRule` /
 * `decodeLootRule` / `lootRuleActionOf` …）。这里只负责**读写面板状态**，
 * 千万不要在服务端再复制一份编码。
 */
import type { LootRuleEntryDto, LootRuleStateDto, LootRuleUpdateInput } from '@idle-dark/protocol';
import { BusinessErrorCode } from '@idle-dark/protocol';
import type { Player } from '@idle-dark/game-core';
import {
  LOOT_RULE_ENABLED_KEY,
  decodeLootRule,
  encodeLootRule,
  lootRuleEnabledOf,
  lootRuleKeyOf,
  parseLootRuleKey,
} from '@idle-dark/game-core';
import { OpError } from '../../shared/op-error.js';


/** 规则矩阵的品质维度（原版 UI 为 5 格：普通..传说）。 */
export const RULE_QUALITY_COUNT = 5;

/** 展示用装备大类集合（按数据表顺序去重）。 */
export function equipmentClasses(player: Player): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of Object.keys(player.tables.goods)) {
    const clazz = player.tables.goods[key]?.class;
    if (!clazz || seen.has(clazz)) continue;
    seen.add(clazz);
    out.push(clazz);
  }
  return out;
}

export function lootRuleStateOf(player: Player): LootRuleStateDto {
  const rules: LootRuleEntryDto[] = [];
  for (const clazz of equipmentClasses(player)) {
    for (let quality = 0; quality < RULE_QUALITY_COUNT; quality++) {
      const decoded = decodeLootRule(player.lootRule.get(lootRuleKeyOf(clazz, quality)));
      rules.push({
        id: lootRuleKeyOf(clazz, quality),
        minQuality: quality,
        minLevel: 0,
        action: decoded.action,
        enabled: decoded.enabled,
      });
    }
  }
  return {
    enabled: lootRuleEnabledOf(player),
    minLevel: player.minLootLevel,
    rules,
  };
}

/** 更新全局开关 / 逐条规则。 */
export function opUpdateLootRule(player: Player, input: LootRuleUpdateInput): void {
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') {
      throw new OpError(BusinessErrorCode.INVALID_PARAM, 'enabled 必须是布尔值');
    }
    player.lootRule.set(LOOT_RULE_ENABLED_KEY, input.enabled ? 1 : 0);
  }

  if (input.rules !== undefined) {
    if (!Array.isArray(input.rules)) {
      throw new OpError(BusinessErrorCode.INVALID_PARAM, 'rules 必须是数组');
    }
    for (const entry of input.rules) {
      if (!entry || typeof entry !== 'object') {
        throw new OpError(BusinessErrorCode.INVALID_PARAM, '规则条目非法');
      }
      const parsed = parseLootRuleKey(String(entry.id ?? ''));
      if (!parsed) throw new OpError(BusinessErrorCode.INVALID_PARAM, '规则 id 非法');
      if (entry.action !== 0 && entry.action !== 1 && entry.action !== 2) {
        throw new OpError(BusinessErrorCode.INVALID_PARAM, '规则 action 非法');
      }
      if (typeof entry.enabled !== 'boolean') {
        throw new OpError(BusinessErrorCode.INVALID_PARAM, '规则 enabled 非法');
      }
      player.lootRule.set(lootRuleKeyOf(parsed.clazz, parsed.quality), encodeLootRule(entry.action, entry.enabled));
    }
  }
}

/** 设置「低于该装等自动处理」的阈值（0..9999）。 */
export function opSetMinLevel(player: Player, minLevel: number): void {
  if (!Number.isInteger(minLevel) || minLevel < 0 || minLevel > 9999) {
    throw new OpError(BusinessErrorCode.INVALID_PARAM, '最低等级必须在 0..9999');
  }
  player.minLootLevel = minLevel;
}
