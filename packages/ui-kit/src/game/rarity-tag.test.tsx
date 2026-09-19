/**
 * RarityTag 渲染测试（无 jsdom，走 `react-dom/server`）。
 * 覆盖：7 档文案 / data 属性 / 越界与非数字夹取 / labels 覆盖 / 序号模式。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, renderToHtml } from '../testing/index.js';
import { QUALITY_LABELS } from './quality.js';
import { RarityTag } from './rarity-tag.js';

describe('RarityTag', () => {
  it('7 档品质：文案与 data-quality 一一对应', () => {
    for (let quality = 0; quality < 7; quality += 1) {
      const html = renderToHtml(<RarityTag quality={quality} />);
      expect(htmlToText(html)).toBe(QUALITY_LABELS[quality]);
      expect(html).toContain(`data-quality="${quality}"`);
    }
  });

  it('越界 / 小数 / 非数字一律夹取', () => {
    expect(renderToHtml(<RarityTag quality={99} />)).toContain('data-quality="6"');
    expect(htmlToText(renderToHtml(<RarityTag quality={99} />))).toBe('神器');
    expect(renderToHtml(<RarityTag quality={-3} />)).toContain('data-quality="0"');
    expect(renderToHtml(<RarityTag quality={2.9} />)).toContain('data-quality="2"');
    expect(renderToHtml(<RarityTag quality={Number.NaN} />)).toContain('data-quality="0"');
    expect(renderToHtml(<RarityTag quality={Number.POSITIVE_INFINITY} />)).toContain('data-quality="6"');
  });

  it('labels 覆盖，短数组缺位回退内置文案', () => {
    expect(htmlToText(renderToHtml(<RarityTag quality={0} labels={['白', '绿']} />))).toBe('白');
    expect(htmlToText(renderToHtml(<RarityTag quality={1} labels={['白', '绿']} />))).toBe('绿');
    expect(htmlToText(renderToHtml(<RarityTag quality={4} labels={['白', '绿']} />))).toBe('传说');
  });

  it('showLabel=false 输出 Q 序号', () => {
    expect(htmlToText(renderToHtml(<RarityTag quality={6} showLabel={false} />))).toBe('Q7');
  });

  it('tooltip 落到 title 上，variant 透传', () => {
    const html = renderToHtml(<RarityTag quality={4} tooltip="品质：传说" variant="outlined" />);
    expect(html).toContain('title="品质：传说"');
    expect(html).toContain('ant-tag-outlined');
  });
});
