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
  formatGeneralSegments,
  formatGeneralText,
  formatLogValue,
  type UnitLookup,
} from '../src/pages/game/panels/BattlePanel.js';

/**
 * 模拟 `world.nameOf` / `world.campOf`：只认识注册表里的 id，其余回落原始 id / 空阵营。
 * 阵营用于伤害数字的红蓝着色（对齐原版 `.campPlayer` / `.campOther`）。
 */
function lookupFrom(registry: Record<string, { name: string; camp: string }>): UnitLookup {
  return {
    nameOf: (id) => registry[id]?.name ?? id,
    campOf: (id) => registry[id]?.camp ?? '',
  };
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
  const registry = {
    '1': { name: '艾尔', camp: 'player' },
    '2': { name: '大史莱姆', camp: 'enemy' },
  };
  const lookup = lookupFrom(registry);
  /** 伤害数字的色调（红=玩家打出、蓝=其它）；找不到返回 undefined。 */
  const toneOfValue = (event: BattleEventDto): string | undefined =>
    formatBattleEvent(event, lookup).segments.find((segment) => segment.tone !== undefined)?.tone;

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
    expect(formatBattleEvent(event, lookup).text).toBe('大史莱姆的攻击对艾尔造成了1点物理伤害。');
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
    expect(formatBattleEvent(event, lookup).text).toBe(
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
    expect(formatBattleEvent(event, lookup).text).toBe('艾尔受到了3点混沌伤害。');
  });

  it('heal：{from}的{技能}为{to}回复了{N}点生命。', () => {
    const event: BattleEventDto = { kind: 'heal', fromId: '1', toId: '1', skill: 'heal', skillName: '治疗术', value: 3.6 };
    expect(formatBattleEvent(event, lookup).text).toBe('艾尔的治疗术为艾尔回复了4点生命。');
  });

  it('dodge：有技能点名技能；无技能退化为「造成的伤害被躲闪了」', () => {
    expect(
      formatBattleEvent({ kind: 'dodge', fromId: '2', toId: '1', skill: 'meleeForRage', skillName: '怒击' }, lookup).text,
    ).toBe('大史莱姆的怒击被艾尔躲闪了。');
    expect(formatBattleEvent({ kind: 'dodge', fromId: '2', toId: '1', skill: '', skillName: undefined }, lookup).text).toBe(
      '大史莱姆造成的伤害被艾尔躲闪了。',
    );
  });

  it('death / buff：原版措辞', () => {
    expect(formatBattleEvent({ kind: 'death', unitId: '99', name: '小史莱姆', camp: 'enemy' }, lookup).text).toBe(
      '小史莱姆死亡了。',
    );
    expect(
      formatBattleEvent({ kind: 'buff', unitId: '2', buffKey: 'stun', name: '昏迷', on: true }, lookup).text,
    ).toBe('大史莱姆受到了昏迷效果的影响。');
    expect(
      formatBattleEvent({ kind: 'buff', unitId: '2', buffKey: 'stun', name: '昏迷', on: false }, lookup).text,
    ).toBe('大史莱姆的昏迷效果消失了。');
  });

  it('exp：{who}获得了{N}点经验。（whoId 缺失回落「你」）', () => {
    expect(formatBattleEvent({ kind: 'exp', amount: 180.4, level: 2, whoId: '1' }, lookup).text).toBe(
      '艾尔获得了180点经验。',
    );
    expect(formatBattleEvent({ kind: 'exp', amount: 5, level: 2 }, lookup).text).toBe('你获得了5点经验。');
  });

  it('技能名缺失时回落数据表键（缺失可见，不静默变空）', () => {
    expect(
      formatBattleEvent(
        { kind: 'damage', fromId: '2', toId: '1', damageType: 'melee', skill: 'thumpHead', value: 5, crit: false, absorbed: 0 },
        lookup,
      ).text,
    ).toBe('大史莱姆的thumpHead对艾尔造成了5点物理伤害。');
  });

  it('general 走文案化', () => {
    expect(formatBattleEvent({ kind: 'general', text: 'enemy.appear:小史莱姆' }, lookup).text).toBe(
      '遭遇了一只小史莱姆。',
    );
  });

  it('历史单位仍可解析（回归：注册表而非当前单位表）', () => {
    const historical = formatBattleEvent(
      { kind: 'damage', fromId: '99', toId: '1', damageType: 'melee', skill: 'melee', skillName: '攻击', value: 1, crit: false, absorbed: 0 },
      lookup,
    );
    expect(historical.text).toBe('99的攻击对艾尔造成了1点物理伤害。');
  });
});

describe('日志着色（对齐原版 renderMessage.less）', () => {
  const lookup = lookupFrom({
    '1': { name: '艾尔', camp: 'player' },
    '2': { name: '强壮的鱼人战士', camp: 'enemy' },
  });
  const damage = (from: string, to: string): BattleEventDto => ({
    kind: 'damage',
    fromId: from,
    toId: to,
    damageType: 'melee',
    skill: 'meleeForRage',
    skillName: '怒击',
    value: 1221,
    crit: false,
    absorbed: 0,
  });
  const toneOf = (event: BattleEventDto): string | undefined =>
    formatBattleEvent(event, lookup).segments.find((segment) => segment.tone !== undefined)?.tone;

  it('玩家打出的伤害 → 红（`player`）；正文不着色', () => {
    const { segments, text } = formatBattleEvent(damage('1', '2'), lookup);
    expect(text).toBe('艾尔的怒击对强壮的鱼人战士造成了1221点物理伤害。');
    expect(toneOf(damage('1', '2'))).toBe('player');
    // 只有一个片段带色调，且它是伤害数字本身（不是整行）
    const toned = segments.filter((segment) => segment.tone !== undefined);
    expect(toned).toHaveLength(1);
    expect(toned[0]?.text).toBe('1221');
    expect(segments[0]?.tone).toBeUndefined();
  });

  it('怪物打出的伤害 → 蓝（`other`）', () => {
    const monsterAttack: BattleEventDto = {
      kind: 'damage',
      fromId: '2',
      toId: '1',
      damageType: 'melee',
      skill: 'melee',
      skillName: '攻击',
      value: 27,
      crit: false,
      absorbed: 46,
    };
    expect(formatBattleEvent(monsterAttack, lookup).text).toBe(
      '强壮的鱼人战士的攻击对艾尔造成了27点物理伤害。(46点已吸收)',
    );
    expect(toneOf(monsterAttack)).toBe('other');
  });

  it('无来源伤害（fromId 空）→ 蓝，且不点名攻击者', () => {
    const environmental: BattleEventDto = { ...damage('', '1'), value: 3 };
    expect(formatBattleEvent(environmental, lookup).text).toBe('艾尔受到了3点物理伤害。');
    expect(toneOf(environmental)).toBe('other');
  });

  it('阵营查不到（历史单位缺失）→ 按非玩家处理（蓝），不误判成红', () => {
    expect(toneOf(damage('404', '1'))).toBe('other');
  });

  it('暴击前缀加粗且不着色', () => {
    const { segments } = formatBattleEvent({ ...damage('1', '2'), crit: true }, lookup);
    expect(segments[0]).toEqual({ text: '暴击！', bold: true });
    expect(segments[0]?.tone).toBeUndefined();
  });

  it('治疗数字 → 绿（`heal`）', () => {
    const event: BattleEventDto = { kind: 'heal', fromId: '1', toId: '1', skill: 'heal', skillName: '治疗术', value: 3.6 };
    const segments = formatBattleEvent(event, lookup).segments;
    expect(segments.find((s) => s.tone !== undefined)).toEqual({ text: '4', tone: 'heal' });
  });

  it('经验数字 → accent；躲闪/死亡/Buff/进图/遭遇 不着色', () => {
    expect(
      formatBattleEvent({ kind: 'exp', amount: 180, level: 2, whoId: '1' }, lookup).segments.find(
        (s) => s.tone !== undefined,
      ),
    ).toEqual({ text: '180', tone: 'accent' });

    for (const event of [
      { kind: 'dodge', fromId: '2', toId: '1', skill: 'melee', skillName: '攻击' },
      { kind: 'death', unitId: '2', name: '鱼人战士', camp: 'enemy' },
      { kind: 'buff', unitId: '1', buffKey: 'x', name: '昏迷', on: true },
      { kind: 'general', text: 'enemy.appear:鱼人战士' },
    ] as BattleEventDto[]) {
      expect(formatBattleEvent(event, lookup).segments.every((s) => s.tone === undefined)).toBe(true);
    }
  });

  it('player.death 的复活秒数单独着色（`accent`）', () => {
    const segments = formatGeneralSegments('player.death:艾尔:60.5');
    expect(segments.map((s) => s.text).join('')).toBe('艾尔陷入了昏迷，将在61秒后恢复。');
    expect(segments.find((s) => s.tone !== undefined)).toEqual({ text: '61', tone: 'accent' });
  });
});
