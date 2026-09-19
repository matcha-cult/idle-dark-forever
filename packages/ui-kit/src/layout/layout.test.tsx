/**
 * layout 分组渲染测试（无 jsdom）：HudBar 数值/经验/倍速、SideNav 配置聚合与选中、
 * AppShell 桌面与移动形态、PageShell / SectionCard / Toolbar 结构。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, renderToHtml } from '../testing/index.js';
import { AppShell } from './app-shell.js';
import { HudBar } from './hud-bar.js';
import { PageShell } from './page-shell.js';
import { SectionCard } from './section-card.js';
import { buildSideNavMenuItems, SideNav, type SideNavItem } from './side-nav.js';
import { Toolbar } from './toolbar.js';

describe('HudBar', () => {
  it('金币 / 神力 / 等级千分位展示', () => {
    const html = renderToHtml(<HudBar gold={1234567} diamonds={88} level={42} />);
    expect(htmlToText(html)).toContain('金币');
    expect(htmlToText(html)).toContain('1,234,567');
    expect(htmlToText(html)).toContain('神力');
    expect(htmlToText(html)).toContain('88');
    expect(htmlToText(html)).toContain('42');
  });

  it('NaN / 负数资源不产生 NaN 文案', () => {
    const html = renderToHtml(<HudBar gold={Number.NaN} diamonds={-5} level={0} />);
    expect(htmlToText(html)).not.toContain('NaN');
    expect(htmlToText(html)).toContain('-5');
  });

  it('maxExp > 0 才显示经验条', () => {
    expect(renderToHtml(<HudBar gold={0} diamonds={0} level={1} exp={50} maxExp={100} />)).toContain('hud-exp');
    expect(renderToHtml(<HudBar gold={0} diamonds={0} level={1} exp={50} maxExp={0} />)).not.toContain('hud-exp');
    expect(renderToHtml(<HudBar gold={0} diamonds={0} level={1} />)).not.toContain('hud-exp');
  });

  it('倍速 > 1 才显示', () => {
    expect(htmlToText(renderToHtml(<HudBar gold={0} diamonds={0} level={1} speed={3.5} />))).toContain('×3.5');
    expect(renderToHtml(<HudBar gold={0} diamonds={0} level={1} speed={1} />)).not.toContain('hud-speed');
  });

  it('extra 与 onGoldClick 生效（点击区光标）', () => {
    const html = renderToHtml(
      <HudBar gold={1} diamonds={2} level={3} extra={<span>影魔森林</span>} onGoldClick={() => undefined} />,
    );
    expect(htmlToText(html)).toContain('影魔森林');
    expect(html).toContain('cursor:pointer');
  });
});

describe('buildSideNavMenuItems', () => {
  const flat: SideNavItem[] = [
    { key: 'battle', label: '战斗' },
    { key: 'bag', label: '包裹', disabled: true },
  ];

  it('无 group 时平铺', () => {
    expect(buildSideNavMenuItems(flat)).toEqual([
      { key: 'battle', label: '战斗', icon: undefined, disabled: undefined },
      { key: 'bag', label: '包裹', icon: undefined, disabled: true },
    ]);
  });

  it('连续同 group 聚成一个分组，切换 group 再开一个', () => {
    const items: SideNavItem[] = [
      { key: 'a', label: 'A', group: '成长' },
      { key: 'b', label: 'B', group: '成长' },
      { key: 'c', label: 'C', group: '世界' },
      { key: 'd', label: 'D' },
    ];
    const built = buildSideNavMenuItems(items);
    expect(built).toHaveLength(3);
    expect(built[0]).toMatchObject({ type: 'group', label: '成长' });
    expect(built[1]).toMatchObject({ type: 'group', label: '世界' });
    expect(built[2]).toMatchObject({ key: 'd' });
  });

  it('二级菜单递归转换', () => {
    const built = buildSideNavMenuItems([
      { key: 'p', label: 'P', children: [{ key: 'c1', label: 'C1' }] },
    ]);
    expect(built[0]).toMatchObject({ key: 'p', children: [{ key: 'c1', label: 'C1' }] });
  });

  it('空配置返回空数组', () => {
    expect(buildSideNavMenuItems([])).toEqual([]);
  });

  it('空的 children 视作无子菜单（不生成空子节点）', () => {
    expect(buildSideNavMenuItems([{ key: 'x', label: 'X', children: [] }])).toEqual([
      { key: 'x', label: 'X', icon: undefined, disabled: undefined },
    ]);
  });
});

describe('SideNav', () => {
  it('title / footer / 选中态', () => {
    const html = renderToHtml(
      <SideNav
        items={[
          { key: 'battle', label: '战斗' },
          { key: 'bag', label: '包裹' },
        ]}
        selectedKey="bag"
        onSelect={() => undefined}
        title={<span>永夜</span>}
        footer={<span>v0.1</span>}
      />,
    );
    expect(htmlToText(html)).toContain('永夜');
    expect(htmlToText(html)).toContain('v0.1');
    expect(html).toContain('ant-menu-item-selected');
    expect(html).toContain('aria-label="主导航"');
  });

  it('selectedKey 不在列表内时不选中任何项', () => {
    const html = renderToHtml(
      <SideNav items={[{ key: 'battle', label: '战斗' }]} selectedKey="missing" onSelect={() => undefined} />,
    );
    expect(html).not.toContain('ant-menu-item-selected');
  });

  it('空 items 不崩', () => {
    expect(renderToHtml(<SideNav items={[]} selectedKey="" onSelect={() => undefined} />)).toContain('side-nav-menu');
  });
});

describe('AppShell', () => {
  it('桌面形态渲染固定 Sider，不渲染菜单按钮', () => {
    const html = renderToHtml(
      <AppShell nav={<span>导航</span>} header={<span>角色</span>} hud={<span>HUD</span>} mobile={false}>
        <span>内容</span>
      </AppShell>,
    );
    expect(html).toContain('app-shell-sider');
    expect(html).not.toContain('app-shell-menu-button');
    expect(htmlToText(html)).toContain('导航');
    expect(htmlToText(html)).toContain('角色');
    expect(htmlToText(html)).toContain('HUD');
    expect(htmlToText(html)).toContain('内容');
  });

  it('移动形态不渲染 Sider，渲染菜单按钮（抽屉懒挂载）', () => {
    const html = renderToHtml(
      <AppShell nav={<span>导航</span>} mobile>
        <span>内容</span>
      </AppShell>,
    );
    expect(html).not.toContain('app-shell-sider');
    expect(html).toContain('app-shell-menu-button');
    expect(html).toContain('aria-label="打开导航"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('断点未知（无 matchMedia 的 SSR 首帧）时按桌面处理，避免闪动', () => {
    const html = renderToHtml(<AppShell nav={<span>导航</span>} />);
    expect(html).toContain('app-shell-sider');
  });
});

describe('PageShell / SectionCard / Toolbar', () => {
  it('PageShell 渲染标题 / 副标题 / 操作 / 页脚', () => {
    const html = renderToHtml(
      <PageShell title="背包" subtitle="48/120" extra={<span>整理</span>} footer={<span>页脚</span>}>
        <span>内容</span>
      </PageShell>,
    );
    expect(htmlToText(html)).toContain('背包');
    expect(htmlToText(html)).toContain('48/120');
    expect(htmlToText(html)).toContain('整理');
    expect(htmlToText(html)).toContain('页脚');
  });

  it('SectionCard 用 variant 而非 bordered，并支持 loading / 固定高度', () => {
    const html = renderToHtml(
      <SectionCard title="属性" extra={<span>详情</span>} bodyHeight={200} description="描述">
        <span>内容</span>
      </SectionCard>,
    );
    expect(html).toContain('ant-card');
    expect(html).toContain('height:200px');
    expect(htmlToText(html)).toContain('属性');
    expect(htmlToText(html)).toContain('描述');
  });

  it('SectionCard dense 切换内边距（v6 用 variant/styles.body，不用 bordered/bodyStyle）', () => {
    // variant 的边框由 CSS-in-JS hash 承担，SSR 里没有静态 class 可断言；
    // 因此这里断言**可观测**的 dense → padding 差异。
    expect(renderToHtml(<SectionCard>x</SectionCard>)).toContain('padding:12px');
    expect(renderToHtml(<SectionCard dense={false}>x</SectionCard>)).toContain('padding:16px');
    // borderless 变体只要求能正常渲染（不抛错）
    expect(renderToHtml(<SectionCard variant="borderless">x</SectionCard>)).toContain('ant-card');
  });

  it('Toolbar 左右两端 + sticky', () => {
    const html = renderToHtml(<Toolbar left={<span>筛选</span>} right={<span>操作</span>} sticky />);
    expect(htmlToText(html)).toContain('筛选');
    expect(htmlToText(html)).toContain('操作');
    expect(html).toContain('position:sticky');
  });
});
