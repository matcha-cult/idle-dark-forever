/**
 * 测试夹具：`InventorySlotDto` / `UnitStateDto` 的最小构造器。
 *
 * 放在 `testing/`（不是 `src/` 根）：它们是**测试基础设施**，随
 * `@idle-dark/ui-kit/testing` 子路径导出，不参与主 barrel，也不假装是业务数据。
 * 只 `import type` protocol（运行时零依赖）。
 */
import type { InventorySlotDto, PlayerAttributesDto, UnitStateDto } from '@idle-dark/protocol';

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

/**
 * 构造一份**玩家单位属性投影**（值本身就是展示值：百分数已 ×100、每 5 秒已 ×5）。
 *
 * 默认值刻意各不相同，方便断言「哪一行渲染的是哪个字段」时一眼看出串行。
 */
export function makeAttributes(overrides: Partial<PlayerAttributesDto> = {}): PlayerAttributesDto {
  return {
    careerName: '战士',
    maxLevel: 60,
    str: 244,
    dex: 147,
    int: 60,
    atk: 221,
    atkSpeed: 0.5,
    speedBonusPct: 20,
    critRatePct: 16.7,
    critBonusPct: 186.5,
    dmgBonusPct: 0,
    hpFromKill: 107.7,
    mpFromKill: 0,
    expBonusPct: 0,
    skillExpBonusPct: 0,
    magicFindPct: 117,
    goldFindPct: 117,
    dodgeRatePct: 32.9,
    def: 606,
    fireResist: 60,
    coldResist: 60,
    lightningResist: 60,
    chaosResist: 60,
    fireAbsorbPct: 28.7,
    coldAbsorbPct: 20,
    lightningAbsorbPct: 20,
    chaosAbsorbPct: 28.4,
    meleeAbsorbPct: 30,
    hpRecovery5s: 198.8,
    mpRecovery5s: 0,
    rpRecovery5s: -5,
    epRecovery5s: 0,
    rpRecHp: 0,
    leech: 0,
    ...overrides,
  };
}
