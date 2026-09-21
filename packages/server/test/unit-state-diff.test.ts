/**
 * `unit-state-diff` 单测（P1 影子差分核心）
 *
 * 覆盖：索引去重 / 非法条目 / 空集合 / 值比较（NaN、±0、嵌套、数组顺序）/
 * buffs 归一化 / add·chg·del 三态 / **静态字段变化不得产生补丁** /
 * 入参不被修改 / 累计窗口的静默判定与脏输入。
 */
import { describe, expect, it } from 'vitest';
import type { UnitStateDto } from '@idle-dark/protocol';
import {
  MUTABLE_UNIT_FIELDS,
  diffUnitStates,
  frameByteLength,
  sameBuffs,
  sameFieldValue,
  worldFrameOf,
  unitStateIndexOf,
} from '../src/modules/logic/world/internal/unit-state-diff.js';

function unit(partial: Partial<UnitStateDto> & { id: string }): UnitStateDto {
  return {
    kind: 'enemy',
    typeKey: 'slime.minimal',
    name: '小史莱姆',
    camp: 'enemy',
    level: 1,
    quality: 0,
    hp: 25,
    maxHp: 25,
    mp: 0,
    maxMp: 0,
    rp: 0,
    maxRp: 0,
    ep: 0,
    maxEp: 0,
    comboPoint: 0,
    targetId: null,
    castingProgress: null,
    buffs: [],
    ...partial,
  };
}

const indexOf = (...units: UnitStateDto[]) => unitStateIndexOf(units);

describe('MUTABLE_UNIT_FIELDS', () => {
  it('包含会在出生后变化的 9 个字段，且 camp 必须在列（死亡 enemy→ghost / 中立参战 neutral→enemy）', () => {
    expect([...MUTABLE_UNIT_FIELDS].sort()).toEqual(
      ['buffs', 'camp', 'castingProgress', 'comboPoint', 'ep', 'hp', 'mp', 'rp', 'targetId'].sort(),
    );
  });
});

describe('unitStateIndexOf', () => {
  it('空数组 / 非数组 → 空索引', () => {
    expect(unitStateIndexOf([]).size).toBe(0);
    expect(unitStateIndexOf(undefined as never).size).toBe(0);
  });

  it('跳过非法条目（null / 非对象 / 缺 id / 空 id），不抛错', () => {
    const index = unitStateIndexOf([
      null as never,
      42 as never,
      { name: '没有 id' } as never,
      unit({ id: '' }),
      unit({ id: 'ok' }),
    ]);
    expect([...index.keys()]).toEqual(['ok']);
  });

  it('重复 id → 后者胜（不得产生两条同 id 的 add）', () => {
    const index = unitStateIndexOf([unit({ id: 'a', hp: 1 }), unit({ id: 'a', hp: 9 })]);
    expect(index.size).toBe(1);
    expect(index.get('a')?.hp).toBe(9);
  });
});

describe('sameFieldValue', () => {
  it('NaN 与 NaN 视为相同（否则每帧都误报变化）', () => {
    expect(sameFieldValue(Number.NaN, Number.NaN)).toBe(true);
    expect(sameFieldValue(Number.NaN, 0)).toBe(false);
  });

  it('+0 / -0 视为相同；Infinity 与 -Infinity 不同', () => {
    expect(sameFieldValue(0, -0)).toBe(true);
    expect(sameFieldValue(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(true);
    expect(sameFieldValue(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)).toBe(false);
  });

  it('null / undefined 互不相等，且都与数字不等', () => {
    expect(sameFieldValue(null, null)).toBe(true);
    expect(sameFieldValue(undefined, undefined)).toBe(true);
    expect(sameFieldValue(null, undefined)).toBe(false);
    expect(sameFieldValue(null, 0)).toBe(false);
  });

  it('数组按顺序比较；对象按键内容比较（键序无关）', () => {
    expect(sameFieldValue([1, 2], [1, 2])).toBe(true);
    expect(sameFieldValue([1, 2], [2, 1])).toBe(false);
    expect(sameFieldValue([1], [1, 2])).toBe(false);
    expect(sameFieldValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameFieldValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe('sameBuffs', () => {
  it('顺序抖动不算变化（按 key 归一化）', () => {
    const a = [
      { key: 'poison', name: '中毒', stack: 2, remainMs: 1000 },
      { key: 'slow', name: '减速', stack: 1, remainMs: 500 },
    ];
    const b = [
      { key: 'slow', name: '减速', stack: 1, remainMs: 500 },
      { key: 'poison', name: '中毒', stack: 2, remainMs: 1000 },
    ];
    expect(sameBuffs(a, b)).toBe(true);
  });

  it('层数 / 剩余时间变化算变化', () => {
    const base = [{ key: 'poison', name: '中毒', stack: 2, remainMs: 1000 }];
    expect(sameBuffs(base, [{ key: 'poison', name: '中毒', stack: 3, remainMs: 1000 }])).toBe(false);
    expect(sameBuffs(base, [{ key: 'poison', name: '中毒', stack: 2, remainMs: 800 }])).toBe(false);
    expect(sameBuffs(base, [])).toBe(false);
  });

  it('非数组一律当空数组处理，不抛错', () => {
    expect(sameBuffs(undefined, [])).toBe(true);
    expect(sameBuffs(null, [])).toBe(true);
    expect(sameBuffs('x', [])).toBe(true);
    expect(sameBuffs(undefined, [{ key: 'a' }])).toBe(false);
  });
});

describe('diffUnitStates', () => {
  it('两边都空 → 空补丁（= 静默窗口）', () => {
    expect(diffUnitStates(new Map(), [])).toEqual([]);
  });

  it('首帧（prev 为空）→ 全部 add', () => {
    const ops = diffUnitStates(new Map(), [unit({ id: 'a' }), unit({ id: 'b' })]);
    expect(ops.map((o) => o.op)).toEqual(['add', 'add']);
  });

  it('单位消失 → del（语义 = 从 units 移除，即清尸）', () => {
    const ops = diffUnitStates(indexOf(unit({ id: 'a' }), unit({ id: 'b' })), []);
    expect(ops).toEqual([
      { op: 'del', id: 'a' },
      { op: 'del', id: 'b' },
    ]);
  });

  it('完全没变 → 空补丁（这是静默率的基础）', () => {
    const before = indexOf(unit({ id: 'a', hp: 10 }), unit({ id: 'b', hp: 20 }));
    const after = [unit({ id: 'a', hp: 10 }), unit({ id: 'b', hp: 20 })];
    expect(diffUnitStates(before, after)).toEqual([]);
  });

  it('只发变化字段：hp 变了就只带 hp', () => {
    const before = indexOf(unit({ id: 'a', hp: 25, camp: 'enemy' }));
    const ops = diffUnitStates(before, [unit({ id: 'a', hp: 12, camp: 'enemy' })]);
    expect(ops).toEqual([{ op: 'chg', id: 'a', fields: { hp: 12 } }]);
  });

  it('死亡帧：camp→ghost / hp≤0 / targetId→null / buffs 清空 一并带出', () => {
    const before = indexOf(
      unit({
        id: 'e1',
        camp: 'enemy',
        hp: 30,
        targetId: 'me',
        castingProgress: 0.5,
        buffs: [{ key: 'poison', name: '中毒', stack: 1, remainMs: 900 }],
      }),
    );
    const dead = unit({
      id: 'e1',
      camp: 'ghost',
      hp: -4,
      targetId: null,
      castingProgress: null,
      buffs: [],
    });
    const ops = diffUnitStates(before, [dead]);
    expect(ops).toEqual([
      {
        op: 'chg',
        id: 'e1',
        fields: { hp: -4, targetId: null, castingProgress: null, buffs: [], camp: 'ghost' },
      },
    ]);
  });

  it('中立怪被攻击参战（neutral → enemy）必须被捕捉', () => {
    const before = indexOf(unit({ id: 'n1', camp: 'neutral' }));
    const ops = diffUnitStates(before, [unit({ id: 'n1', camp: 'enemy' })]);
    expect(ops).toEqual([{ op: 'chg', id: 'n1', fields: { camp: 'enemy' } }]);
  });

  it('⚠️ 静态字段变化**不得**产生补丁（否则每帧都会误报）', () => {
    const before = indexOf(unit({ id: 'a' }));
    const ops = diffUnitStates(before, [
      unit({ id: 'a', name: '换了个名字', level: 99, maxHp: 999, typeKey: 'other', quality: 3, boss: true }),
    ]);
    expect(ops).toEqual([]);
  });

  it('buffs 仅顺序不同 → 不产生补丁；内容不同 → 产生补丁', () => {
    const buffs = [
      { key: 'poison', name: '中毒', stack: 1, remainMs: 1000 },
      { key: 'slow', name: '减速', stack: 1, remainMs: 1000 },
    ];
    const before = indexOf(unit({ id: 'a', buffs }));
    expect(diffUnitStates(before, [unit({ id: 'a', buffs: [...buffs].reverse() })])).toEqual([]);
    expect(
      diffUnitStates(before, [unit({ id: 'a', buffs: [{ key: 'poison', name: '中毒', stack: 2, remainMs: 1000 }] })]),
    ).toHaveLength(1);
  });

  it('NaN 与 NaN 不产生补丁（脏值不得让静默率归零）', () => {
    const before = indexOf(unit({ id: 'a', hp: Number.NaN }));
    expect(diffUnitStates(before, [unit({ id: 'a', hp: Number.NaN })])).toEqual([]);
  });

  it('同一窗口内 add / chg / del 混合，按 cur 顺序输出 add·chg，再输出 del', () => {
    const before = indexOf(unit({ id: 'old', hp: 5 }), unit({ id: 'stay', hp: 5 }));
    const ops = diffUnitStates(before, [
      unit({ id: 'stay', hp: 1 }),
      unit({ id: 'new', hp: 5 }),
    ]);
    expect(ops.map((o) => [o.op, 'id' in o ? o.id : o.unit.id])).toEqual([
      ['chg', 'stay'],
      ['add', 'new'],
      ['del', 'old'],
    ]);
  });

  it('不修改入参（prev 与 next 都保持原样）', () => {
    const beforeUnit = unit({ id: 'a', hp: 10 });
    const afterUnit = unit({ id: 'a', hp: 3 });
    const before = indexOf(beforeUnit);
    const snapshotBefore = JSON.stringify(beforeUnit);
    const snapshotAfter = JSON.stringify(afterUnit);
    diffUnitStates(before, [afterUnit]);
    expect(JSON.stringify(beforeUnit)).toBe(snapshotBefore);
    expect(JSON.stringify(afterUnit)).toBe(snapshotAfter);
    expect(before.size).toBe(1);
  });

  it('超大列表不炸（1k 单位，全量新增）', () => {
    const many = Array.from({ length: 1000 }, (_, i) => unit({ id: `u${i}` }));
    const ops = diffUnitStates(new Map(), many);
    expect(ops).toHaveLength(1000);
  });
});

describe('worldFrameOf', () => {
  const base = {
    patch: [] as const,
    log: [] as const,
    loot: [] as const,
    gainedExp: 0,
    gainedGold: 0,
    wave: 3,
    prevWave: 3,
    bossPending: true,
    prevBossPending: true,
  };

  it('全空且波数未推进 → null（新方案下不发任何消息）', () => {
    expect(worldFrameOf(base)).toBeNull();
  });

  it('任一分区非空 → 出帧', () => {
    expect(worldFrameOf({ ...base, patch: [{ op: 'del', id: 'a' }] })).not.toBeNull();
    expect(worldFrameOf({ ...base, log: [{ kind: 'general', text: 'x' }] })).not.toBeNull();
    expect(worldFrameOf({ ...base, loot: [{ slot: {} as never, handled: 'pickup' }] })).not.toBeNull();
    expect(worldFrameOf({ ...base, gainedExp: 1 })).not.toBeNull();
    expect(worldFrameOf({ ...base, gainedGold: -1 })).not.toBeNull();
  });

  it('只有波数推进也要发（客户端据此更新距 BOSS 波数）', () => {
    const frame = worldFrameOf({ ...base, wave: 4 });
    expect(frame?.wave).toBe(4);
  });

  it('守关 BOSS 可刷状态翻转也要发（通关后 UI 要立刻收起倒计时）', () => {
    const frame = worldFrameOf({ ...base, bossPending: false });
    expect(frame?.bossPending).toBe(false);
    // 反向（换图重置到还会刷的图）同样要发
    expect(worldFrameOf({ ...base, bossPending: true, prevBossPending: false })?.bossPending).toBe(true);
  });

  it('bossPending 缺失 / 脏值一律按 false（不显示倒计时），且不因缺失反复出帧', () => {
    const noBoss = { ...base, bossPending: undefined as unknown as boolean, prevBossPending: undefined as unknown as boolean };
    expect(worldFrameOf(noBoss)).toBeNull();
    const frame = worldFrameOf({ ...noBoss, log: [{ kind: 'general', text: 'x' }] });
    expect(frame?.bossPending).toBe(false);
  });

  it('脏输入归一：NaN / Infinity → 0，不被当成「有变化」', () => {
    expect(worldFrameOf({ ...base, gainedExp: Number.NaN, gainedGold: Number.POSITIVE_INFINITY })).toBeNull();
    const frame = worldFrameOf({ ...base, gainedExp: Number.NaN, log: [{ kind: 'general', text: 'x' }] });
    expect(frame?.gainedExp).toBe(0);
    expect(frame?.gainedGold).toBe(0);
  });

  it('出帧时复制数组（不与入参共享引用）', () => {
    const patch = [{ op: 'del', id: 'a' }] as const;
    const log = [{ kind: 'general', text: 'x' }] as const;
    const frame = worldFrameOf({ ...base, patch: [...patch], log: [...log] });
    expect(frame?.patch).not.toBe(patch);
    expect(frame?.log).not.toBe(log);
  });
});

describe('frameByteLength', () => {
  it('普通对象 → 正数', () => {
    expect(frameByteLength({ a: 1 })).toBeGreaterThan(0);
  });

  it('不可序列化（循环引用 / undefined）→ 0，绝不抛', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(frameByteLength(circular)).toBe(0);
    expect(frameByteLength(undefined)).toBe(0);
  });
});
