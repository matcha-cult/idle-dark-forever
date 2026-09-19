/**
 * ⚠️ 由原版 `data/legends/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 词缀 / 传奇的 `generate(level)` 改为 `generate(level, rng)`，内部 `Math.random()` → `rng()`。
 */

import type { AttackLike, BuffStateLike, ComboLike, LegendEntry, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/legends/s1.js ──
const __legends_0 = ((): LegendEntry[] => {
/**
 * Created by tdzl2003 on 5/2/17.
 */

return  [
  {
    key: 'copperRing-1',
    type: 'copperRing',
    itemName: '金色门牙',
    itemDescription: '其实是铜，中央的牙洞正好套进一个手指。',
    minLevel: 35,
    display: effect => `火焰法术伤害+30%`,
    generate(level, rng) {
      return 0.3;
    },
    range(level) {
      return `30%`;
    },
    hooks: {
      willDamage(effect, value, to, damageType) {
        if (damageType === 'fire') {
          return value * (1 + effect);
        }
        return value;
      },
      summonerWillDamage(effect, value, from, to, damageType) {
        if (damageType === 'fire') {
          return value * (1 + effect);
        }
        return value;
      },
    },
  },
  {
    key: 'zombieHeart-1',
    type: 'zombieHeart',
    itemName: '少女之心',
    itemDescription: '柔软的少女僵尸心，非常适合放在鼠标垫上垫手腕。',
    minLevel: 35,
    display: effect => `献祭你的召唤生物时恢复40%召唤技能法力消耗`,
    generate(level, rng) {
      return 0.4;
    },
    range(level) {
      return `40%`;
    },
    hooks: {
      onSummonExploded(effect, unit) {
        let cost = unit.summonSkill.skillData.cost.mp ?? 0;
        if (typeof cost === 'function') {
          cost = cost(this);
        }
        this.mp += (effect * cost) || 0;
      }
    },
  },
  {
    key: 'mithrilRing-1',
    type: 'mithrilRing',
    itemName: '卡罗的订婚戒指',
    itemDescription: '打完这仗我就回老家结婚。',
    minLevel: 35,
    display: effect => `获得圣能时25%几率释放一次额外的破邪斩。`,
    generate(level, rng) {
      return 0.25;
    },
    range(level) {
      return `25%`;
    },
    hooks: {
      holyCombo(effect, count) {
        if (Math.random() < effect) {
          this.useExtraSkill('knight.whirlwind');
        }
        return count;
      },
    },
  },
  {
    key: 'ironRing-1',
    type: 'ironRing',
    itemName: '阿泰尔的誓言',
    itemDescription: '为了信条',
    minLevel: 35,
    display: effect => `能量恢复速度增加30%。`,
    generate(level, rng) {
      return 0.3;
    },
    range(level) {
      return `30%`;
    },
    hooks: {
      epRecoveryMul(effect, value) {
        return value * (1 + effect);
      },
    },
  },
  {
    key: 'mithrilStannumRing-1',
    type: 'mithrilStannumRing',
    itemName: '仇恨意志',
    itemDescription: '仇恨让我们忘记恐惧，尽情的……杀戮。',
    minLevel: 35,
    display: effect => `致死打击的冷却时间减少至3秒。`,
    generate(level, rng) {
      return 3000;
    },
    range(level) {
      return '3';
    },
    hooks: {
      mortalStrikeCoolDown(effect, value) {
        return effect;
      }
    },
  },
  {
    key: 'mithrilCopperBigSword-1',
    type: 'mithrilCopperBigSword',
    itemName: '无锋',
    itemDescription: '重剑……无锋。',
    minLevel: 35,
    display: effect => `使你的顺劈斩系列技能造成的伤害提升100%。`,
    generate(level, rng) {
      return 1;
    },
    range(level) {
      return '100%';
    },
    hooks: {
      cleaveDamageRate(effect, value) {
        return value * 2;
      }
    },
  },
  {
    key: 'mithrilStannumShortWand-1',
    type: 'mithrilStannumShortWand',
    itemName: '法力之源',
    itemDescription: '支持遥控，自带能量源，充一次电可以用好几个小时。',
    minLevel: 35,
    display: effect => `法力唤醒的冷却时间缩短到30秒`,
    generate(level, rng) {
      return 30000;
    },
    range(level) {
      return `30`;
    },
    hooks: {
      awakingCoolDown(effect, value) {
        return effect;
      }
    },
  },
  {
    key: 'goldNecklace-1',
    type: 'goldNecklace',
    itemName: '大哥的金项链',
    itemDescription: '你瞅啥？瞅你怎地？',
    minLevel: 35,
    display: effect => `成为目标时为你增加20点怒气`,
    generate(level, rng) {
      return 20;
    },
    range(level) {
      return `20`;
    },
    hooks: {
      becomeTarget(effect, value) {
        this.rp += 20;
      }
    },
  },
];

})();

// ── 原 data/legends/s2.js ──
const __legends_1 = ((): LegendEntry[] => {
/**
 * Created by tdzl2003 on 5/2/17.
 */

return  [
  {
    key: 'ornament-1',
    type: 'ornament',
    itemName: '沉思的鲱鱼干',
    itemDescription: '作为一条鱼干，人生的大部分就是找个地方挂着……',
    minLevel: 35,
    display: effect => `所有经验值增加50%`,
    generate(level, rng) {
      return 0.5;
    },
    range(level) {
      return `50%`;
    },
    hooks: {
      expMul(effect, value) {
        return value * 1.5;
      },
    },
  },
  {
    key: 'skirt-1',
    type: 'skirt',
    itemName: '爆款小短裙',
    itemDescription: '当季爆款小短裙，卖家秀看起来特别美。穿在你身上就……',
    minLevel: 5,
    display: effect => '使攻击者昏迷2秒',
    generate(level, rng) {
      return 3;
    },
    range(level) {
      return '3';
    },
    hooks: {
      attacked(effect, from) {
        from.stun(2, 'stunned');
        return from;
      },
    }
  },
  {
    key: 'leatherArmor-1',
    type: 'leatherArmor',
    itemName: '鱼皮甲',
    itemDescription: '滑溜溜的，表面全是黏液。',
    minLevel: 50,
    display: effect => '闪避几率 +30%',
    generate(level, rng) {
      return 0.3;
    },
    range(level) {
      return '30%';
    },
    hooks: {
      noDodgeRate(effect, value) {
        return value * 0.7;
      }
    },
  },
  {
    key: 'wand-1',
    type: 'wand',
    itemName: '皮鞭',
    itemDescription: '只缺蜡烛了。',
    minLevel: 35,
    display: effect => `召唤的生物减少30%初始血量，但在5秒内攻击速度增加100%`,
    generate(level, rng) {
      return 1;
    },
    range(level) {
      return `100%`;
    },
    hooks: {
      summonedUnit(effect, unit) {
        unit.hp -= unit.maxHp * 0.3;
        unit.addBuff('legend-wand-1', 5000);
        return unit;
      },
    },
  },
  {
    key: 'rattanArmor-2',
    type: 'rattanArmor',
    itemName: '布尔凯索的装甲',
    itemDescription: '北方高地野蛮人的遗物，穿上后让人忍不住呐喊。',
    minLevel: 70,
    display: effect => `你的战斗怒吼和命令怒吼可以同时生效`,
    generate(level, rng) {
      return 1;
    },
    range(level) {
      return `1`;
    },
    hooks: {
      multiShouts(effect, value) {
        return true;
      }
    },
  },
  {
    key: 'mithrilDress-2',
    type: 'mithrilPlastron',
    itemName: '白银之手装甲',
    itemDescription: '愿圣光与你同在。',
    minLevel: 70,
    display: effect => '使你的荣耀不再消耗圣能',
    generate(level, rng) {
      return 1;
    },
    range(level) {
      return `1`;
    },
    hooks: {
      cheapGlory(effect, value) {
        return true;
      }
    },
  },
  {
    key: 'silkDress-2',
    type: 'silkDress',
    itemName: '魔法制服',
    itemDescription: '预言者之手。艾莲娜，我们在未来见。',
    minLevel: 70,
    display: effect => '你的变形术会将目标变成一个随机动物，持续时间延长50%',
    generate(level, rng) {
      return 1;
    },
    range(level) {
      return `1`;
    },
    hooks: {
      randomTransform(effect, value) {
        return true;
      }
    },
  },
  {
    key: 'copperDagger2-2',
    type: 'copperDagger2',
    itemName: '荆轲之刃',
    itemDescription: '曾经属于一个伟大的刺客。',
    minLevel: 70,
    display: effect => '使你伏击的暴击几率提升50%',
    generate(level, rng) {
      return 0.5;
    },
    range(level) {
      return `50%`;
    },
    hooks: {
      ambushCritRate(effect, value) {
        return effect + value;
      }
    },
  },
];

})();

export const legends: Record<string, LegendEntry> = arrayToMap([
  ...__legends_0,
  ...__legends_1,
]);
