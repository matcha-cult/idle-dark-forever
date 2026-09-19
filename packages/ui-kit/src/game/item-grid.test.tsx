/**
 * ItemGrid 渲染测试（无 jsdom）：固定列数 / 空格补齐 / 选中态 / header+footer。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, makeSlot, renderToHtml } from '../testing/index.js';
import { ItemGrid } from './item-grid.js';

describe('ItemGrid', () => {
  it('固定列数写进 data 属性并 clamp 到 1..24', () => {
    expect(renderToHtml(<ItemGrid slots={[]} columns={5} />)).toContain('data-columns="5"');
    expect(renderToHtml(<ItemGrid slots={[]} columns={0} />)).toContain('data-columns="1"');
    expect(renderToHtml(<ItemGrid slots={[]} columns={999} />)).toContain('data-columns="24"');
    expect(renderToHtml(<ItemGrid slots={[]} columns={Number.NaN} />)).toContain('data-columns="1"');
  });

  it('格数按 minSlots 补齐：1 件物品 + minSlots=4 → 1 真卡 + 3 空格', () => {
    const html = renderToHtml(<ItemGrid slots={[makeSlot()]} minSlots={4} />);
    expect(html.match(/data-testid="item-card"/g) ?? []).toHaveLength(1);
    expect(html.match(/data-testid="item-card-empty"/g) ?? []).toHaveLength(3);
  });

  it('槽位多于 minSlots 时用槽位数（不丢物品）', () => {
    const slots = Array.from({ length: 6 }, () => makeSlot());
    const html = renderToHtml(<ItemGrid slots={slots} minSlots={4} />);
    expect(html.match(/data-testid="item-card"/g) ?? []).toHaveLength(6);
  });

  it('showEmptyCells=false 时不补空格', () => {
    const html = renderToHtml(<ItemGrid slots={[makeSlot()]} minSlots={8} showEmptyCells={false} />);
    expect(html.match(/data-testid="item-card-empty"/g) ?? []).toHaveLength(0);
  });

  it('selectedId 命中时该卡被标记 selected', () => {
    const first = makeSlot({ id: 'a' });
    const second = makeSlot({ id: 'b' });
    const html = renderToHtml(
      <ItemGrid slots={[first, second]} minSlots={2} selectedId="b" onSelect={() => undefined} />,
    );
    expect(html.match(/aria-pressed="true"/g) ?? []).toHaveLength(1);
  });

  it('默认 footer 显示占用数量；自定义 footer 覆盖', () => {
    expect(htmlToText(renderToHtml(<ItemGrid slots={[makeSlot(), null]} minSlots={2} />))).toContain('占用 1/2');
    expect(
      htmlToText(renderToHtml(<ItemGrid slots={[]} minSlots={1} footer={<span>自定义脚注</span>} />)),
    ).toContain('自定义脚注');
  });

  it('header 与 renderCorner 生效', () => {
    const html = renderToHtml(
      <ItemGrid
        slots={[makeSlot()]}
        minSlots={1}
        header={<span>背包</span>}
        renderCorner={() => <span>钥匙</span>}
      />,
    );
    expect(htmlToText(html)).toContain('背包');
    expect(htmlToText(html)).toContain('钥匙');
  });

  it('空槽不渲染角标（renderCorner 不会被空槽调用）', () => {
    let calls = 0;
    renderToHtml(
      <ItemGrid
        slots={[null, null]}
        minSlots={2}
        renderCorner={() => {
          calls += 1;
          return null;
        }}
      />,
    );
    expect(calls).toBe(0);
  });
});
