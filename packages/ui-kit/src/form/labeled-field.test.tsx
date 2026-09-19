/** form/LabeledField 渲染测试：必填标记 / 错误优先 / 纵向布局 / 禁用态。 */
import { describe, expect, it } from 'vitest';
import { htmlToText, renderToHtml } from '../testing/index.js';
import { LabeledField } from './labeled-field.js';

describe('LabeledField', () => {
  it('标签与控件一起渲染，label 与控件通过 htmlFor 关联', () => {
    const html = renderToHtml(
      <LabeledField label="数量" htmlFor="qty">
        <input id="qty" />
      </LabeledField>,
    );
    expect(htmlToText(html)).toContain('数量');
    expect(html).toContain('for="qty"');
    expect(html).toContain('id="qty"');
  });

  it('required 输出星号与 aria-required', () => {
    const html = renderToHtml(
      <LabeledField label="数量" required>
        <input />
      </LabeledField>,
    );
    expect(html).toContain('aria-required="true"');
    expect(htmlToText(html)).toContain('*');
  });

  it('error 优先于 help，并打上 invalid 标记', () => {
    const html = renderToHtml(
      <LabeledField label="数量" help="提示" error="必须大于 0">
        <input />
      </LabeledField>,
    );
    expect(htmlToText(html)).toContain('必须大于 0');
    expect(htmlToText(html)).not.toContain('提示');
    expect(html).toContain('data-invalid="true"');
  });

  it('只有 help 时不标记 invalid', () => {
    const html = renderToHtml(
      <LabeledField label="数量" help="提示">
        <input />
      </LabeledField>,
    );
    expect(html).not.toContain('data-invalid');
    expect(html).toContain('labeled-field-message');
  });

  it('inline=false 使用纵向布局；disabled 时降透明度', () => {
    const vertical = renderToHtml(
      <LabeledField label="数量" inline={false}>
        <input />
      </LabeledField>,
    );
    // antd Flex 的 vertical 通过 CSS-in-JS class 表达，SSR 里没有内联 flex-direction
    expect(vertical).toContain('ant-flex-vertical');
    const disabled = renderToHtml(
      <LabeledField label="数量" disabled>
        <input />
      </LabeledField>,
    );
    expect(disabled).toContain('opacity:0.6');
  });

  it('extra 渲染在标签右侧', () => {
    const html = renderToHtml(
      <LabeledField label="数量" extra={<span>最大值</span>}>
        <input />
      </LabeledField>,
    );
    expect(htmlToText(html)).toContain('最大值');
  });
});
