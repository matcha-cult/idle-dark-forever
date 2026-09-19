/**
 * 拾取规则编码 / 判定单测。
 *
 * 这组用例的存在理由：面板侧写 `c:${class}:${quality}`、战斗侧曾按 `class` 读并对
 * `number` 再索引 `quality` → 永远返回 0、面板设置静默失效。编码漂移必须在
 * **唯一定义**的边界处被拦住，所以这里把 key / 编码 / 判定 / 兜底各条分支都钉死。
 */

import { describe, expect, it } from 'vitest';

import {
  LOOT_RULE_DISABLED_OFFSET,
  LOOT_RULE_ENABLED_KEY,
  LOOT_RULE_MAX_QUALITY,
  decodeLootRule,
  encodeLootRule,
  lootRuleActionOf,
  lootRuleEnabledOf,
  lootRuleKeyOf,
  parseLootRuleKey,
  type LootRuleAction,
  type LootRulePlayerLike,
} from './loot-rule.js';

function playerOf(rules: Record<string, number> = {}, minLootLevel = 0): LootRulePlayerLike {
  return { lootRule: new Map(Object.entries(rules)), minLootLevel };
}

describe('loot-rule：key 编解码', () => {
  it('key 格式固定为 c:class:quality，品质取整', () => {
    expect(lootRuleKeyOf('sword', 3)).toBe('c:sword:3');
    expect(lootRuleKeyOf('sword', 2.9)).toBe('c:sword:2');
    expect(lootRuleKeyOf('', 0)).toBe('c::0');
    expect(lootRuleKeyOf('a:b', 1)).toBe('c:a:b:1');
  });

  it('parse 解析合法 key（class 含冒号时按最后一个冒号切）', () => {
    expect(parseLootRuleKey('c:sword:3')).toEqual({ clazz: 'sword', quality: 3 });
    expect(parseLootRuleKey('c:a:b:1')).toEqual({ clazz: 'a:b', quality: 1 });
    expect(parseLootRuleKey(`c:x:${LOOT_RULE_MAX_QUALITY}`)).toEqual({
      clazz: 'x',
      quality: LOOT_RULE_MAX_QUALITY,
    });
  });

  it('parse 拒绝非法 key（前缀/空类/空品质/非整数/越界/非字符串）', () => {
    expect(parseLootRuleKey('sword:3')).toBeNull();
    expect(parseLootRuleKey('c:sword')).toBeNull();
    expect(parseLootRuleKey('c:sword:')).toBeNull();
    expect(parseLootRuleKey('c::2')).toBeNull();
    expect(parseLootRuleKey('c:sword:2.5')).toBeNull();
    expect(parseLootRuleKey('c:sword:-1')).toBeNull();
    expect(parseLootRuleKey(`c:sword:${LOOT_RULE_MAX_QUALITY + 1}`)).toBeNull();
    expect(parseLootRuleKey('')).toBeNull();
    expect(parseLootRuleKey(undefined as unknown as string)).toBeNull();
    expect(parseLootRuleKey(null as unknown as string)).toBeNull();
  });

  it('key → parse 往返一致', () => {
    for (const clazz of ['sword', 'cloth', 'a:b', '']) {
      for (let quality = 0; quality <= LOOT_RULE_MAX_QUALITY; quality++) {
        const key = lootRuleKeyOf(clazz, quality);
        // 空 class 的 key 是 `c::q`，冒号前无内容 → 约定为非法（不会被面板写入）
        if (clazz === '') {
          expect(parseLootRuleKey(key)).toBeNull();
          continue;
        }
        expect(parseLootRuleKey(key)).toEqual({ clazz, quality });
      }
    }
  });
});

describe('loot-rule：动作编码', () => {
  it('启用 → action；停用 → action + 10', () => {
    for (const action of [0, 1, 2] as LootRuleAction[]) {
      expect(encodeLootRule(action, true)).toBe(action);
      expect(encodeLootRule(action, false)).toBe(action + LOOT_RULE_DISABLED_OFFSET);
      expect(decodeLootRule(encodeLootRule(action, true))).toEqual({ action, enabled: true });
      expect(decodeLootRule(encodeLootRule(action, false))).toEqual({ action, enabled: false });
    }
  });

  it('encode 夹取非法 action', () => {
    expect(encodeLootRule(9 as unknown as LootRuleAction, true)).toBe(0);
    expect(encodeLootRule(-1 as unknown as LootRuleAction, true)).toBe(0);
    expect(encodeLootRule(Number.NaN as unknown as LootRuleAction, true)).toBe(0);
    expect(encodeLootRule(9 as unknown as LootRuleAction, false)).toBe(LOOT_RULE_DISABLED_OFFSET);
  });

  it('decode 边界：undefined/null/NaN/Infinity/字符串/负数一律「拾取且启用」', () => {
    const pickup = { action: 0, enabled: true };
    for (const bad of [undefined, null, Number.NaN, Infinity, -Infinity, '1', {}, [], true]) {
      expect(decodeLootRule(bad)).toEqual(pickup);
    }
    expect(decodeLootRule(-1)).toEqual(pickup);
    expect(decodeLootRule(9)).toEqual(pickup);
  });

  it('decode 停用偏移边界：10 起为停用，越界 action 归 0', () => {
    expect(decodeLootRule(LOOT_RULE_DISABLED_OFFSET - 1)).toEqual({ action: 0, enabled: true });
    expect(decodeLootRule(LOOT_RULE_DISABLED_OFFSET)).toEqual({ action: 0, enabled: false });
    expect(decodeLootRule(LOOT_RULE_DISABLED_OFFSET + 1)).toEqual({ action: 1, enabled: false });
    expect(decodeLootRule(LOOT_RULE_DISABLED_OFFSET + 2)).toEqual({ action: 2, enabled: false });
    expect(decodeLootRule(LOOT_RULE_DISABLED_OFFSET + 3)).toEqual({ action: 0, enabled: false });
    expect(decodeLootRule(2.7)).toEqual({ action: 2, enabled: true });
    expect(decodeLootRule(0.9)).toEqual({ action: 0, enabled: true });
  });
});

describe('loot-rule：全局开关', () => {
  it('缺省 / 无 lootRule / 非 0 值 → 启用；仅显式 0 关闭', () => {
    expect(lootRuleEnabledOf(playerOf())).toBe(true);
    expect(lootRuleEnabledOf({})).toBe(true);
    expect(lootRuleEnabledOf({ lootRule: null })).toBe(true);
    expect(lootRuleEnabledOf(null)).toBe(true);
    expect(lootRuleEnabledOf(undefined)).toBe(true);
    expect(lootRuleEnabledOf(playerOf({ [LOOT_RULE_ENABLED_KEY]: 1 }))).toBe(true);
    expect(lootRuleEnabledOf(playerOf({ [LOOT_RULE_ENABLED_KEY]: 0 }))).toBe(false);
    expect(lootRuleEnabledOf(playerOf({ [LOOT_RULE_ENABLED_KEY]: -1 }))).toBe(true);
    expect(lootRuleEnabledOf(playerOf({ [LOOT_RULE_ENABLED_KEY]: Number.NaN }))).toBe(true);
  });
});

describe('loot-rule：判定', () => {
  it('无玩家 → 0', () => {
    expect(lootRuleActionOf(null, 'sword', 3, 999)).toBe(0);
    expect(lootRuleActionOf(undefined, 'sword', 3, 999)).toBe(0);
  });

  it('全局关闭时忽略一切显式规则与 minLootLevel', () => {
    const player = playerOf({ [LOOT_RULE_ENABLED_KEY]: 0, 'c:sword:3': 1 }, 999);
    expect(lootRuleActionOf(player, 'sword', 3, 1)).toBe(0);
    expect(lootRuleActionOf(player, 'sword', 0, 1)).toBe(0);
  });

  it('显式启用规则命中 → 返回该 action', () => {
    expect(lootRuleActionOf(playerOf({ 'c:sword:3': 1 }), 'sword', 3, 20)).toBe(1);
    expect(lootRuleActionOf(playerOf({ 'c:sword:3': 2 }), 'sword', 3, 20)).toBe(2);
  });

  it('规则按 class + quality 精确匹配，不命中即回落', () => {
    const player = playerOf({ 'c:sword:3': 1 }, 50);
    expect(lootRuleActionOf(player, 'sword', 3, 20)).toBe(1);
    // 品质不同 → 不命中 → minLootLevel 兜底（20 < 50，非 0 品质 → 分解）
    expect(lootRuleActionOf(player, 'sword', 2, 20)).toBe(2);
    // class 不同 → 不命中
    expect(lootRuleActionOf(player, 'cloth', 3, 20)).toBe(2);
    // 0 品质兜底 → 出售
    expect(lootRuleActionOf(player, 'cloth', 0, 20)).toBe(1);
  });

  it('显式启用但 action = 0（拾取）等价于未设置，仍走 minLootLevel 兜底', () => {
    const player = playerOf({ 'c:sword:3': 0 }, 50);
    expect(lootRuleActionOf(player, 'sword', 3, 20)).toBe(2);
    expect(lootRuleActionOf(player, 'sword', 0, 20)).toBe(1);
  });

  it('显式停用（+10）等价于未设置，仍走 minLootLevel 兜底', () => {
    const player = playerOf({ 'c:sword:3': 12 }, 50);
    expect(lootRuleActionOf(player, 'sword', 3, 20)).toBe(2);
    // 把阈值调到 0：停用规则不会「顺带出售/分解」
    expect(lootRuleActionOf(playerOf({ 'c:sword:3': 12 }, 0), 'sword', 3, 20)).toBe(0);
  });

  it('minLootLevel 边界：恰好等于阈值不触发，低于才触发；NaN/负数等级不触发', () => {
    const player = playerOf({}, 50);
    expect(lootRuleActionOf(player, 'sword', 3, 49.999)).toBe(2);
    expect(lootRuleActionOf(player, 'sword', 3, 50)).toBe(0);
    expect(lootRuleActionOf(player, 'sword', 3, 51)).toBe(0);
    expect(lootRuleActionOf(player, 'sword', 0, -10)).toBe(1);
    expect(lootRuleActionOf(player, 'sword', 3, Number.NaN)).toBe(0);
    expect(lootRuleActionOf(player, 'sword', Number.NaN, 1)).toBe(2);
  });

  it('minLootLevel 缺失 / NaN / Infinity 时不触发兜底', () => {
    expect(lootRuleActionOf({ lootRule: new Map() }, 'sword', 3, 1)).toBe(0);
    expect(lootRuleActionOf(playerOf({}, Number.NaN), 'sword', 3, 1)).toBe(0);
    expect(lootRuleActionOf(playerOf({}, Infinity), 'sword', 3, 1)).toBe(0);
    expect(lootRuleActionOf(playerOf({}, -5), 'sword', 3, 1)).toBe(0);
  });

  it('空 class：undefined 与 "" 指向同一 key，可被显式规则命中', () => {
    const player = playerOf({ 'c::2': 1 });
    expect(lootRuleActionOf(player, undefined, 2, 20)).toBe(1);
    expect(lootRuleActionOf(player, '', 2, 20)).toBe(1);
    expect(lootRuleActionOf(player, 'sword', 2, 20)).toBe(0);
  });

  it('lootRule 缺失时不影响 minLootLevel 兜底', () => {
    expect(lootRuleActionOf({ minLootLevel: 9 }, 'sword', 0, 5)).toBe(1);
    expect(lootRuleActionOf({ minLootLevel: 9 }, 'sword', 1, 5)).toBe(2);
  });
});
