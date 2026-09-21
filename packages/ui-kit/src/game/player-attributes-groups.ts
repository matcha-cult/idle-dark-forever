/**
 * 属性面板的**行表**（哪一行、什么名字、取哪个字段、怎么显示）。
 *
 * 单独成文件的两个理由：
 * 1. `hygiene.test.ts` 有「单文件 ≤200 行」硬门禁 —— 组件 + 行表会超；
 * 2. 行表是**纯数据**（原版 `PlayerPanel.js` 的 JSX 逐行翻译），改文案时不必读组件代码。
 *
 * 分组与顺序照抄原版：`primary` 是右上角三维，`left` / `right` 是下面两列。
 * 数值只做**展示格式化**（1 位小数 / 千分位），不做任何算术 ——
 * `…Pct` 已经是百分数本身（服务端 ×100 过了）。
 */
import type { PlayerAttributesDto } from '@idle-dark/protocol';
import type { StatItem } from '../data/stat-list.js';
import { formatAmount } from '../format/number.js';

/** 1 位小数（服务端已按该精度取整，这里只补零，不做数值变换）。 */
const fixed = (value: unknown): string => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : '0.0';
};

/** 百分数文案（值已经是百分数本身，**不要**再乘 100）。 */
const pct = (value: unknown): string => `${fixed(value)}%`;

/**
 * 属性分组（顺序与分组边界照抄原版 `PlayerPanel.js`）。
 *
 * `primary` = 右上角的三维；`left` / `right` = 下面两列的若干组。
 */
export function buildGroups(attr: PlayerAttributesDto): {
  primary: StatItem[];
  left: StatItem[][];
  right: StatItem[][];
} {
  return {
    primary: [
      { key: 'str', label: '力量', value: formatAmount(attr.str) },
      { key: 'dex', label: '敏捷', value: formatAmount(attr.dex) },
      { key: 'int', label: '智力', value: formatAmount(attr.int) },
    ],
    left: [
      [
        { key: 'atk', label: '攻击力', value: fixed(attr.atk) },
        { key: 'atkSpeed', label: '攻击速度', value: `${fixed(attr.atkSpeed)}次/秒` },
        { key: 'speedBonus', label: '速度加成', value: pct(attr.speedBonusPct) },
        { key: 'critRate', label: '暴击几率', value: pct(attr.critRatePct) },
        { key: 'critBonus', label: '暴击伤害', value: pct(attr.critBonusPct) },
        { key: 'dmgBonus', label: '法术伤害加成', value: pct(attr.dmgBonusPct) },
      ],
      [
        { key: 'hpFromKill', label: '击杀恢复生命', value: fixed(attr.hpFromKill) },
        { key: 'mpFromKill', label: '击杀恢复法力', value: fixed(attr.mpFromKill) },
        { key: 'expBonus', label: '经验加成', value: pct(attr.expBonusPct) },
        { key: 'skillExpBonus', label: '技能学习速度提升', value: pct(attr.skillExpBonusPct) },
        { key: 'magicFind', label: '装备品质提升', value: pct(attr.magicFindPct) },
        { key: 'goldFind', label: '掉落金币提升', value: pct(attr.goldFindPct) },
      ],
      [
        { key: 'dodgeRate', label: '闪避几率', value: pct(attr.dodgeRatePct) },
        { key: 'def', label: '护甲', value: formatAmount(attr.def) },
      ],
    ],
    right: [
      [
        { key: 'hpRecovery', label: '每5秒回复生命', value: fixed(attr.hpRecovery5s) },
        { key: 'mpRecovery', label: '每5秒回复法力', value: fixed(attr.mpRecovery5s) },
        { key: 'rpRecovery', label: '每5秒回复怒气', value: fixed(attr.rpRecovery5s) },
        { key: 'epRecovery', label: '每5秒回复能量', value: fixed(attr.epRecovery5s) },
        { key: 'rpRecHp', label: '怒气消耗回复生命', value: fixed(attr.rpRecHp) },
        { key: 'leech', label: '吸血', value: fixed(attr.leech) },
      ],
      [
        { key: 'fireResist', label: '火焰抗性', value: formatAmount(attr.fireResist) },
        { key: 'coldResist', label: '寒冷抗性', value: formatAmount(attr.coldResist) },
        { key: 'lightningResist', label: '闪电抗性', value: formatAmount(attr.lightningResist) },
        { key: 'chaosResist', label: '混沌抗性', value: formatAmount(attr.chaosResist) },
        { key: 'fireAbsorb', label: '火焰吸收', value: pct(attr.fireAbsorbPct) },
        { key: 'coldAbsorb', label: '寒冷吸收', value: pct(attr.coldAbsorbPct) },
        { key: 'lightningAbsorb', label: '闪电吸收', value: pct(attr.lightningAbsorbPct) },
        { key: 'chaosAbsorb', label: '混沌吸收', value: pct(attr.chaosAbsorbPct) },
        { key: 'meleeAbsorb', label: '物理吸收', value: pct(attr.meleeAbsorbPct) },
      ],
    ],
  };
}
