import { describe, expect, it } from 'vitest';
import { BusinessErrorCode } from '@idle-dark/protocol';
import { RateLimiterService } from '../../../src/common/services/rate-limiter.service.js';
import { LootRuleLogicService } from '../../../src/modules/logic/lootrule/lootrule.logic.service.js';
import { OpError } from '../../../src/modules/logic/shared/op-error.js';
import {
  RULE_QUALITY_COUNT,
  equipmentClasses,
  lootRuleStateOf,
  opSetMinLevel,
  opUpdateLootRule,
} from '../../../src/modules/logic/lootrule/internal/loot-rule-ops.js';
import { lootRuleActionOf, lootRuleKeyOf, parseLootRuleKey } from '@idle-dark/game-core';
import { makeFakeCharacters, makeFakeContexts, makeFixture } from '../_helpers.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof OpError) return error.code;
    throw error;
  }
  throw new Error('expected throw');
}

describe('lootrule 状态与更新', () => {
  it('初始矩阵覆盖全部装备大类 × 品质', () => {
    const fixture = makeFixture();
    const state = lootRuleStateOf(fixture.player);
    expect(state.enabled).toBe(true);
    expect(state.minLevel).toBe(0);
    expect(state.rules).toHaveLength(equipmentClasses(fixture.player).length * RULE_QUALITY_COUNT);
    expect(state.rules.every((rule) => rule.action === 0 && rule.enabled)).toBe(true);
  });

  it('更新全局开关', () => {
    const fixture = makeFixture();
    opUpdateLootRule(fixture.player, { enabled: false });
    expect(lootRuleStateOf(fixture.player).enabled).toBe(false);
    // 关闭后拾取规则恒为「拾取」
    expect(lootRuleActionOf(fixture.player, 'sword', 3, 999)).toBe(0);
  });

  it('更新单条规则并按新值读取', () => {
    const fixture = makeFixture();
    const state = lootRuleStateOf(fixture.player);
    const first = state.rules[0]!;
    const parsed = parseLootRuleKey(first.id)!;
    opUpdateLootRule(fixture.player, {
      rules: [{ ...first, action: 2, enabled: true }],
    });
    const after = lootRuleStateOf(fixture.player);
    expect(after.rules.find((rule) => rule.id === first.id)?.action).toBe(2);

    // 持久化层编码：启用 = action 本身
    fixture.player.minLootLevel = 0;
    expect(fixture.player.lootRule.get(first.id)).toBe(2);
    // 战斗侧读同一编码 → 命中该条为「分解」，邻近品质不受影响
    expect(lootRuleActionOf(fixture.player, parsed.clazz, parsed.quality, 999)).toBe(2);
    expect(lootRuleActionOf(fixture.player, parsed.clazz, parsed.quality + 1, 999)).toBe(0);

    // 停用该条 → 持久化编码 +10，且等价于未设置（回落 minLootLevel）
    opUpdateLootRule(fixture.player, { rules: [{ ...first, action: 2, enabled: false }] });
    expect(fixture.player.lootRule.get(first.id)).toBe(12);
    expect(lootRuleActionOf(fixture.player, parsed.clazz, parsed.quality, 999)).toBe(0);
    // 阈值 60、装备等级 50 → 兜底：0 品质卖钱、其余分解
    fixture.player.minLootLevel = 60;
    expect(lootRuleActionOf(fixture.player, parsed.clazz, parsed.quality, 50)).toBe(
      parsed.quality === 0 ? 1 : 2,
    );
    expect(lootRuleActionOf(fixture.player, parsed.clazz, parsed.quality + 1, 50)).toBe(2);
  });

  it('非法规则 id / action / enabled → INVALID_PARAM', () => {
    const fixture = makeFixture();
    const state = lootRuleStateOf(fixture.player);
    const first = state.rules[0]!;
    expect(
      codeOf(() =>
        opUpdateLootRule(fixture.player, {
          rules: [{ ...first, id: 'bogus' }],
        }),
      ),
    ).toBe(BusinessErrorCode.INVALID_PARAM);
    expect(
      codeOf(() =>
        opUpdateLootRule(fixture.player, {
          rules: [{ ...first, action: 9 as 0 }],
        }),
      ),
    ).toBe(BusinessErrorCode.INVALID_PARAM);
    expect(
      codeOf(() =>
        opUpdateLootRule(fixture.player, {
          rules: [{ ...first, enabled: 'yes' as unknown as boolean }],
        }),
      ),
    ).toBe(BusinessErrorCode.INVALID_PARAM);
  });

  it('setMinLevel 边界：负数 / 超大 → INVALID_PARAM；合法值生效', () => {
    const fixture = makeFixture();
    expect(codeOf(() => opSetMinLevel(fixture.player, -1))).toBe(BusinessErrorCode.INVALID_PARAM);
    expect(codeOf(() => opSetMinLevel(fixture.player, 10000))).toBe(BusinessErrorCode.INVALID_PARAM);
    expect(codeOf(() => opSetMinLevel(fixture.player, Number.NaN))).toBe(
      BusinessErrorCode.INVALID_PARAM,
    );
    opSetMinLevel(fixture.player, 50);
    expect(fixture.player.minLootLevel).toBe(50);
  });

  it('规则 key 编解码稳定', () => {
    const fixture = makeFixture();
    const clazz = equipmentClasses(fixture.player)[0]!;
    expect(lootRuleKeyOf(clazz, 3)).toBe(`c:${clazz}:3`);
    const state = lootRuleStateOf(fixture.player);
    expect(state.rules.some((rule) => rule.id === lootRuleKeyOf(clazz, 0))).toBe(true);
  });
});

describe('LootRuleLogicService', () => {
  it('get / update / setMinLevel 返回完整状态', async () => {
    const fixture = makeFixture();
    const service = new LootRuleLogicService(
      makeFakeContexts(fixture),
      makeFakeCharacters(),
      new RateLimiterService(),
    );
    const initial = await service.get(1);
    expect(initial.success).toBe(true);

    const updated = await service.update(1, { enabled: false });
    expect(updated.success).toBe(true);
    if (!updated.success) return;
    expect(updated.data.enabled).toBe(false);

    const minLevel = await service.setMinLevel(1, 42);
    expect(minLevel.success).toBe(true);
    if (!minLevel.success) return;
    expect(minLevel.data.minLevel).toBe(42);
  });
});
