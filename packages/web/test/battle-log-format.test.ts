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
  formatGeneralText,
  formatLogValue,
} from '../src/pages/game/panels/BattlePanel.js';

/** 模拟 `world.nameOf`：只认识注册表里的 id，其余回落原始 id。 */
function nameOfFrom(registry: Record<string, string>): (id: string) => string {
  return (id) => registry[id] ?? id;
}

describe('formatGeneralText（文案对齐原版 renderMessage.js）', () => {
  it('map.enter → 「来到了X。」', () => {
    expect(formatGeneralText('map.enter:world.2:迷雾林间')).toBe('来到了迷雾林间。');
    expect(formatGeneralText('map.enter:world.9:猛兽:巢穴')).toBe('来到了猛兽:巢穴。');
    expect(formatGeneralText('map.enter:world.2')).toBe('来到了新的地图。');
  });

  it('enemy.appear → 「遭遇了一只X。」', () => {
    expect(formatGeneralText('enemy.appear:大史莱姆')).toBe('遭遇了一只大史莱姆。');
    expect(formatGeneralText('enemy.appear:')).toBe('遭遇了敌人。');
    expect(formatGeneralText('enemy.appear')).toBe('遭遇了敌人。');
  });

  it('player.death → 「X陷入了昏迷，将在N秒后恢复。」（秒数取整，同原版 Math.round）', () => {
    expect(formatGeneralText('player.death:艾尔:60')).toBe('艾尔陷入了昏迷，将在60秒后恢复。');
    expect(formatGeneralText('player.death:艾尔:60.5')).toBe('艾尔陷入了昏迷，将在61秒后恢复。');
    expect(formatGeneralText('player.death:艾尔')).toBe('艾尔陷入了昏迷。');
    expect(formatGeneralText('player.death::60')).toBe('你陷入了昏迷，将在60秒后恢复。');
  });

  it('world.unitCap → 明确提示（原版无此文案，本仓 I2 硬顶新增，不许静默）', () => {
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

describe('formatLogValue：日志数值一律取整（同原版 Math.round）', () => {
  it('四舍五入，非有限值回落 0', () => {
    expect(formatLogValue(0)).toBe('0');
    expect(formatLogValue(0.4)).toBe('0'); // 原版就是显示 0（引擎仍扣 0.4 血）
    expect(formatLogValue(0.5)).toBe('1');
    expect(formatLogValue(1.5)).toBe('2');
    expect(formatLogValue(26.7)).toBe('27');
    expect(formatLogValue(-3.4)).toBe('-3');
    expect(formatLogValue(Number.NaN)).toBe('0');
    expect(formatLogValue(Number.POSITIVE_INFINITY)).toBe('0');
    expect(formatLogValue(undefined as never)).toBe('0');
  });
});

describe('formatBattleEvent：文案逐句对齐原版', () => {
  const registry = { '1': '艾尔', '2': '大史莱姆' };
  const nameOf = nameOfFrom(registry);

  it('damage（有来源）：{from}的{技能}对{to}造成了{N}点{类型}伤害。', () => {
    const event: BattleEventDto = {
      kind: 'damage',
      fromId: '2',
      toId: '1',
      damageType: 'melee',
      skill: 'melee',
      skillName: '攻击',
      value: 1,
      crit: false,
      absorbed: 0,
    };
    expect(formatBattleEvent(event, nameOf).text).toBe('大史莱姆的攻击对艾尔造成了1点物理伤害。');
  });

  it('damage：暴击前缀、吸收后缀、元素类型与小数取整', () => {
    const event: BattleEventDto = {
      kind: 'damage',
      fromId: '2',
      toId: '1',
      damageType: 'fire',
      skill: 'thumpHead',
      skillName: '重击·击颅',
      value: 26.7,
      crit: true,
      absorbed: 5.4,
    };
    expect(formatBattleEvent(event, nameOf).text).toBe(
      '暴击！大史莱姆的重击·击颅对艾尔造成了27点火焰伤害。(5点已吸收)',
    );
  });

  it('damage（无来源）：{to}受到了{N}点{类型}伤害。', () => {
    const event: BattleEventDto = {
      kind: 'damage',
      fromId: '',
      toId: '1',
      damageType: 'chaos',
      skill: 'x',
      skillName: '混沌',
      value: 3.2,
      crit: false,
      absorbed: 0,
    };
    expect(formatBattleEvent(event, nameOf).text).toBe('艾尔受到了3点混沌伤害。');
  });

  it('heal：{from}的{技能}为{to}回复了{N}点生命。', () => {
    const event: BattleEventDto = { kind: 'heal', fromId: '1', toId: '1', skill: 'heal', skillName: '治疗术', value: 3.6 };
    expect(formatBattleEvent(event, nameOf).text).toBe('艾尔的治疗术为艾尔回复了4点生命。');
  });

  it('dodge：有技能点名技能；无技能退化为「造成的伤害被躲闪了」', () => {
    expect(
      formatBattleEvent({ kind: 'dodge', fromId: '2', toId: '1', skill: 'meleeForRage', skillName: '怒击' }, nameOf).text,
    ).toBe('大史莱姆的怒击被艾尔躲闪了。');
    expect(formatBattleEvent({ kind: 'dodge', fromId: '2', toId: '1', skill: '', skillName: undefined }, nameOf).text).toBe(
      '大史莱姆造成的伤害被艾尔躲闪了。',
    );
  });

  it('death / buff：原版措辞', () => {
    expect(formatBattleEvent({ kind: 'death', unitId: '99', name: '小史莱姆', camp: 'enemy' }, nameOf).text).toBe(
      '小史莱姆死亡了。',
    );
    expect(
      formatBattleEvent({ kind: 'buff', unitId: '2', buffKey: 'stun', name: '昏迷', on: true }, nameOf).text,
    ).toBe('大史莱姆受到了昏迷效果的影响。');
    expect(
      formatBattleEvent({ kind: 'buff', unitId: '2', buffKey: 'stun', name: '昏迷', on: false }, nameOf).text,
    ).toBe('大史莱姆的昏迷效果消失了。');
  });

  it('exp：{who}获得了{N}点经验。（whoId 缺失回落「你」）', () => {
    expect(formatBattleEvent({ kind: 'exp', amount: 180.4, level: 2, whoId: '1' }, nameOf).text).toBe(
      '艾尔获得了180点经验。',
    );
    expect(formatBattleEvent({ kind: 'exp', amount: 5, level: 2 }, nameOf).text).toBe('你获得了5点经验。');
  });

  it('技能名缺失时回落数据表键（缺失可见，不静默变空）', () => {
    expect(
      formatBattleEvent(
        { kind: 'damage', fromId: '2', toId: '1', damageType: 'melee', skill: 'thumpHead', value: 5, crit: false, absorbed: 0 },
        nameOf,
      ).text,
    ).toBe('大史莱姆的thumpHead对艾尔造成了5点物理伤害。');
  });

  it('general 走文案化', () => {
    expect(formatBattleEvent({ kind: 'general', text: 'enemy.appear:小史莱姆' }, nameOf).text).toBe(
      '遭遇了一只小史莱姆。',
    );
  });

  it('历史单位仍可解析（回归：注册表而非当前单位表）', () => {
    const historical = formatBattleEvent(
      { kind: 'damage', fromId: '99', toId: '1', damageType: 'melee', skill: 'melee', skillName: '攻击', value: 1, crit: false, absorbed: 0 },
      nameOf,
    );
    expect(historical.text).toBe('99的攻击对艾尔造成了1点物理伤害。');
  });
});
