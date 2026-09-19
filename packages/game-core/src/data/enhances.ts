/**
 * ⚠️ 由原版 `data/enhances/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 随机一律走注入的 `Rng` 端口，本文件**零** `Math.random()`：
 *    词缀 / 传奇的 `generate` 用形参 `rng`；技能 / buff / 强化 hook 用 `world.rng.skill`（标签 `'skill'`）。
 */

import type { AttackLike, BuffStateLike, ComboLike, HookAbilityEntry, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/enhances/warrior.js ──
const __enhances_0 = ((): HookAbilityEntry[] => {
/**
 * Created by tdzl2003 on 2/2/17.
 */

return  [
  {
    key: 'weaponMastery',
    name: '武器大师',
    description: '增加5%暴击几率，25%暴击伤害',
    hooks: {
      critRate: (world, value) => value + 0.05,
      critBonus: (world, value) => value + 0.25,
    },
  },
  {
    key: 'rageForHp',
    name: '怒气灌注',
    description: '每消耗1点怒气，回复0.2%生命值',
    hooks: {
      rpRecHp(world, value) {
        return value + this.maxHp*0.002;
      },
    },
  },
  {
    key: 'ragingAttack',
    name: '狂战盛怒',
    description: '每点怒气额外增加0.25%暴击几率',
    hooks: {
      critRate(world, value) {
        return  value + this.rp*0.0025;
      },
    },
  },
  {
    key: 'ironBody',
    name: '钢铁之躯',
    description: '增加25%护甲',
    hooks: {
      defMul: (world, value) => value * 1.25,
    },
  },
  {
    key: 'rageFromHeart',
    name: '怒意高涨',
    description: '怒气生成速度增加10%，怒气上限增加20点。',
    hooks: {
      maxRp: (world, value) => value + 20,
      rpReceiveMul: (world, value) => {
        return value * 1.1;
      },
    },
  },
  {
    key: 'keepingRage',
    name: '怒不可遏',
    description: '你的怒气不再衰竭，相反，它以每秒2点的速度增加。',
    hooks: {
      rpRecovery: (world, value) => {
        return value + 3;
      },
    },
  },
  {
    key: 'phoenixHeart',
    name: '火凤之心',
    description: '每损失100点生命值，增加每5秒15点生命恢复速度。',
    hooks: {
      hpRecovery(world, value) {
        return value + (this.maxHp - this.hp)/100*3;
      },
    },
  },
  {
    key: 'strengthBelieve',
    name: '力量信仰',
    description: '当你受到非物理伤害时，可以获得5点怒气',
    hooks: {
      rpFromNonPhy: (world, val) => {
        return val + 5;
      },
    },
  },
  {
    key: 'pugnacity',
    name: '好斗勇者',
    description: '面对3个以上敌人时，攻击力增加20%',
    hooks: {
      atkMul(world, val) {
        const count = world.units.filter(v => this.willAttack(v)).length;
        return count >= 3 ? val*1.2 : val;
      },
    },
  },
];

})();

// ── 原 data/enhances/sorceress.js ──
const __enhances_1 = ((): HookAbilityEntry[] => {
/**
 * Created by tdzl2003 on 3/7/17.
 */

return  [
  {
    key: 'thinking',
    name: '冥思',
    description: '每5秒恢复2.5%的生命值和法力值。',
    hooks: {
      hpRecovery(world, value) {
        return value + this.maxHp * 0.005;
      },
      mpRecovery(world, value) {
        return value + this.maxMp * 0.005;
      },
    },
  },
  {
    key: 'soCold',
    name: '急冻',
    description: '你造成的寒冷效果有20%几率变为冻结效果。',
    hooks: {
      soCold: () => 0.2,
    },
  },
  {
    key: 'flaming',
    name: '燃尽',
    description: '你的火焰法术造成的暴击伤害可以在接下来10秒内造成同等的持续伤害。新的燃尽效果会刷新旧效果的持续时间。',
    hooks: {
      flaming: () => true,
    },
  },
  {
    key: 'magicArtist',
    name: '法力交织',
    description: '每释放一个和上次技能不同系的技能，就增加10%的伤害，持续5秒',
    hooks: {
      magicArtist: () => true,
    },
  },
  {
    key: 'coldWeaken',
    name: '寒冷弱点',
    description: '对冰冷目标造成的伤害增加20%，对冻结目标造成的伤害增加40%。',
    hooks: {
      willDamage(world, value, target) {
        if (target.runAttrHooks(false, 'freezed')) {
          return value * 1.4;
        } else if (target.runAttrHooks(false, 'cold')) {
          return value * 1.2;
        }
        return value;
      },
    },
  },
  {
    key: 'fireFrenzy',
    name: '烈焰狂热',
    description: '火球术可使你所有火焰法术的技能冷却减少1秒',
    hooks: {
      fireFrenzy: () => true,
    },
  },
  {
    key: 'manaExchange',
    name: '法力转化',
    description: '每当你消耗法力值，就为你创建一个可吸收相同数值伤害的护盾。护盾的总数额不会超过你的生命值上限。',
    hooks: {
      postCostMp(world, value) {
        const buff = this.buffs.find(v => v.group === 'manaShield');
        const result = value;
        if (buff) {
          buff.arg = Math.min(buff.arg + result, this.maxHp);
        } else {
          this.addBuff('manaShield', null, result, 'manaShield');
        }
        return value;
      }
    },
  },
  {
    key: 'coldAir',
    name: '冻气',
    description: '你的冰冷法术和效果将使敌人永久减速1%，最多叠加90层。',
    hooks: {
      coldAir: () => true,
    },
  },
  {
    key: 'fireRunner',
    name: '烈焰行者',
    description: '遇敌速度增加100%。',
  },
  {
    key: 'lifeExchange',
    name: '生命转化',
    description: '每损失1%生命值，就为你恢复1%法力值。',
  },
];

})();

// ── 原 data/enhances/assassin.js ──
const __enhances_2 = ((): HookAbilityEntry[] => {
/**
 * Created by tdzl2003 on 2/2/17.
 */

return  [
  {
    key: 'assassin.sharp',
    name: '机敏信条',
    description: '增加25%闪避几率',
    hooks: {
      noDodgeRate(world, value) {
        return value * 0.75;
      },
    },
  },
  {
    key: 'assassin.speed',
    name: '迅捷信条',
    description: '增加25%基础能量恢复速度',
    hooks: {
      epRecovery(world, value) {
        return value * 1.25;
      },
    },
  },
  {
    key: 'assassin.dexBeleive',
    name: '离经叛道',
    description: '增加15%法术吸收',
    hooks: {
      fireAbsorb(world, value) {
        return value + 0.15;
      },
      darkAbsorb(world, value) {
        return value + 0.15;
      },
      coldAbsorb(world, value) {
        return value + 0.15;
      },
      lightningAbsorb(world, value) {
        return value + 0.15;
      },
    },
  },
  {
    key: 'assassin.protect',
    name: '自我保护',
    description: '每点敏捷也会为你增加1点护甲值',
    hooks: {
      def(world, value) {
        return value + this.dex;
      },
    },
  },
  {
    key: 'assassin.atkFromStr',
    name: '刃击',
    description: '每点力量也会为你增加0.75%伤害',
    hooks: {
      atkAdd(world, value) {
        return value + this.str * 0.0075;
      },
    },
  },
  {
    key: 'assassin.prevertDeath',
    name: '假死',
    description:
      '当你受到致命伤害时，阻挡该伤害，并恢复到10%的生命值，并在2秒内减少所受所有伤害的90%，该效果每30秒只能触发一次。',
    hooks: {
      damaged(world, value) {
        if (this.hp <= value) {
          if (
            this.buffs.filter((v) => v.type === 'assassin.prevertDeathCD')
              .length > 0
          ) {
            return value;
          }
          // 恢复到10%伤害
          this.hp = Math.max(this.hp, this.maxHp / 10);
          // 30秒内不能再次触发
          this.addBuff('assassin.prevertDeathCD', 30000);
          // 2秒内减少所受所有伤害的90%
          this.addBuff('assassin.prevertDeath', 2000);
          // 阻挡伤害
          return 0;
        }
        return value;
      },
    },
  },
];

})();

// ── 原 data/enhances/knight.js ──
const __enhances_3 = ((): HookAbilityEntry[] => {
/**
 * Created by tdzl2003 on 2/2/17.
 */

function addCombo(self: UnitLike, count = 1) {
  const max = self.runAttrHooks(3, 'maxComboPoint');
  for (let i = 0; i < count; i++) {
    self.runAttrHooks(null, 'holyCombo');
  }
  self.comboPoint = Math.min(max, self.comboPoint + count);
}

return  [
  {
    key: 'knight.protectBelieve',
    name: '守护信仰',
    description: '每有一点圣能，增加20%护甲',
    hooks: {
      defAdd(world, value) {
        return value + (this.comboPoint || 0) * 0.2;
      },
    },
  },
  {
    key: 'knight.attackBelieve',
    name: '惩戒信仰',
    description: '每有一点圣能，增加15%伤害',
    hooks: {
      atkAdd(world, value) {
        return value + (this.comboPoint || 0)* 0.15;
      },
    },
  },
  {
    key: 'knight.spirit',
    name: '骑士精神',
    description: '增加2点圣能上限',
    hooks: {
      maxComboPoint(world, value) {
        return value + 2;
      },
    },
  },
  {
    key: 'knight.talking',
    name: '坐而论道',
    description: '每获得1点圣能，减少所有技能1秒冷却时间。',
    hooks: {
      holyCombo(world, value) {
        for (const skillState of this.skills) {
          if ((skillState as unknown) !== this) {
            skillState.reduceCoolDown(value * 1000);
          }
        }
        return value;
      }
    },
  },
  {
    key: 'knight.recharge',
    name: '信仰灌注',
    description: '每消耗1点圣能，有15%几率为你补充3点圣能',
    hooks: {
      postCostComboPoint(world, value)  {
        if (world.rng.skill.next() < 0.15 * value) {
          addCombo(this, 3);
        }
        return value;
      },
    },
  },
  {
    key: 'knight.absorb',
    name: '巫师克星',
    description: '受到所有法术伤害减少40%',
    hooks: {
      fireAbsorb: (world, value) => value + 0.4,
      coldAbsorb: (world, value) => value + 0.4,
      darkAbsorb: (world, value) => value + 0.4,
      lightningAbsorb: (world, value) => value + 0.4,
    },
  },
  {
    key: 'knight.defense',
    name: '背水一战',
    description: '血量每损失1%，提升1%护甲',
    hooks: {
      defMul(world, value){
        return value * (2 - (this.hp / this.maxHp));
      }
    },
  },
];

})();

// ── 原 data/enhances/elementSummoner.js ──
const __enhances_4 = ((): HookAbilityEntry[] => {
/**
 * Created by tdzl2003 on 3/7/17.
 */

return  [
  {
    key: 'summonCount',
    name: '召唤大师',
    description: '每种元素可以多召唤一个。',
    hooks: {
      summonCount(world, value) {
        return value + 1;
      },
    },
  },
  {
    key: 'longLive',
    name: '召唤技巧',
    description: '召唤物的持续时间延长10秒。',
    hooks: {
      summonTime(world, value) {
        return value + 10000
      },
    },
  },
  {
    key: 'summonBack',
    name: '法力回流',
    description: '召唤物死亡时，恢复50%的技能消耗。',
    hooks: {
      summonBack(world, value) {
        return true
      },
    },
  },
];

})();

export const enhances: Record<string, HookAbilityEntry> = arrayToMap([
  ...__enhances_0,
  ...__enhances_1,
  ...__enhances_2,
  ...__enhances_3,
  ...__enhances_4,
]);
