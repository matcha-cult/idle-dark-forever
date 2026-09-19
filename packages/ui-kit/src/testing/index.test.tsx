/**
 * 渲染管线冒烟测试：确认 antd 在本包测试环境（node + react-dom/server，无 jsdom）
 * 可渲染。放在这里是为了让「环境本身坏了」和「组件写错了」两类失败可区分。
 */
import { Tag } from 'antd';
import { describe, expect, it } from 'vitest';
import { htmlToText, renderToHtml } from './index.js';

describe('testing 工具链', () => {
  it('renderToHtml 能渲染 antd 组件', () => {
    const html = renderToHtml(<Tag color="gold">传说</Tag>);
    expect(html).toContain('ant-tag');
    expect(htmlToText(html)).toBe('传说');
  });

  it('renderToHtml 输出 antd 的 hash class（说明 CSS-in-JS 已接管）', () => {
    expect(renderToHtml(<Tag>普通</Tag>)).toContain('css-');
  });
});
