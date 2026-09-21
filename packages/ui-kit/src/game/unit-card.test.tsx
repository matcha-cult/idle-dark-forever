/**
 * UnitCard 渲染测试（无 jsdom）：名字/等级/**怪物稀有度**、血量与法力条、施法条、buff 行、阵亡态。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, makeUnit, renderToHtml } from '../testing/index.js';
import { UnitCard } from './unit-card.js';

describe('UnitCard', () => {
  it('基础信息：名字 / 等级 / 血条', () => {
    const html = renderToHtml(<UnitCard unit={makeUnit()} />);
    expect(htmlToText(html)).toContain('无名剑士');
    expect(htmlToText(html)).toContain('Lv.12');
    expect(html).toContain('data-unit-id');
    expect(html).toContain('resource-bar-hp');
    expect(htmlToText(html)).toContain('800/1,000');
  });

  it('**不**把 `quality`（敌人词缀条数）当品质渲染（W11 回归）', () => {
    // fixture 的 `quality` 是 2、且没有 `rarity`（玩家单位就是这样）。
    // 旧实现会在这里渲染出「传奇」—— 那是把词缀条数当成装备品质，
    // 正是用户截图里「传奇 + 精英」两个矛盾标签的来源。
    const html = renderToHtml(<UnitCard unit={makeUnit({ quality: 2 })} />);
    expect(html).not.toContain('unit-rarity');
    expect(htmlToText(html)).not.toContain('传奇');
  });

  it('有 `rarity` 时渲染档位徽标（普通档不贴标）', () => {
    expect(renderToHtml(<UnitCard unit={makeUnit({ rarity: 0 })} />)).not.toContain('unit-rarity');

    const rare = renderToHtml(<UnitCard unit={makeUnit({ rarity: 1 })} />);
    expect(rare).toContain('data-rarity="1"');
    expect(htmlToText(rare)).toContain('稀有');

    const elite = renderToHtml(<UnitCard unit={makeUnit({ rarity: 2 })} />);
    expect(elite).toContain('data-rarity="2"');
    expect(htmlToText(elite)).toContain('精英');

    const legend = renderToHtml(<UnitCard unit={makeUnit({ rarity: 3 })} />);
    expect(legend).toContain('data-rarity="3"');
    expect(htmlToText(legend)).toContain('传奇');
  });

  it('一只单位**最多只有一个**档位徽标（不会既传奇又精英）', () => {
    const html = renderToHtml(<UnitCard unit={makeUnit({ rarity: 3, quality: 2 })} />);
    expect(html.match(/data-testid="unit-rarity"/g) ?? []).toHaveLength(1);
    expect(htmlToText(html)).toContain('传奇');
    expect(htmlToText(html)).not.toContain('精英');
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
