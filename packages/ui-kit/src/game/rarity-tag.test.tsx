/**
 * RarityTag 渲染测试（无 jsdom，走 `react-dom/server`）。
 * 覆盖：普通档不渲染 / showCommon 强制显示 / 稀有与传奇文案与 data 属性 /
 * 越界与非数字夹取 / 注入色板的实色底与对比字 / labels 覆盖 / 序号模式 / variant 透传。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, renderToHtml } from '../testing/index.js';
import { QUALITY_LABELS } from './quality.js';
import { RarityPaletteProvider } from './rarity-palette.js';
import { RarityTag } from './rarity-tag.js';

/** 测试用色板（真实色值在应用层 `web/src/theme/rarity-palette.ts`）。 */
const palette = {
  rare: { name: '#ffff77', chip: '#ffff77', chipText: '#3d3600' },
  legend: { name: '#ef6916', chip: '#ef6916', chipText: '#2b1000' },
};

/** 亮色主题：只有**名称文字**变深，徽标底色仍是设计色。 */
const lightPalette = {
  rare: { name: '#7a6c00', chip: '#ffff77', chipText: '#3d3600' },
  legend: { name: '#c25200', chip: '#ef6916', chipText: '#2b1000' },
};

describe('RarityTag', () => {
  it('普通档默认不渲染任何内容（非数字 / 负数也归普通档）', () => {
    expect(renderToHtml(<RarityTag quality={0} />)).toBe('');
    expect(renderToHtml(<RarityTag quality={Number.NaN} />)).toBe('');
    expect(renderToHtml(<RarityTag quality={-3} />)).toBe('');
  });

  it('showCommon 才渲染普通档', () => {
    const html = renderToHtml(<RarityTag quality={0} showCommon />);
    expect(htmlToText(html)).toBe('普通');
    expect(html).toContain('data-quality="0"');
  });

  it('稀有 / 传奇：文案与 data-quality 一一对应', () => {
    const rare = renderToHtml(<RarityTag quality={1} />);
    expect(htmlToText(rare)).toBe(QUALITY_LABELS[1]);
    expect(htmlToText(rare)).toBe('稀有');
    expect(rare).toContain('data-quality="1"');

    const legend = renderToHtml(<RarityTag quality={2} />);
    expect(htmlToText(legend)).toBe('传奇');
    expect(legend).toContain('data-quality="2"');
  });

  it('越界 / 小数夹取', () => {
    expect(renderToHtml(<RarityTag quality={99} />)).toContain('data-quality="2"');
    expect(htmlToText(renderToHtml(<RarityTag quality={99} />))).toBe('传奇');
    expect(renderToHtml(<RarityTag quality={2.9} />)).toContain('data-quality="2"');
    expect(renderToHtml(<RarityTag quality={Number.POSITIVE_INFINITY} />)).toContain('data-quality="2"');
  });

  it('注入色板后：底色用给定 hex，文字用对比色', () => {
    const rare = renderToHtml(
      <RarityPaletteProvider palette={palette}>
        <RarityTag quality={1} />
      </RarityPaletteProvider>,
    );
    expect(rare).toContain('background-color:#ffff77');
    expect(rare).toContain('color:#3d3600');

    const legend = renderToHtml(
      <RarityPaletteProvider palette={palette}>
        <RarityTag quality={2} />
      </RarityPaletteProvider>,
    );
    expect(legend).toContain('background-color:#ef6916');
    expect(legend).toContain('color:#2b1000');
  });

  it('未注入色板时回退 antd token（仍为实色块）', () => {
    expect(renderToHtml(<RarityTag quality={2} />)).toMatch(/background-color:#[0-9a-fA-F]{6}/);
  });

  it('亮色主题色板：徽标底色仍是设计色（不被名称文字的深色变体替换）', () => {
    const html = renderToHtml(
      <RarityPaletteProvider palette={lightPalette}>
        <RarityTag quality={1} />
      </RarityPaletteProvider>,
    );
    expect(html).toContain('background-color:#ffff77');
    expect(html).not.toContain('background-color:#7a6c00');
  });

  it('outlined 只上文字与描边色，不加实色底', () => {
    const html = renderToHtml(
      <RarityPaletteProvider palette={palette}>
        <RarityTag quality={1} variant="outlined" />
      </RarityPaletteProvider>,
    );
    expect(html).toContain('color:#ffff77');
    expect(html).not.toContain('background-color:#ffff77');
  });

  it('labels 覆盖，短数组缺位回退内置文案', () => {
    expect(htmlToText(renderToHtml(<RarityTag quality={1} labels={['白', '绿']} />))).toBe('绿');
    expect(htmlToText(renderToHtml(<RarityTag quality={2} labels={['白', '绿']} />))).toBe('传奇');
    expect(htmlToText(renderToHtml(<RarityTag quality={0} labels={['白', '绿']} showCommon />))).toBe('白');
  });

  it('showLabel=false 输出 Q 序号', () => {
    expect(htmlToText(renderToHtml(<RarityTag quality={2} showLabel={false} />))).toBe('Q3');
  });

  it('tooltip 落到 title 上，variant 透传', () => {
    const html = renderToHtml(<RarityTag quality={2} tooltip="品质：传奇" variant="outlined" />);
    expect(html).toContain('title="品质：传奇"');
    expect(html).toContain('ant-tag-outlined');
  });
});
