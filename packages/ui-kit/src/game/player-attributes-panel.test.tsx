/**
 * PlayerAttributesPanel 渲染测试（无 jsdom）。
 *
 * 重点不是「组件能跑」，而是钉住三条容易悄悄漂移的约定：
 * 1. **前端不再乘 100**：`critRatePct: 16.7` 必须原样渲染成 `16.7%`，出现 `1670%` 就是又乘了一次；
 * 2. **缺字段走空态**（非玩家单位没有 `attributes`），不是渲染一堆 `NaN`；
 * 3. **与原版的刻意偏离**：没有「耐力」行（E1 删除），抗性行的名字是「混沌」不是「暗影」。
 */
import { describe, expect, it } from 'vitest';
import { htmlToText, makeAttributes, makeUnit, renderToHtml } from '../testing/index.js';
import { PlayerAttributesPanel } from './player-attributes-panel.js';

function text(overrides: Parameters<typeof makeAttributes>[0] = {}): string {
  return htmlToText(renderToHtml(<PlayerAttributesPanel unit={makeUnit({ attributes: makeAttributes(overrides) })} />));
}

describe('PlayerAttributesPanel', () => {
  it('表头：名字 / 等级 / 职业名 / 等级上限', () => {
    const html = htmlToText(renderToHtml(<PlayerAttributesPanel unit={makeUnit({ attributes: makeAttributes() })} />));
    expect(html).toContain('无名剑士');
    expect(html).toContain('等级12');
    expect(html).toContain('战士');
    expect(html).toContain('等级上限：60');
  });

  it('百分数字段**原样**渲染（前端不乘 100）', () => {
    const html = text({ critRatePct: 16.7, critBonusPct: 186.5, fireAbsorbPct: 28.7 });
    expect(html).toContain('16.7%');
    expect(html).toContain('186.5%');
    expect(html).toContain('28.7%');
    expect(html).not.toContain('1670');
    expect(html).not.toContain('18650');
  });

  it('负的属性值是合法值（每 5 秒回复怒气可以为负）', () => {
    expect(text({ rpRecovery5s: -5 })).toContain('-5.0');
  });

  it('1 位小数补零、整数走千分位（与原版 FixedField / 本仓 formatAmount 一致）', () => {
    const html = text({ atk: 221, atkSpeed: 0.5, def: 12345 });
    expect(html).toContain('221.0');
    expect(html).toContain('0.5次/秒');
    expect(html).toContain('12,345');
  });

  it('资源条按 max>0 出现（原版同样是有上限才画条）', () => {
    const all = renderToHtml(<PlayerAttributesPanel unit={makeUnit({ attributes: makeAttributes() })} />);
    expect(all).toContain('resource-bar-hp');
    expect(all).toContain('resource-bar-mp');
    expect(all).toContain('resource-bar-rp');
    expect(all).toContain('resource-bar-ep');

    const hpOnly = renderToHtml(
      <PlayerAttributesPanel
        unit={makeUnit({ attributes: makeAttributes(), mp: 0, maxMp: 0, rp: 0, maxRp: 0, ep: 0, maxEp: 0 })}
      />,
    );
    expect(hpOnly).toContain('resource-bar-hp');
    expect(hpOnly).not.toContain('resource-bar-mp');
    expect(hpOnly).not.toContain('resource-bar-rp');
    expect(hpOnly).not.toContain('resource-bar-ep');
  });

  it('经验行显示当前 / 上限', () => {
    const html = htmlToText(
      renderToHtml(<PlayerAttributesPanel unit={makeUnit({ attributes: makeAttributes(), exp: 3602, maxExp: 30720 })} />),
    );
    expect(html).toContain('3,602 / 30,720');
  });

  it('`attributes` 缺失 → 空态（不是 NaN，也不是抛错）', () => {
    const html = renderToHtml(<PlayerAttributesPanel unit={makeUnit({ attributes: undefined })} />);
    expect(htmlToText(html)).toContain('暂无属性');
    expect(html).not.toContain('NaN');
    const custom = renderToHtml(<PlayerAttributesPanel unit={makeUnit({ attributes: undefined })} emptyText="无" />);
    expect(htmlToText(custom)).toContain('无');
  });

  it('`attributes` 为 null（脏输入）也走空态，绝不抛错', () => {
    const html = renderToHtml(<PlayerAttributesPanel unit={makeUnit({ attributes: null as never })} />);
    expect(htmlToText(html)).toContain('暂无属性');
  });

  it('与原版的刻意偏离：没有「耐力」，且是「混沌抗性 / 混沌吸收」不是「暗影」', () => {
    const html = text();
    expect(html).not.toContain('耐力');
    expect(html).not.toContain('暗影');
    expect(html).toContain('混沌抗性');
    expect(html).toContain('混沌吸收');
  });

  it('原版的属性名逐条在位（防止改名丢行）', () => {
    const html = text();
    for (const label of [
      '力量',
      '敏捷',
      '智力',
      '攻击力',
      '攻击速度',
      '速度加成',
      '暴击几率',
      '暴击伤害',
      '法术伤害加成',
      '击杀恢复生命',
      '击杀恢复法力',
      '经验加成',
      '技能学习速度提升',
      '装备品质提升',
      '掉落金币提升',
      '闪避几率',
      '护甲',
      '每5秒回复生命',
      '每5秒回复法力',
      '每5秒回复怒气',
      '每5秒回复能量',
      '怒气消耗回复生命',
      '吸血',
      '火焰抗性',
      '寒冷抗性',
      '闪电抗性',
      '火焰吸收',
      '寒冷吸收',
      '闪电吸收',
      '物理吸收',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('极端值不产生 NaN / Infinity 文案（脏服务端数据也不炸面板）', () => {
    const html = renderToHtml(
      <PlayerAttributesPanel
        unit={makeUnit({
          attributes: makeAttributes({ atk: Number.NaN, critRatePct: Number.POSITIVE_INFINITY }),
          exp: Number.NaN,
          maxExp: Number.POSITIVE_INFINITY,
          hp: Number.NaN,
          maxHp: 0,
        })}
      />,
    );
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });
});
