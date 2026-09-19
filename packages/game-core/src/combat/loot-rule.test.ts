/**
 * 掉落规则端到端（战斗内核内）集成测试。
 *
 * 这是**回归护栏**：面板写入 `player.lootRule` 的编码必须被 `BattleWorld.loots()`
 * 正确消费。历史缺陷是两侧编码漂移（面板 `c:class:quality`、战斗按 `class` 读并
 * 对 number 再索引 quality），表现为「自动出售/分解设置后仍然全部入包」。
 *
 * 因此这里不打桩 `getLootRule`，而是从 `loots()` 入口一路断言到 `BattleSink.loot`
 * 事件（`sell` 出金币 / `decompose` 出材料 / `pickup` 出原装备）。
 */

import { describe, expect, it } from 'vitest';

import { LOOT_RULE_ENABLED_KEY } from '../rules/loot-rule.js';
import { makePlayer, makeTestWorld } from './test-support.js';
import type { LootService, LootSlot } from './battle-world.js';

const EQUIP_PRICE = 120;

function equipSlot(clazz = 'sword', quality = 3): LootSlot {
  return {
    key: 'eq-1',
    count: 1,
    quality,
    price: EQUIP_PRICE,
    kind: 'loot',
    handled: 'pickup',
    goodData: { class: clazz },
  } as unknown as LootSlot;
}

function lootServiceOf(slot: LootSlot = equipSlot()): LootService {
  return {
    randomEquip: () => slot,
    generateEquip: () => slot,
    getDecomposeMaterials: () => ({ iron: 2 }),
  };
}

interface LootEvent {
  kind: string;
  key?: string;
  count?: number;
  quality?: number;
  handled?: string;
  gold?: number;
}

function runLoot(
  rules: Record<string, number>,
  minLootLevel: number,
  options: { quality?: number; lootLevel?: number; slot?: LootSlot } = {},
): LootEvent[] {
  const quality = options.quality ?? 3;
  const player = makePlayer({
    lootRule: new Map(Object.entries(rules)),
    minLootLevel,
  });
  const t = makeTestWorld({
    seed: 1,
    player,
    lootService: lootServiceOf(options.slot ?? equipSlot('sword', quality)),
  });
  t.world.addPlayer(player);
  t.world.loots([{ type: 'equip', rate: 1 }], options.lootLevel ?? 20, quality);
  return t.sink.events.filter((e) => e.kind === 'loot') as LootEvent[];
}

describe('BattleWorld 掉落规则：面板编码必须生效', () => {
  it('显式「出售」规则 → 掉落实体被换成金币，而不是入包', () => {
    expect(runLoot({ 'c:sword:3': 1 }, 0)).toEqual([
      { kind: 'loot', key: 'gold', count: EQUIP_PRICE, quality: 0, handled: 'sell', gold: EQUIP_PRICE },
    ]);
  });

  it('显式「分解」规则 → 掉落分解为材料（原版不拿金币、不拿装备）', () => {
    expect(runLoot({ 'c:sword:3': 2 }, 0)).toEqual([
      { kind: 'loot', key: 'iron', count: 2, quality: 0, handled: 'decompose', gold: undefined },
    ]);
  });

  it('未设置规则 → 原装备入包（pickup）', () => {
    expect(runLoot({}, 0)).toEqual([
      { kind: 'loot', key: 'eq-1', count: 1, quality: 3, handled: 'pickup', gold: undefined },
    ]);
  });

  it('停用规则（action + 10）→ 不作为显式规则，回落到 minLootLevel', () => {
    // minLootLevel = 0 → 无兜底 → 入包
    expect(runLoot({ 'c:sword:3': 12 }, 0)[0]?.handled).toBe('pickup');
    // minLootLevel = 60 → 兜底分解
    expect(runLoot({ 'c:sword:3': 12 }, 60)[0]?.handled).toBe('decompose');
  });

  it('全局开关关闭 → 忽略显式规则与 minLootLevel，一律入包', () => {
    const events = runLoot({ [LOOT_RULE_ENABLED_KEY]: 0, 'c:sword:3': 1 }, 60);
    expect(events).toHaveLength(1);
    expect(events[0]?.handled).toBe('pickup');
    expect(events[0]?.key).toBe('eq-1');
  });

  it('minLootLevel 兜底：低于阈值时 0 品质卖钱、其余分解', () => {
    expect(runLoot({}, 60, { lootLevel: 20, slot: equipSlot('sword', 0) })[0]?.handled).toBe('sell');
    expect(runLoot({}, 60, { lootLevel: 20, slot: equipSlot('sword', 3) })[0]?.handled).toBe(
      'decompose',
    );
    // 恰好等于阈值不触发
    expect(runLoot({}, 20, { lootLevel: 20 })[0]?.handled).toBe('pickup');
  });

  it('规则按 class + quality 精确匹配：错位不命中', () => {
    // 配置了 sword:2，掉的是 sword:3 → 不命中
    expect(runLoot({ 'c:sword:2': 1 }, 0)[0]?.handled).toBe('pickup');
    // 配置了 cloth:3，掉的是 sword:3 → 不命中
    expect(runLoot({ 'c:cloth:3': 1 }, 0)[0]?.handled).toBe('pickup');
  });
});

describe('BattleWorld.getLootRule：与面板编码同源', () => {
  function worldOf(rules: Record<string, number>, minLootLevel = 0) {
    const player = makePlayer({
      lootRule: new Map(Object.entries(rules)),
      minLootLevel,
    });
    const t = makeTestWorld({ seed: 1, player, lootService: lootServiceOf() });
    t.world.addPlayer(player);
    return t.world;
  }

  it('命中显式规则返回 1 / 2，停用与未命中返回 0', () => {
    expect(worldOf({ 'c:sword:3': 1 }).getLootRule('sword', 3, 20)).toBe(1);
    expect(worldOf({ 'c:sword:3': 2 }).getLootRule('sword', 3, 20)).toBe(2);
    expect(worldOf({ 'c:sword:3': 12 }).getLootRule('sword', 3, 20)).toBe(0);
    expect(worldOf({ 'c:sword:3': 1 }).getLootRule('cloth', 3, 20)).toBe(0);
  });

  it('minLootLevel 兜底与全局开关', () => {
    expect(worldOf({}, 60).getLootRule('sword', 3, 20)).toBe(2);
    expect(worldOf({}, 60).getLootRule('sword', 0, 20)).toBe(1);
    expect(worldOf({ [LOOT_RULE_ENABLED_KEY]: 0 }, 60).getLootRule('sword', 3, 20)).toBe(0);
  });

  it('未挂玩家时安全返回 0', () => {
    const t = makeTestWorld({ seed: 1 });
    expect(t.world.getLootRule('sword', 3, 20)).toBe(0);
  });
});
