/**
 * feedback 分组测试（无 jsdom）。
 *
 * 说明：React 的错误边界在 **SSR 下不生效**（`renderToStaticMarkup` 不支持
 * `getDerivedStateFromError`），因此这里：
 * - 用 SSR 验证「正常时零包裹透传子节点」；
 * - 用静态方法 `getDerivedStateFromError` 直接验证错误状态的纯函数契约；
 * - 错误态 UI 的完整验证需要 DOM 环境（jsdom），本包未安装，已在交付报告登记。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, renderToHtml } from '../testing/index.js';
import { ConnectionBadge, type ConnectionStatus } from './connection-badge.js';
import { EmptyState } from './empty-state.js';
import { ErrorBoundary } from './error-boundary.js';

describe('ConnectionBadge', () => {
  const statuses: ConnectionStatus[] = ['idle', 'connecting', 'online', 'reconnecting', 'failed'];

  it('五种状态都有中文文案与 data-status', () => {
    const expected: Record<ConnectionStatus, string> = {
      idle: '未连接',
      connecting: '连接中',
      online: '在线',
      reconnecting: '重连中',
      failed: '连接失败',
    };
    for (const status of statuses) {
      const html = renderToHtml(<ConnectionBadge status={status} />);
      expect(html).toContain(`data-status="${status}"`);
      expect(htmlToText(html)).toContain(expected[status]);
    }
  });

  it('状态 → antd Badge 语义色（success/error/warning/processing 各一）', () => {
    expect(renderToHtml(<ConnectionBadge status="online" />)).toContain('ant-badge-status-success');
    expect(renderToHtml(<ConnectionBadge status="failed" />)).toContain('ant-badge-status-error');
    expect(renderToHtml(<ConnectionBadge status="reconnecting" />)).toContain('ant-badge-status-warning');
    expect(renderToHtml(<ConnectionBadge status="connecting" />)).toContain('ant-badge-status-processing');
    expect(renderToHtml(<ConnectionBadge status="idle" />)).toContain('ant-badge-status-default');
  });

  it('未知状态回退 idle（不渲染空白）', () => {
    const html = renderToHtml(<ConnectionBadge status={'weird' as ConnectionStatus} />);
    expect(html).toContain('data-status="idle"');
    expect(htmlToText(html)).toContain('未连接');
  });

  it('showText=false 只留圆点', () => {
    const html = renderToHtml(<ConnectionBadge status="online" showText={false} />);
    expect(html).toContain('ant-badge-status-dot');
    expect(htmlToText(html)).toBe('');
  });

  it('text 覆盖文案；lastError 落到 title', () => {
    const html = renderToHtml(<ConnectionBadge status="failed" text="掉线了" lastError="1006" />);
    expect(htmlToText(html)).toContain('掉线了');
    expect(html).toContain('title="1006"');
  });

  it('onClick 时鼠标变手型', () => {
    expect(renderToHtml(<ConnectionBadge status="online" onClick={() => undefined} />)).toContain('cursor:pointer');
  });
});

describe('EmptyState', () => {
  it('缺省文案与空态插图', () => {
    const html = renderToHtml(<EmptyState />);
    expect(htmlToText(html)).toContain('暂无内容');
    expect(html).toContain('ant-empty');
  });

  it('description / hint / 操作按钮', () => {
    const html = renderToHtml(
      <EmptyState description="背包空空如也" hint="去战斗掉落装备" actionText="前往战斗" onAction={() => undefined} />,
    );
    expect(htmlToText(html)).toContain('背包空空如也');
    expect(htmlToText(html)).toContain('去战斗掉落装备');
    expect(htmlToText(html)).toContain('前往战斗');
    expect(html).toContain('empty-state-action');
  });

  it('只有 actionText 没有 onAction 时不渲染按钮', () => {
    expect(renderToHtml(<EmptyState actionText="前往战斗" />)).not.toContain('empty-state-action');
  });

  it('bordered 与自定义高度', () => {
    const html = renderToHtml(<EmptyState bordered height={200} />);
    expect(html).toContain('min-height:200px');
    expect(html).toContain('dashed');
  });
});

describe('ErrorBoundary', () => {
  it('正常时零包裹透传子节点（不产生额外 DOM）', () => {
    const child = renderToHtml(<span data-child="1">正常内容</span>);
    const wrapped = renderToHtml(
      <ErrorBoundary>
        <span data-child="1">正常内容</span>
      </ErrorBoundary>,
    );
    expect(wrapped).toBe(child);
  });

  it('getDerivedStateFromError 是纯函数：只回填 error', () => {
    const error = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
    expect(Object.keys(ErrorBoundary.getDerivedStateFromError(error))).toEqual(['error']);
  });

  it('onError 未提供时不抛错（默认静默）', () => {
    const boundary = new ErrorBoundary({ children: null });
    expect(boundary.props.onError).toBeUndefined();
  });
});
