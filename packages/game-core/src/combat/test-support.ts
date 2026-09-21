/**
 * combat 单测/演示用的内联 fixture 与记录式 `BattleSink`。
 *
 * 任务书要求：`rules/` / `data/` 可能尚未就绪，combat 的测试必须能用**内联 fixture
 * 构造 `DataTables`** 独立运行。本文件即那套 fixture，不依赖 `src/data` 或 `src/rules`。
 */

import type { BattleSink } from '../contracts/ports.js';
import type {
  BuffData,
  DataTables,
  EnemyData,
  MapData,
  SkillData,
} from '../contracts/data.js';
import type { Rng } from '../contracts/ports.js';
import { SeededRngFactory } from '../rng/index.js';
import { VirtualClock } from '../sim/index.js';
import { BattleWorld, type BattleWorldOptions } from './battle-world.js';
import type { PlayerLike } from './player-unit.js';
import type { Unit } from './unit.js';
import type { SkillState } from './skill-state.js';

/** 收集所有事件的可重放 Sink。事件字段顺序固定，便于逐字节比较。 */
export class RecordingSink implements BattleSink {
  events: Array<Record<string, unknown>> = [];

  damage(e: {
    fromId: string;
    toId: string;
    damageType: string;
    skill: string;
    skillName?: string;
    value: number;
    crit: boolean;
    absorbed: number;
  }): void {
    this.events.push({
      kind: 'damage',
      fromId: e.fromId,
      toId: e.toId,
      damageType: e.damageType,
      skill: e.skill,
      ...(e.skillName !== undefined ? { skillName: e.skillName } : {}),
      value: e.value,
      crit: e.crit,
      absorbed: e.absorbed,
    });
  }
  heal(e: { fromId: string; toId: string; skill: string; skillName?: string; value: number }): void {
    this.events.push({
      kind: 'heal',
      fromId: e.fromId,
      toId: e.toId,
      skill: e.skill,
      ...(e.skillName !== undefined ? { skillName: e.skillName } : {}),
      value: e.value,
    });
  }
  dodge(e: { fromId: string; toId: string; skill: string; skillName?: string }): void {
    this.events.push({
      kind: 'dodge',
      fromId: e.fromId,
      toId: e.toId,
      skill: e.skill,
      ...(e.skillName !== undefined ? { skillName: e.skillName } : {}),
    });
  }
  death(e: { unitId: string; name: string; camp: string }): void {
    this.events.push({ kind: 'death', unitId: e.unitId, name: e.name, camp: e.camp });
  }
  buff(e: { unitId: string; buffKey: string; name: string; on: boolean }): void {
    this.events.push({ kind: 'buff', unitId: e.unitId, buffKey: e.buffKey, name: e.name, on: e.on });
  }
  exp(e: { amount: number; level: number; whoId?: string }): void {
    this.events.push({
      kind: 'exp',
      amount: e.amount,
      level: e.level,
      ...(e.whoId !== undefined ? { whoId: e.whoId } : {}),
    });
  }
  general(e: { text: string }): void {
    this.events.push({ kind: 'general', text: e.text });
  }
  loot(e: {
    key: string;
    count: number;
    quality: number;
    handled: string;
    gold?: number;
    materials?: Array<{ key: string; count: number }>;
  }): void {
    this.events.push({
      kind: 'loot',
      key: e.key,
      count: e.count,
      quality: e.quality,
      handled: e.handled,
      gold: e.gold,
    });
  }
  mapEnter(mapKey: string, name: string): void {
    this.events.push({ kind: 'mapEnter', mapKey, name });
  }

  clear(): void {
    this.events.length = 0;
  }
}

// ────────────────────────────── 数据表 fixture ──────────────────────────────

function emptyTables(): DataTables {
  return {
    careers: {},
    roles: {},
    maps: {},
    enemies: {},
    skills: {},
    goods: {},
    passives: {},
    enhances: {},
    buffs: {},
    affixes: {},
    enemyAffixes: {},
    legends: {},
    medicines: {},
    upgrades: { bankByDiamonds: [], inventoryByDiamonds: [], inventory: [] },
    announcement: { version: 'test' },
  };
}

/** 造一条 `EnemyData`（允许写入契约未声明的原版字段，如 `def` / `maxMp`）。 */
export function enemyData(partial: Partial<EnemyData> & Record<string, unknown>): EnemyData {
  return {
    key: 'dummy',
    name: 'Dummy',
    camp: 'enemy',
    maxHp: 100,
    atk: 10,
    atkSpeed: 1,
    exp: 10,
    level: 1,
    skills: [],
    ...partial,
  } as EnemyData;
}

/** 造一条 `SkillData`。 */
export function skillData(partial: Partial<SkillData> & Record<string, unknown>): SkillData {
  return {
    key: 'melee',
    name: 'Melee',
    group: 'basic',
    description: '',
    isAttack: true,
    coolDown: 1000,
    maxExp: () => 1,
    effect: () => {},
    ...partial,
  } as SkillData;
}

export function buffData(partial: Partial<BuffData> & Record<string, unknown>): BuffData {
  return {
    key: 'regen',
    name: 'Regen',
    ...partial,
  } as BuffData;
}

export function mapData(partial: Partial<MapData> & Record<string, unknown>): MapData {
  return {
    key: 'home',
    name: 'Home',
    ...partial,
  } as MapData;
}

/**
 * 默认 fixture：
 * - `melee`：普攻，命中目标，伤害 = `self.atk`，冷却 1000ms；
 * - `dummy` / `tank`：两种敌人；
 * - `field`：会刷 dummy 的地图；
 * - `regen` / `stacktest`：两种 Buff。
 */
export function makeTables(overrides?: Partial<DataTables>): DataTables {
  const tables = emptyTables();
  tables.skills = {
    melee: skillData({
      key: 'melee',
      name: 'Melee',
      isAttack: true,
      coolDown: 1000,
      effect(this: unknown, world: unknown, self: unknown) {
        const w = world as BattleWorld;
        const u = self as Unit;
        const state = this as SkillState;
        const target = u.target;
        if (!target) {
          return;
        }
        // 与真实数据里的普攻一致：先闪避判定，再暴击判定。
        if (w.testDodge(u, target, state)) {
          return;
        }
        const crit = u.testCrit();
        const bonus = u.getCritBonus(crit);
        w.sendDamage('melee', u, target, state, u.atk * bonus, crit > 0);
      },
    }),
    fireball: skillData({
      key: 'fireball',
      name: 'Fireball',
      group: 'spell',
      isAttack: false,
      coolDown: 2000,
      cost: { mp: 5 },
      effect(this: unknown, world: unknown, self: unknown) {
        const w = world as BattleWorld;
        const u = self as Unit;
        const state = this as SkillState;
        const target = u.target;
        if (!target) {
          return;
        }
        if (w.testDodge(u, target, state)) {
          return;
        }
        const crit = u.testCrit();
        const bonus = u.getCritBonus(crit);
        w.sendDamage('fire', u, target, state, u.atk * 2 * bonus, crit > 0);
      },
    }),
  };
  tables.enemies = {
    dummy: enemyData({ key: 'dummy', name: 'Dummy', maxHp: 100, atk: 10, atkSpeed: 1, exp: 10, level: 1 }),
    tank: enemyData({
      key: 'tank',
      name: 'Tank',
      maxHp: 300,
      atk: 5,
      atkSpeed: 0.5,
      exp: 20,
      level: 2,
      skills: [],
      def: 50,
    }),
    noSkill: enemyData({ key: 'noSkill', name: 'NoSkill', maxHp: 50, atk: 0, atkSpeed: 1, skills: [] }),
  };
  // dummy 会主动用 melee 攻击
  tables.enemies.dummy!.skills = [{ key: 'melee', level: 1 }];
  tables.maps = {
    home: mapData({ key: 'home', name: 'Home', monsters: [] }),
    field: mapData({
      key: 'field',
      name: 'Field',
      monsters: [{ type: 'dummy', delay: 1000, max: 1 }],
    }),
  };
  tables.buffs = {
    regen: buffData({
      key: 'regen',
      name: 'Regen',
      effectInterval: 500,
      effect(this: unknown) {
        const b = this as { unit: { hp: number } };
        b.unit.hp += 5;
      },
    }),
    stacktest: buffData({ key: 'stacktest', name: 'Stack' }),
    stun: buffData({
      key: 'stun',
      name: 'Stun',
      // 契约把 Buff hook 的返回值标为 number，但原版 `stunned` 这类返回布尔。
      hooks: { stunned: (() => true) as unknown as (value: number) => number },
    }),
    shield: buffData({
      key: 'shield',
      name: 'Shield',
      hooks: {
        absorbed: (value: number) => Math.max(0, value - 20),
      },
    }),
  };
  tables.affixes = {};
  tables.enemyAffixes = {
    stronger: { key: 'stronger', name: 'Stronger', hooks: { maxHp: (_w: unknown, v: number) => v * 2 } },
    faster: { key: 'faster', name: 'Faster', hooks: { atkSpeed: (_w: unknown, v: number) => v + 0.5 } },
  };
  tables.passives = {
    tough: { key: 'tough', name: 'Tough', description: '', hooks: { maxHp: (v: number) => v * 2 } },
  };
  tables.enhances = {
    quick: { key: 'quick', name: 'Quick', description: '', hooks: { atkSpeedAdd: (v: number) => v + 1 } },
  };
  tables.careers = {
    warrior: {
      key: 'warrior',
      name: 'Warrior',
      description: '',
      requirement: {},
      equipments: {},
      expFormula: [100],
      attrGrow: { str: 1, dex: 1, int: 1 },
      skills: { melee: 1 },
      passives: {},
      enhances: {},
      availableClasses: {},
    },
  };
  tables.roles = {
    hero: {
      key: 'hero',
      name: 'Hero',
      description: '',
      defaultCareer: 'warrior',
      atk: 10,
      atkSpeed: 1,
      attrBase: { str: 5, dex: 5, int: 5 },
      startup: {},
    },
  };
  Object.assign(tables, overrides ?? {});
  return tables;
}

// ────────────────────────────── 玩家 fixture ──────────────────────────────

function emptySlot(): PlayerLike['equipments'][keyof PlayerLike['equipments']] {
  return { empty: true, level: 0, atk: 0, atkSpeed: 0, def: 0, maxHp: 0, affixes: [] };
}

export function makePlayer(overrides?: Partial<PlayerLike>): PlayerLike {
  const player: PlayerLike = {
    key: 1,
    name: 'Hero',
    level: 1,
    exp: 0,
    maxExp: 100,
    maxLevel: 100,
    roleData: { key: 'hero', attrBase: { str: 5, dex: 5, int: 5 }, atk: 10, atkSpeed: 1 },
    careerData: {
      key: 'warrior',
      passives: {},
      attrGrow: { str: 1, dex: 1, int: 1 },
      availableClasses: {},
    },
    careerInfo: { selectedSkills: ['melee'], selectedEnhances: [] },
    equipments: {
      weapon: emptySlot(),
      offHand: emptySlot(),
      plastron: emptySlot(),
      gloves: emptySlot(),
      belt: emptySlot(),
      boots: emptySlot(),
      amulet: emptySlot(),
      ring1: emptySlot(),
      ring2: emptySlot(),
    },
    getSkillLevel: () => 1,
    addSkillExp: () => {},
    selectCareer: () => {},
    lootRule: new Map(),
    minLootLevel: 0,
    loot: () => {},
  };
  return Object.assign(player, overrides ?? {});
}

// ────────────────────────────── 世界 fixture ──────────────────────────────

export interface TestWorld {
  clock: VirtualClock;
  sink: RecordingSink;
  world: BattleWorld;
  rng: Rng;
}

export function makeTestWorld(
  options?: Partial<Omit<BattleWorldOptions, 'clock' | 'tables' | 'rng' | 'sink'>> & {
    seed?: number;
    tables?: DataTables;
  },
): TestWorld {
  const clock = new VirtualClock();
  const sink = new RecordingSink();
  const rng = new SeededRngFactory().create(options?.seed ?? 1);
  const { seed: _seed, tables, ...rest } = options ?? {};
  const world = new BattleWorld({
    clock,
    sink,
    rng,
    tables: tables ?? makeTables(),
    ...rest,
  });
  return { clock, sink, world, rng };
}

/** 简单的 32 位 FNV-1a：用于把事件流压成一个可断言的稳定哈希。 */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
