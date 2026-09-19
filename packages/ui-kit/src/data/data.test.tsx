/**
 * data 分组渲染测试（无 jsdom）：StatList 列布局/高亮/空态，LogPanel 截断/空态/时间列。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, renderToHtml } from '../testing/index.js';
import { LogPanel, type LogEntry } from './log-panel.js';
import { StatList, type StatItem } from './stat-list.js';

const stats: StatItem[] = [
  { key: 'atk', label: '攻击力', value: 120 },
  { key: 'crit', label: '暴击率', value: '12%', hint: '含装备加成' },
];

describe('StatList', () => {
  it('label / value 成对渲染', () => {
    const html = htmlToText(renderToHtml(<StatList items={stats} />));
    expect(html).toContain('攻击力');
    expect(html).toContain('120');
    expect(html).toContain('暴击率');
    expect(html).toContain('12%');
  });

  it('空列表显示空态文案（可覆盖）', () => {
    expect(htmlToText(renderToHtml(<StatList items={[]} />))).toBe('暂无属性');
    expect(htmlToText(renderToHtml(<StatList items={[]} emptyText="无" />))).toBe('无');
  });

  it('窄屏策略：默认 auto-fill + minmax（不会把 label 竖排到 value 上方）', () => {
    const html = renderToHtml(<StatList items={stats} minColumnWidth={180} />);
    expect(html).toContain('repeat(auto-fill, minmax(180px, 1fr))');
  });

  it('columns 给定则用固定列数', () => {
    expect(renderToHtml(<StatList items={stats} columns={3} />)).toContain('repeat(3, minmax(0, 1fr))');
    expect(renderToHtml(<StatList items={stats} columns={0} />)).toContain('repeat(1, minmax(0, 1fr))');
  });

  it('highlightKeys 命中项用主色（与未命中项不同）', () => {
    const highlighted = renderToHtml(<StatList items={stats} highlightKeys={['atk']} />);
    const plain = renderToHtml(<StatList items={stats} />);
    expect(highlighted).not.toBe(plain);
    expect(highlighted).toContain('data-testid="stat-atk"');
  });

  it('hint 用 Tooltip 包裹（SSR 下不渲染 title，但结构不崩）', () => {
    expect(renderToHtml(<StatList items={stats} />)).toContain('data-testid="stat-crit"');
  });
});

const entries: LogEntry[] = [
  { id: '1', text: '战斗开始', time: '00:00', level: 'system' },
  { id: '2', text: '造成 120 点伤害', time: '00:01', level: 'damage' },
  { id: '3', text: '拾取 夜刃短剑', time: '00:02', level: 'loot' },
];

describe('LogPanel', () => {
  it('渲染日志文本与时间列', () => {
    const html = htmlToText(renderToHtml(<LogPanel entries={entries} />));
    expect(html).toContain('战斗开始');
    expect(html).toContain('造成 120 点伤害');
    expect(html).toContain('00:02');
  });

  it('只渲染最后 maxItems 条（截断而非虚拟滚动）', () => {
    const html = renderToHtml(<LogPanel entries={entries} maxItems={2} />);
    expect(html).not.toContain('data-testid="log-1"');
    expect(html).toContain('data-testid="log-2"');
    expect(html).toContain('data-testid="log-3"');
  });

  it('maxItems=0 时全部截掉但仍渲染容器', () => {
    const html = renderToHtml(<LogPanel entries={entries} maxItems={0} />);
    expect(html).toContain('log-panel-body');
    expect(html).not.toContain('log-1');
  });

  it('空日志显示空态文案（可覆盖）', () => {
    expect(htmlToText(renderToHtml(<LogPanel entries={[]} />))).toContain('暂无日志');
    expect(htmlToText(renderToHtml(<LogPanel entries={[]} emptyText="等待战斗" />))).toContain('等待战斗');
  });

  it('自定义高度与标题', () => {
    const html = renderToHtml(<LogPanel entries={entries} height={320} title={<span>战斗日志</span>} />);
    expect(html).toContain('height:320px');
    expect(htmlToText(html)).toContain('战斗日志');
  });

  it('无 time 的条目也能渲染', () => {
    expect(htmlToText(renderToHtml(<LogPanel entries={[{ id: 'x', text: '无时间' }]} />))).toContain('无时间');
  });
});
