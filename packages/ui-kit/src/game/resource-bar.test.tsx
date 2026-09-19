/**
 * ResourceBar 渲染测试（无 jsdom）：五类资源标签 / 数值文案 / 分段护盾 / 边界夹取。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, renderToHtml } from '../testing/index.js';
import { RESOURCE_COLOR_TOKEN_NAMES, RESOURCE_LABELS, ResourceBar, type ResourceKind } from './resource-bar.js';

const KINDS: ResourceKind[] = ['hp', 'mp', 'rp', 'ep', 'combo'];

describe('ResourceBar 常量', () => {
  it('五类资源都有中文名与色 token 名', () => {
    for (const kind of KINDS) {
      expect(RESOURCE_LABELS[kind]).toBeTruthy();
      expect(RESOURCE_COLOR_TOKEN_NAMES[kind]).toBeTruthy();
    }
  });
});

describe('ResourceBar', () => {
  it('五类资源都能渲染，默认显示中文标签与数值', () => {
    for (const kind of KINDS) {
      const html = renderToHtml(<ResourceBar kind={kind} current={50} max={100} />);
      expect(html).toContain(`data-kind="${kind}"`);
      expect(htmlToText(html)).toContain(RESOURCE_LABELS[kind]);
      expect(htmlToText(html)).toContain('50/100');
    }
  });

  it('千分位数值与自定义 label', () => {
    const html = renderToHtml(<ResourceBar kind="hp" current={12345} max={99999} label="生命值" />);
    expect(htmlToText(html)).toContain('生命值');
    expect(htmlToText(html)).toContain('12,345/99,999');
  });

  it('护盾作为第二段显示（+N）', () => {
    const html = renderToHtml(<ResourceBar kind="hp" current={100} max={200} shield={30} />);
    expect(htmlToText(html)).toContain('(+30)');
  });

  it('护盾为 0 或不传时不显示第二段', () => {
    expect(htmlToText(renderToHtml(<ResourceBar kind="hp" current={100} max={200} shield={0} />))).not.toContain('+');
    expect(htmlToText(renderToHtml(<ResourceBar kind="hp" current={100} max={200} />))).not.toContain('+');
  });

  it('showPercent 时百分比被夹取到 0..100', () => {
    expect(htmlToText(renderToHtml(<ResourceBar kind="hp" current={500} max={100} showPercent />))).toContain('100%');
    expect(htmlToText(renderToHtml(<ResourceBar kind="mp" current={-50} max={100} showPercent />))).toContain('0%');
  });

  it('max <= 0 时百分比 0（不除零，不出 NaN）', () => {
    const html = renderToHtml(<ResourceBar kind="hp" current={10} max={0} showPercent />);
    expect(htmlToText(html)).toContain('0%');
    expect(htmlToText(html)).not.toContain('NaN');
  });

  it('NaN / Infinity / undefined 输入不产生 NaN 文案', () => {
    const html = renderToHtml(
      <ResourceBar
        kind="hp"
        current={Number.NaN}
        max={Number.POSITIVE_INFINITY}
        shield={undefined as unknown as number}
        showPercent
      />,
    );
    expect(htmlToText(html)).not.toContain('NaN');
    expect(htmlToText(html)).not.toContain('Infinity');
  });

  it('showValues=false 与自定义 suffix', () => {
    const html = renderToHtml(
      <ResourceBar kind="hp" current={1} max={2} showValues={false} suffix={<span>尾注</span>} />,
    );
    expect(htmlToText(html)).not.toContain('1/2');
    expect(htmlToText(html)).toContain('尾注');
  });
});
