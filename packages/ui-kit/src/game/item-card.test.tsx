/**
 * ItemCard 渲染测试（无 jsdom）。
 * 覆盖：空槽 / 名称与品质 / 词缀截断 / 数量角标 / 锁定 / 售价 / 紧凑 / 可交互属性。
 */
import { describe, expect, it } from 'vitest';
import type { AffixDto } from '@idle-dark/protocol';
import { htmlToText, makeSlot, renderToHtml } from '../../testing/index.js';
import { ItemCard } from './item-card.js';

const affixes: AffixDto[] = Array.from({ length: 5 }, (_, index) => ({
  key: `affix-${index}`,
  display: `词缀 ${index}`,
  isLegend: index === 4,
}));

describe('ItemCard', () => {
  it('slot=null 渲染空格占位（不可交互）', () => {
    const html = renderToHtml(<ItemCard slot={null} />);
    expect(html).toContain('item-card-empty');
    expect(htmlToText(html)).toBe('空');
    expect(html).not.toContain('role="button"');
  });

  it('空槽文案可定制', () => {
    expect(htmlToText(renderToHtml(<ItemCard slot={null} emptyText="待解锁" />))).toBe('待解锁');
  });

  it('名称 / 品质 tag / 等级 / 词缀', () => {
    const html = renderToHtml(<ItemCard slot={makeSlot()} />);
    expect(htmlToText(html)).toContain('夜刃短剑');
    expect(html).toContain('data-quality="2"');
    expect(html).toContain('精良');
    expect(html).toContain('Lv.12');
    expect(htmlToText(html)).toContain('攻击力 +12');
    expect(htmlToText(html)).toContain('暴击率 +3%');
  });

  it('词缀超长按 maxAffixes 截断并提示剩余条数', () => {
    const html = renderToHtml(<ItemCard slot={makeSlot({ affixes })} maxAffixes={2} />);
    expect(htmlToText(html)).toContain('词缀 0');
    expect(htmlToText(html)).toContain('词缀 1');
    expect(htmlToText(html)).not.toContain('词缀 2');
    expect(htmlToText(html)).toContain('还有 3 条');
  });

  it('maxAffixes=0 时不显示任何词缀但仍提示总数', () => {
    const html = renderToHtml(<ItemCard slot={makeSlot({ affixes })} maxAffixes={0} />);
    expect(htmlToText(html)).not.toContain('词缀 0');
    expect(htmlToText(html)).toContain('还有 5 条');
  });

  it('affixes 缺省（undefined）不崩', () => {
    const slot = makeSlot();
    const broken = { ...slot, affixes: undefined } as unknown as typeof slot;
    expect(htmlToText(renderToHtml(<ItemCard slot={broken} />))).toContain('夜刃短剑');
  });

  it('数量 >1 显示角标，=1 不显示', () => {
    expect(htmlToText(renderToHtml(<ItemCard slot={makeSlot({ count: 12 })} />))).toContain('×12');
    expect(htmlToText(renderToHtml(<ItemCard slot={makeSlot({ count: 1 })} />))).not.toContain('×');
  });

  it('锁定时显示锁定标记', () => {
    expect(renderToHtml(<ItemCard slot={makeSlot({ locked: true })} />)).toContain('已锁定');
    expect(renderToHtml(<ItemCard slot={makeSlot()} />)).not.toContain('已锁定');
  });

  it('showPrice 控制售价显示', () => {
    expect(htmlToText(renderToHtml(<ItemCard slot={makeSlot()} showPrice />))).toContain('320 金');
    expect(htmlToText(renderToHtml(<ItemCard slot={makeSlot()} />))).not.toContain('320 金');
  });

  it('compact 隐藏词缀与等级，但保留名称与品质', () => {
    const html = renderToHtml(<ItemCard slot={makeSlot()} compact />);
    expect(htmlToText(html)).toContain('夜刃短剑');
    expect(htmlToText(html)).not.toContain('攻击力 +12');
    expect(htmlToText(html)).not.toContain('Lv.12');
    expect(html).not.toContain('rarity-tag');
  });

  it('有 onClick 时输出可聚焦按钮语义（键盘可达）', () => {
    const html = renderToHtml(<ItemCard slot={makeSlot()} onClick={() => undefined} />);
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });

  it('disabled 时不可交互且标记 aria-disabled', () => {
    const html = renderToHtml(<ItemCard slot={makeSlot()} disabled onClick={() => undefined} />);
    expect(html).not.toContain('role="button"');
    expect(html).toContain('aria-disabled="true"');
  });

  it('selected 时输出 aria-pressed', () => {
    const html = renderToHtml(<ItemCard slot={makeSlot()} selected onClick={() => undefined} />);
    expect(html).toContain('aria-pressed="true"');
  });
});
