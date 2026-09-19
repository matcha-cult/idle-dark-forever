/**
 * QuantityInput / CostList / ActionBar 渲染测试（无 jsdom）。
 * 交互（点击）本身需要 DOM 事件环境，本包未安装 jsdom，因此这里断言的是
 * 「按钮存在性、disabled 状态、文案与数据属性」——即事件绑定的前置契约。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, renderToHtml } from '../testing/index.js';

/**
 * antd 默认开启 `autoInsertSpaceInButton`：两个汉字的按钮文案会被插空格（「攻击」→「攻 击」）。
 * 这是 antd 的中文排版约定，不是 bug；断言时去掉所有空白再比。
 */
function textNoSpace(html: string): string {
  return htmlToText(html).replace(/\s+/g, '');
}
import { ActionBar } from './action-bar.js';
import { CostList } from './cost-list.js';
import { QuantityInput } from './quantity-input.js';

describe('QuantityInput', () => {
  it('三个快捷按钮与数字输入框', () => {
    const html = renderToHtml(<QuantityInput value={5} max={100} onChange={() => undefined} />);
    expect(html).toContain('quantity-input-number');
    expect(htmlToText(html)).toContain('1');
    expect(htmlToText(html)).toContain('10');
    expect(htmlToText(html)).toContain('最大(100)');
  });

  it('stepLabel 覆盖中间按钮文案', () => {
    const html = renderToHtml(
      <QuantityInput value={5} max={100} step={20} stepLabel="一组" onChange={() => undefined} />,
    );
    expect(textNoSpace(html)).toContain('一组');
  });

  it('max=0 时全部快捷按钮禁用', () => {
    const html = renderToHtml(<QuantityInput value={0} max={0} onChange={() => undefined} />);
    expect(html.match(/disabled/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(htmlToText(html)).toContain('最大(0)');
  });

  it('max 非法（NaN / 负数）时按 0 处理，不产生 NaN 文案', () => {
    const nan = renderToHtml(<QuantityInput value={1} max={Number.NaN} onChange={() => undefined} />);
    expect(htmlToText(nan)).not.toContain('NaN');
    const negative = renderToHtml(<QuantityInput value={1} max={-5} onChange={() => undefined} />);
    expect(htmlToText(negative)).toContain('最大(0)');
  });

  it('value 已等于 max 时「最大」按钮禁用', () => {
    const html = renderToHtml(<QuantityInput value={100} max={100} onChange={() => undefined} />);
    expect(html).toMatch(/data-testid="quantity-input-max"[^>]*disabled|disabled[^>]*data-testid="quantity-input-max"/);
  });

  it('disabled 透传', () => {
    const html = renderToHtml(<QuantityInput value={1} max={10} disabled onChange={() => undefined} />);
    expect(html.match(/disabled/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});

describe('CostList', () => {
  it('无费用时显示「免费」', () => {
    expect(htmlToText(renderToHtml(<CostList costs={{}} />))).toBe('免费');
    expect(htmlToText(renderToHtml(<CostList costs={{ gold: 0, diamonds: 0, materials: [] }} />))).toBe('免费');
  });

  it('金币 / 神力 / 材料三类都渲染', () => {
    const html = renderToHtml(
      <CostList
        costs={{ gold: 100, diamonds: 5, materials: [{ key: 'ore', count: 3 }] }}
        materialNames={{ ore: '玄铁矿' }}
      />,
    );
    expect(htmlToText(html)).toContain('金币 100');
    expect(htmlToText(html)).toContain('神力 5');
    expect(htmlToText(html)).toContain('玄铁矿 3');
  });

  it('未提供 owned 时不做不足判定（不误报红）', () => {
    const html = renderToHtml(<CostList costs={{ gold: 999999 }} />);
    expect(html).not.toContain('data-insufficient');
  });

  it('持有量不足时打上 data-insufficient 标记', () => {
    const html = renderToHtml(<CostList costs={{ gold: 100 }} owned={{ gold: 40 }} />);
    expect(html).toContain('data-insufficient="true"');
    expect(htmlToText(html)).toContain('金币 100/40');
  });

  it('持有量充足时不标记', () => {
    const html = renderToHtml(<CostList costs={{ gold: 100 }} owned={{ gold: 100 }} />);
    expect(html).not.toContain('data-insufficient');
  });

  it('材料不足同样标记（含 owned.materials 缺失该 key → 视为 0）', () => {
    const html = renderToHtml(
      <CostList costs={{ materials: [{ key: 'ore', count: 3 }] }} owned={{ materials: { ore: 1 } }} />,
    );
    expect(html).toContain('data-insufficient="true"');
    const missing = renderToHtml(
      <CostList costs={{ materials: [{ key: 'ore', count: 3 }] }} owned={{ materials: {} }} />,
    );
    expect(missing).toContain('data-insufficient="true"');
  });

  it('材料名缺失时回退显示 key', () => {
    const html = renderToHtml(<CostList costs={{ materials: [{ key: 'unknown.key', count: 1 }] }} />);
    expect(htmlToText(html)).toContain('unknown.key 1');
  });

  it('vertical 布局可切换（不崩且保留内容）', () => {
    const html = renderToHtml(<CostList costs={{ gold: 1 }} vertical />);
    expect(htmlToText(html)).toContain('金币 1');
  });
});

describe('ActionBar', () => {
  it('按配置渲染按钮与 data-testid', () => {
    const html = renderToHtml(
      <ActionBar
        actions={[
          { key: 'attack', label: '攻击', type: 'primary' },
          { key: 'flee', label: '逃跑', danger: true, tooltip: '退出战斗', hint: 'ESC' },
        ]}
      />,
    );
    expect(html).toContain('data-testid="action-attack"');
    expect(html).toContain('data-testid="action-flee"');
    expect(textNoSpace(html)).toContain('攻击');
    expect(htmlToText(html)).toContain('ESC');
    // 注意：Tooltip 的内容只在悬浮时进 portal，SSR 输出里没有 `title=...`，
    // 因此这里只断言按钮本体；Tooltip 行为需要 DOM 环境验证。
    expect(html).toContain('ant-btn-dangerous');
  });

  it('空行动列表不崩', () => {
    const html = renderToHtml(<ActionBar actions={[]} />);
    expect(html).toContain('action-bar');
  });

  it('disabled 与 loading 都禁用按钮', () => {
    const html = renderToHtml(
      <ActionBar
        actions={[
          { key: 'a', label: 'A', disabled: true },
          { key: 'b', label: 'B', loading: true },
        ]}
      />,
    );
    expect(html.match(/disabled/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('整条 disabled 覆盖单个按钮', () => {
    const html = renderToHtml(<ActionBar actions={[{ key: 'a', label: 'A' }]} disabled />);
    expect(html).toContain('disabled');
  });

  it('children 渲染在按钮之后', () => {
    const html = renderToHtml(<ActionBar actions={[]}>额外内容</ActionBar>);
    expect(htmlToText(html)).toContain('额外内容');
  });
});
