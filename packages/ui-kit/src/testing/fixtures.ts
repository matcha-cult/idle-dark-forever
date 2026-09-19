/**
 * 测试夹具：`InventorySlotDto` / `UnitStateDto` 的最小构造器。
 *
 * 放在 `testing/`（不是 `src/` 根）：它们是**测试基础设施**，随
 * `@idle-dark/ui-kit/testing` 子路径导出，不参与主 barrel，也不假装是业务数据。
 * 只 `import type` protocol（运行时零依赖）。
 */
import type { InventorySlotDto, UnitStateDto } from '@idle-dark/protocol';

let seed = 0;

/** 自增 id，保证同一测试内多次构造的 key 稳定且不重复。 */
function nextId(prefix: string): string {
  seed += 1;
  return `${prefix}-${seed}`;
}

/** 重置夹具计数器（快照类断言前调用，保证可重复）。 */
export function resetFixtureSeed(): void {
  seed = 0;
}

/** 构造一个物品槽位（默认：精良武器，带 2 条词缀）。 */
export function makeSlot(overrides: Partial<InventorySlotDto> = {}): InventorySlotDto {
  return {
    id: nextId('slot'),
    key: 'sword.basic',
    count: 1,
    level: 12,
    quality: 2,
    position: 'inventory',
    displayQuality: 2,
    name: '夜刃短剑',
    type: 'equip',
    equipClass: 'warrior',
    equipPosition: 'weapon',
    price: 320,
    locked: false,
    enchantTimes: 0,
    affixes: [
      { key: 'atk', display: '攻击力 +12', isLegend: false },
      { key: 'crit', display: '暴击率 +3%', isLegend: true },
    ],
    ...overrides,
  };
}

/** 构造一个战斗单位（默认：我方角色，满血满蓝）。 */
export function makeUnit(overrides: Partial<UnitStateDto> = {}): UnitStateDto {
  return {
    id: nextId('unit'),
    kind: 'player',
    typeKey: 'warrior',
    name: '无名剑士',
    camp: 'player',
    level: 12,
    quality: 2,
    hp: 800,
    maxHp: 1000,
    mp: 100,
    maxMp: 200,
    rp: 0,
    maxRp: 100,
    ep: 50,
    maxEp: 100,
    comboPoint: 0,
    targetId: null,
    castingProgress: null,
    buffs: [],
    ...overrides,
  };
}
