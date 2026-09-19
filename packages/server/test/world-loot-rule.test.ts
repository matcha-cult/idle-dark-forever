/**
 * 拾取规则端到端（面板 → 战斗 → 掉落落地）
 *
 * 覆盖这条链路的**每一段真实实现**（无打桩）：
 * `opUpdateLootRule`（面板写入） → `Player.lootRule` → `toPlayerLike` 影子对象
 * → `BattleWorld.loots()` → `RulesLootService`（真实 `rules/goods`） → `Player.loot`。
 *
 * 历史缺陷：面板写 `c:${class}:${quality}`，而 `BattleWorld.getLootRule` 按 `class` 取值
 * 并对 `number` 再索引 `quality` → 恒不命中、永远回退 `minLootLevel`，即「设置自动出售/分解
 * 完全没用」。本文件的断言全部落在 `lootRecorder` 的 `handled` 上，正是当年该被抓住的点。
 */
import { describe, expect, it } from 'vitest';
import {
  LOOT_RULE_ENABLED_KEY,
  Player,
  VirtualClock,
  createDefaultTables,
  lootRuleKeyOf,
  type DataTables,
  type LootRuleAction,
} from '@idle-dark/game-core';
import { BattleCollector } from '../src/modules/logic/shared/battle-collector.js';
import { buildBattleWorld } from '../src/modules/logic/shared/headless.js';
import { equipmentClasses, opUpdateLootRule } from '../src/modules/logic/lootrule/internal/loot-rule-ops.js';
import type { LootRecorder } from '../src/modules/logic/shared/player-like.js';

const tables: DataTables = createDefaultTables();
const NOW = 1_700_000_000_000;
const SEED = 20240607;

function freshPlayer(): Player {
  const player = Player.fromJSON(tables, 'c1', () => NOW, {
    role: 'Eyer',
    currentCareer: 'warrior',
    careers: { warrior: { type: 'warrior', level: 1 } },
  });
  player.postCreate();
  player.selectCareer('warrior');
  return player;
}

interface Recorded {
  key: string;
  handled: string;
  count: number;
}

/** 一次真实的 `equip` 掉落结算，返回落地记录。 */
function rollOneEquip(player: Player, minLootLevel = 0): Recorded[] {
  player.minLootLevel = minLootLevel;
  const recorded: Recorded[] = [];
  const recorder: LootRecorder = {
    record: (slot, handled) =>
      recorded.push({ key: slot.key ?? '', handled, count: slot.count ?? 0 }),
  };
  const clock = new VirtualClock();
  const { world } = buildBattleWorld({
    tables,
    player,
    map: 'home',
    seed: SEED,
    sink: new BattleCollector(),
    clock,
    lootRecorder: recorder,
  });
  world.loots([{ type: 'equip', rate: 1 }], 20, 0);
  world.dispose();
  clock.dispose();
  return recorded;
}

/** 经**面板真实入口**把全部 class × quality 设为同一动作。 */
function setAllRules(player: Player, action: LootRuleAction, enabled = true): void {
  opUpdateLootRule(player, {
    rules: equipmentClasses(player).flatMap((clazz) =>
      [0, 1, 2, 3, 4].map((quality) => ({
        id: lootRuleKeyOf(clazz, quality),
        minQuality: quality,
        minLevel: 0,
        action,
        enabled,
      })),
    ),
  });
}

/**
 * 背包里的**装备**数量。
 *
 * 不能用「非空格子数」：分解材料会按原版语义进主背包（原版 `lootGood` 也是
 * `player.loot(slot)` → `this.inventory`），所以只看装备。
 */
function equipCountInBag(player: Player): number {
  return player.inventory.filter((slot) => !slot.empty && slot.goodData?.type === 'equip').length;
}

describe('拾取规则：面板设置必须驱动真实掉落结算', () => {
  it('全部设为「出售」→ 掉落实体换成金币入账，装备不入包', () => {
    const player = freshPlayer();
    setAllRules(player, 1);
    const goldBefore = player.gold;

    const recorded = rollOneEquip(player);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.handled).toBe('sell');
    expect(recorded[0]?.key).toBe('gold');
    expect(recorded[0]?.count).toBeGreaterThan(0);
    expect(player.gold).toBe(goldBefore + (recorded[0]?.count ?? 0));
    expect(equipCountInBag(player)).toBe(0);
  });

  it('全部设为「分解」→ 掉落变成材料，且不掉金币、装备不入包', () => {
    const player = freshPlayer();
    setAllRules(player, 2);
    const goldBefore = player.gold;

    const recorded = rollOneEquip(player);

    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.every((entry) => entry.handled === 'decompose')).toBe(true);
    expect(recorded.some((entry) => entry.key === 'gold')).toBe(false);
    expect(recorded.every((entry) => entry.count > 0)).toBe(true);
    expect(player.gold).toBe(goldBefore);
    expect(equipCountInBag(player)).toBe(0);
  });

  it('未设置规则 → 装备原样入包（pickup）', () => {
    const player = freshPlayer();
    const recorded = rollOneEquip(player);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.handled).toBe('pickup');
    expect(recorded[0]?.key).not.toBe('gold');
    expect(equipCountInBag(player)).toBe(1);
  });

  it('全局开关关闭 → 忽略逐条规则与 minLootLevel，一律入包', () => {
    const player = freshPlayer();
    player.lootRule.set(LOOT_RULE_ENABLED_KEY, 0);
    setAllRules(player, 1);

    const recorded = rollOneEquip(player, 9999);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.handled).toBe('pickup');
    expect(equipCountInBag(player)).toBe(1);
  });

  it('规则停用（+10）→ 回落到 minLootLevel 兜底（低装等自动处理）', () => {
    const player = freshPlayer();
    setAllRules(player, 1, false);

    const recorded = rollOneEquip(player, 9999);

    expect(recorded).toHaveLength(1);
    expect(['sell', 'decompose']).toContain(recorded[0]?.handled);
    expect(equipCountInBag(player)).toBe(0);
  });

  it('规则与掉落错位（只配 sword:3）时不误伤其他掉落', () => {
    const player = freshPlayer();
    setAllRules(player, 0);
    opUpdateLootRule(player, {
      rules: [
        { id: lootRuleKeyOf('sword', 3), minQuality: 3, minLevel: 0, action: 1, enabled: true },
      ],
    });

    const recorded = rollOneEquip(player);

    // 不保证这一抽恰好是 sword:3，但无论命中与否都必须自洽：
    // 命中 → sell；未命中 → pickup。绝不允许出现「设置了却分解」这类错配。
    expect(recorded).toHaveLength(1);
    expect(['sell', 'pickup']).toContain(recorded[0]?.handled);
  });
});
