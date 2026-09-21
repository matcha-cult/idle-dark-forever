/**
 * 战斗日志格式化单测（纯展示映射）。
 *
 * 覆盖两类曾经的缺陷：
 * - **历史单位查不到名字**：日志是历史、单位表是当下，渲染必须查「历史注册表」
 *   （`world.nameOf`），否则退化成原始 id；
 * - `general` 事件的 `key:参数` 文案直接透出（`enemy.appear:大史莱姆`）。
 */
import { describe, expect, it } from 'vitest';
import type { BattleEventDto } from '@idle-dark/protocol';
import {
  formatBattleEvent,
  formatBattleValue,
  formatGeneralText,
} from '../src/pages/game/panels/BattlePanel.js';

/** 模拟 `world.nameOf`：只认识注册表里的 id，其余回落原始 id。 */
function nameOfFrom(registry: Record<string, string>): (id: string) => string {
  return (id) => registry[id] ?? id;
}

describe('formatGeneralText', () => {
  it('enemy.appear → 「遭遇 X」', () => {
    expect(formatGeneralText('enemy.appear:大史莱姆')).toBe('遭遇 大史莱姆');
    expect(formatGeneralText('enemy.appear:')).toBe('敌人出现');
    expect(formatGeneralText('enemy.appear')).toBe('敌人出现');
  });

  it('map.enter → 「进入 X」（地图名自身含冒号也完整保留）', () => {
    expect(formatGeneralText('map.enter:world.2:迷雾林间')).toBe('进入 迷雾林间');
    expect(formatGeneralText('map.enter:world.9:猛兽:巢穴')).toBe('进入 猛兽:巢穴');
    expect(formatGeneralText('map.enter:world.2')).toBe('进入地图');
  });

  it('player.death → 「X 阵亡（Ns 后复活）」', () => {
    expect(formatGeneralText('player.death:艾尔:60')).toBe('艾尔 阵亡（60s 后复活）');
    expect(formatGeneralText('player.death:艾尔')).toBe('艾尔 阵亡');
    expect(formatGeneralText('player.death::60')).toBe('你 阵亡（60s 后复活）');
  });

  it('world.unitCap → 明确提示（I3：硬顶拒绝不许静默）', () => {
    expect(formatGeneralText('world.unitCap:小史莱姆')).toBe('场上单位已达上限，未能召唤更多敌人');
  });

  it('未知前缀 / 空 / 非字符串：原样透出，绝不吞掉', () => {
    expect(formatGeneralText('some.new.thing:a:b')).toBe('some.new.thing:a:b');
    expect(formatGeneralText('纯中文提示')).toBe('纯中文提示');
    expect(formatGeneralText('')).toBe('');
    expect(formatGeneralText(undefined as never)).toBe('');
    expect(formatGeneralText(null as never)).toBe('');
  });
});

describe('formatBattleEvent：名字解析', () => {
  const registry = { '1': '艾尔', '2': '大史莱姆' };
  const nameOf = nameOfFrom(registry);

  it('damage：双方都解析；已清尸的历史单位回落原始 id（可见的缺失，不是空串）', () => {
    const event: BattleEventDto = {
      kind: 'damage',
      fromId: '2',
      toId: '1',
      damageType: 'melee',
      skill: 'melee',
      value: 0,
      crit: false,
      absorbed: 0,
    };
    expect(formatBattleEvent(event, nameOf).text).toBe('大史莱姆 → 艾尔 melee 0');

    // 已清尸：id 仍原样显示（而不是变成 undefined/空）
    const historical = formatBattleEvent({ ...event, fromId: '99' }, nameOf);
    expect(historical.text).toBe('99 → 艾尔 melee 0');
  });

  it('formatBattleValue：小数不截断成 0（战斗数值是浮点，不能沿用整数的 formatAmount）', () => {
    expect(formatBattleValue(0)).toBe('0');
    expect(formatBattleValue(0.768)).toBe('0.8');
    expect(formatBattleValue(0.04)).toBe('0');
    expect(formatBattleValue(1)).toBe('1');
    expect(formatBattleValue(12.34)).toBe('12.3');
    expect(formatBattleValue(99.99)).toBe('100');
    expect(formatBattleValue(1234.5)).toBe('1,234');
    // JS 的 Math.round 对 .5 向 +∞ 取整：-3.25 → -3.2（这是既定取舍，不做 banker's rounding）
    expect(formatBattleValue(-3.25)).toBe('-3.2');
    expect(formatBattleValue(Number.NaN)).toBe('0');
    expect(formatBattleValue(Number.POSITIVE_INFINITY)).toBe('0');
    expect(formatBattleValue(undefined as never)).toBe('0');
  });

  it('damage：吸收与暴击附加文案', () => {
    const event: BattleEventDto = {
      kind: 'damage',
      fromId: '2',
      toId: '1',
      damageType: 'melee',
      skill: '',
      value: 12.34,
      crit: true,
      absorbed: 5,
    };
    expect(formatBattleEvent(event, nameOf).text).toBe('大史莱姆 → 艾尔 攻击 12.3（吸收 5） 暴击');
  });

  it('dodge / buff / heal 用 unitId 查表', () => {
    expect(formatBattleEvent({ kind: 'dodge', fromId: '2', toId: '1', skill: 'melee' }, nameOf).text).toBe(
      '艾尔 闪避了 melee',
    );
    expect(formatBattleEvent({ kind: 'buff', unitId: '2', buffKey: 'stun', name: '昏迷', on: true }, nameOf).text).toBe(
      '大史莱姆 获得 昏迷',
    );
    expect(formatBattleEvent({ kind: 'buff', unitId: '2', buffKey: 'stun', name: '昏迷', on: false }, nameOf).text).toBe(
      '大史莱姆 失去 昏迷',
    );
    expect(formatBattleEvent({ kind: 'heal', fromId: '1', toId: '1', skill: 'heal', value: 3 }, nameOf).text).toBe(
      '艾尔 治疗 艾尔 3',
    );
  });

  it('death 用事件自带的 name（不依赖查表）；exp 直接展示', () => {
    expect(formatBattleEvent({ kind: 'death', unitId: '99', name: '小史莱姆', camp: 'enemy' }, nameOf).text).toBe(
      '小史莱姆 阵亡',
    );
    expect(formatBattleEvent({ kind: 'exp', amount: 5, level: 3 }, nameOf).text).toBe('经验 +5 → Lv.3');
  });

  it('general 走文案化（不再原样透出 key:…）', () => {
    expect(formatBattleEvent({ kind: 'general', text: 'enemy.appear:小史莱姆' }, nameOf).text).toBe('遭遇 小史莱姆');
  });
});
