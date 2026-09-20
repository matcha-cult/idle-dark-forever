/**
 * UnitCard 渲染测试（无 jsdom）：名字/等级/品质、血量与法力条、施法条、buff 行、阵亡态。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, makeUnit, renderToHtml } from '../testing/index.js';
import { UnitCard } from './unit-card.js';

describe('UnitCard', () => {
  it('基础信息：名字 / 等级 / 品质 / 血条', () => {
    const html = renderToHtml(<UnitCard unit={makeUnit()} />);
    expect(htmlToText(html)).toContain('无名剑士');
    expect(htmlToText(html)).toContain('Lv.12');
    expect(htmlToText(html)).toContain('传奇');
    expect(html).toContain('data-unit-id');
    expect(html).toContain('resource-bar-hp');
    expect(htmlToText(html)).toContain('800/1,000');
  });

  it('maxMp=0 时不渲染法力条（showMana 无效）', () => {
    const html = renderToHtml(<UnitCard unit={makeUnit({ maxMp: 0, mp: 0 })} showMana />);
    expect(html).not.toContain('resource-bar-mp');
  });

  it('showMana=false 时隐藏法力条，但怒气条仍显示', () => {
    const html = renderToHtml(<UnitCard unit={makeUnit()} showMana={false} />);
    expect(html).not.toContain('resource-bar-mp');
    expect(html).toContain('resource-bar-rp');
  });

  it('castingProgress 非 null 时渲染施法条，为 null 时不渲染', () => {
    const casting = renderToHtml(<UnitCard unit={makeUnit({ castingProgress: 0.5 })} />);
    expect(htmlToText(casting)).toContain('施法');
    const idle = renderToHtml(<UnitCard unit={makeUnit({ castingProgress: null })} />);
    expect(htmlToText(idle)).not.toContain('施法');
  });

  it('buff 行按 maxBuffs 截断并显示剩余数量', () => {
    const unit = makeUnit({
      buffs: [
        { key: 'a', name: '燃烧', stack: 2, remainMs: 5_000 },
        { key: 'b', name: '减速', stack: 1, remainMs: 3_000 },
        { key: 'c', name: '护盾', stack: 1, remainMs: 1_000 },
      ],
    });
    const html = renderToHtml(<UnitCard unit={unit} maxBuffs={2} />);
    expect(html).toContain('unit-card-buffs');
    expect(html.match(/data-testid="unit-buff"/g) ?? []).toHaveLength(2);
    expect(htmlToText(html)).toContain('+1');
  });

  it('maxBuffs=0 时只显示剩余数量', () => {
    const unit = makeUnit({ buffs: [{ key: 'a', name: '燃烧', stack: 1, remainMs: 1_000 }] });
    const html = renderToHtml(<UnitCard unit={unit} maxBuffs={0} />);
    expect(html.match(/data-testid="unit-buff"/g) ?? []).toHaveLength(0);
    expect(htmlToText(html)).toContain('+1');
  });

  it('无 buff 时不渲染 buff 行', () => {
    expect(renderToHtml(<UnitCard unit={makeUnit()} />)).not.toContain('unit-card-buffs');
  });

  it('阵亡：划名渲染 <del> 且不可点击', () => {
    const html = renderToHtml(<UnitCard unit={makeUnit()} dead onClick={() => undefined} />);
    expect(html).toContain('<del');
    expect(html).not.toContain('role="button"');
  });

  it('有 onClick 时输出按钮语义（可测性 / 可访问性）', () => {
    const html = renderToHtml(<UnitCard unit={makeUnit()} onClick={() => undefined} />);
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });

  it('敌方单位 camp 写进 data-camp', () => {
    const html = renderToHtml(<UnitCard unit={makeUnit({ camp: 'enemy', kind: 'enemy', name: '影魔' })} />);
    expect(html).toContain('data-camp="enemy"');
    expect(htmlToText(html)).toContain('影魔');
  });
});
