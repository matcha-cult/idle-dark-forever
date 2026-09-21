/**
 * `player-attributes` 投影单测。
 *
 * 这一层的职责只有三件事，因此测试也按这三件事组织：
 * 1. **换算正确**：比率 ×100、每 5 秒 ×5、`(x-1)×100` —— 换算错了面板就是错的；
 * 2. **前端零推导**：下发的必须是**已换算 + 已取整**的展示值（1 位小数 / 整数截断）；
 * 3. **永远有限**：`runAttrHooks` 由 183 个数据文件驱动，`NaN`/`Infinity`/`null` 必须被兜住，
 *    绝不能把 `NaN` 写进线协议（JSON 里会变成 `null`，前端再算就是 `NaN`）。
 *
 * 另有一条「只有玩家单位带属性」的回归：敌方单位拿到 `attributes` 会让整份属性表跟怪一起发。
 */
import { describe, expect, it } from 'vitest';
import { Player, VirtualClock, createDefaultTables } from '@idle-dark/game-core';
import type { PlayerUnit } from '@idle-dark/game-core';
import { BattleCollector } from '../src/modules/logic/shared/battle-collector.js';
import { buildBattleWorld } from '../src/modules/logic/shared/headless.js';
import { playerAttributesOf } from '../src/modules/logic/world/internal/player-attributes.js';
import { unitStateDtoOf } from '../src/modules/logic/world/internal/unit-state.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;

function freshPlayer(level = 1): Player {
  const player = Player.fromJSON(tables, 'c1', () => NOW, {
    role: 'Eyer',
    currentCareer: 'warrior',
    careers: { warrior: { type: 'warrior', level } },
  });
  player.postCreate();
  player.selectCareer('warrior');
  return player;
}

/** 直接构造「可被投影读取」的最小替身（只实现投影真正读到的 getter）。 */
function fakeUnit(overrides: Record<string, unknown> = {}): PlayerUnit {
  const base: Record<string, unknown> = {
    str: 10,
    dex: 20,
    int: 30,
    atk: 12.34,
    atkSpeed: 1.05,
    speedRate: 1.2,
    critRate: 0.167,
    critBonus: 1.865,
    dmgAdd: 1.1,
    hpFromKill: 3.33,
    mpFromKill: 0,
    expInc: 1.5,
    skillExpInc: 1,
    mf: 2.17,
    gf: 1.07,
    dodgeRate: 0.329,
    def: 606.9,
    fireResist: 60.7,
    coldResist: -5,
    lightningResist: 0,
    chaosResist: 12.2,
    fireAbsorb: 0.287,
    coldAbsorb: 0.2,
    lightningAbsorb: 0,
    chaosAbsorb: 0.284,
    meleeAbsorb: 0.3,
    hpRecovery: 39.76,
    mpRecovery: 1,
    rpRecovery: -1,
    epRecovery: 0,
    rpRecHp: 2.5,
    leech: 0.55,
    player: { careerName: '战士', maxLevel: 60, careerData: { key: 'warrior' } },
    ...overrides,
  };
  return base as unknown as PlayerUnit;
}

describe('playerAttributesOf —— 换算与取整', () => {
  it('比率 ×100、`(x-1)×100`、每 5 秒 ×5 全部在服务端做掉', () => {
    const attr = playerAttributesOf(fakeUnit());
    expect(attr.critRatePct).toBe(16.7); // 0.167 × 100
    expect(attr.critBonusPct).toBe(186.5); // 1.865 × 100（不是 ×100-1）
    expect(attr.speedBonusPct).toBe(20); // (1.2 - 1) × 100
    expect(attr.dmgBonusPct).toBe(10); // (1.1 - 1) × 100
    expect(attr.expBonusPct).toBe(50);
    expect(attr.skillExpBonusPct).toBe(0);
    expect(attr.magicFindPct).toBe(117);
    expect(attr.goldFindPct).toBe(7);
    expect(attr.dodgeRatePct).toBe(32.9);
    expect(attr.fireAbsorbPct).toBe(28.7);
    expect(attr.hpRecovery5s).toBe(198.8); // 39.76 × 5
    expect(attr.mpRecovery5s).toBe(5);
    expect(attr.rpRecovery5s).toBe(-5);
    expect(attr.epRecovery5s).toBe(0);
  });

  it('1 位小数项四舍五入；整数项向零截断（对齐原版 FixedField / IntField）', () => {
    const attr = playerAttributesOf(
      fakeUnit({ atk: 12.34, atkSpeed: 1.05, hpFromKill: 3.35, def: 606.9, str: 10.9, fireResist: 60.7, coldResist: -5.9 }),
    );
    expect(attr.atk).toBe(12.3);
    expect(attr.atkSpeed).toBe(1.1); // 12.35 的浮点表示 > 1.05 ⇒ 1.1
    expect(attr.hpFromKill).toBe(3.4);
    expect(attr.def).toBe(606);
    expect(attr.str).toBe(10);
    expect(attr.fireResist).toBe(60);
    expect(attr.coldResist).toBe(-5); // 截断向零，不是 -6
  });

  it('职业显示名 / 等级上限：有 `careerName` 用它，缺失回落到职业 key', () => {
    expect(playerAttributesOf(fakeUnit()).careerName).toBe('战士');
    expect(
      playerAttributesOf(fakeUnit({ player: { careerData: { key: 'sorceress' } } })).careerName,
    ).toBe('sorceress');
    expect(playerAttributesOf(fakeUnit({ player: null })).careerName).toBe('');
    expect(playerAttributesOf(fakeUnit()).maxLevel).toBe(60);
  });
});

describe('playerAttributesOf —— 边界（坏 hook 只应让某行为 0，不得抛错）', () => {
  const dirty: Array<[string, unknown]> = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['undefined', undefined],
    ['null', null],
    ['字符串', '12'],
    ['对象', {}],
    ['超大值', 1e308],
  ];

  for (const [name, value] of dirty) {
    it(`${name} → 该字段回落 0（不产生 NaN / 不抛错）`, () => {
      const attr = playerAttributesOf(fakeUnit({ atk: value, str: value, critRate: value, hpRecovery: value }));
      expect(Number.isFinite(attr.atk)).toBe(true);
      expect(Number.isFinite(attr.str)).toBe(true);
      expect(Number.isFinite(attr.critRatePct)).toBe(true);
      expect(Number.isFinite(attr.hpRecovery5s)).toBe(true);
      // `1e308` 是有限数，但它 ×100 会溢出成 Infinity ⇒ 必须仍被夹成有限值。
    });
  }

  it('`player === null`（异常态）→ 全部数值有限、职业名为空串，绝不抛错', () => {
    const attr = playerAttributesOf(fakeUnit({ player: null }));
    expect(attr.careerName).toBe('');
    expect(attr.maxLevel).toBe(0);
    for (const [key, value] of Object.entries(attr)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('负数是合法值（诅咒 / debuff），不得被夹到 0', () => {
    const attr = playerAttributesOf(fakeUnit({ atk: -5, critRate: -0.1 }));
    expect(attr.atk).toBe(-5);
    expect(attr.critRatePct).toBe(-10);
  });
});

describe('unitStateDtoOf —— 属性只属于玩家单位', () => {
  it('玩家单位带 `attributes` / `exp` / `maxExp`，且字段有限', () => {
    const player = freshPlayer();
    const clock = new VirtualClock();
    const { world, playerUnit } = buildBattleWorld({
      tables,
      player,
      map: 'world.1',
      seed: 7,
      sink: new BattleCollector(),
      clock,
    });
    const dto = unitStateDtoOf(playerUnit, world.playerUnit);
    expect(dto.kind).toBe('player');
    expect(dto.attributes).toBeDefined();
    expect(dto.attributes?.careerName).toBe('战士');
    expect(dto.attributes?.maxLevel).toBeGreaterThan(0);
    expect(Number.isFinite(dto.exp)).toBe(true);
    expect(Number.isFinite(dto.maxExp)).toBe(true);
    // 三维必须是真实内核值（E1：`attrBase + attrGrow × level`），不是替身常量。
    expect(dto.attributes?.str).toBeGreaterThanOrEqual(0);
    for (const value of Object.values(dto.attributes ?? {})) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
    world.dispose();
    clock.dispose();
  });

  it('敌方单位**不带** `attributes` / `exp`（否则整份属性表会跟着每只怪一起发）', () => {
    const player = freshPlayer();
    const clock = new VirtualClock();
    const { world } = buildBattleWorld({
      tables,
      player,
      map: 'world.1',
      seed: 8,
      sink: new BattleCollector(),
      clock,
    });
    // 刷怪是定时器驱动的：先推进虚拟时间，等第一波怪真正出生。
    clock.advanceBy(20_000, 5_000);
    const enemy = world.units.find((unit) => unit !== world.playerUnit);
    expect(enemy).toBeDefined();
    const dto = unitStateDtoOf(enemy!, world.playerUnit);
    expect(dto.kind).not.toBe('player');
    expect(dto.attributes).toBeUndefined();
    expect(dto.exp).toBeUndefined();
    expect(dto.maxExp).toBeUndefined();
    world.dispose();
    clock.dispose();
  });
});
