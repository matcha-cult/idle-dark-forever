/**
 * ⚠️ 由原版 `data/skills/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 随机一律走注入的 `Rng` 端口，本文件**零** `Math.random()`：
 *    词缀 / 传奇的 `generate` 用形参 `rng`；技能 / buff / 强化 hook 用 `world.rng.skill`（标签 `'skill'`）。
 */

import type { AttackLike, BuffStateLike, ComboLike, SkillEntry, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

/**
 * 原版 `data/skills/enemy.js` 里三处引用了**从未定义**的全局 `UNIT_LEVEL_RATE`
 * （原版执行到那三行会直接 ReferenceError）。这里用 ambient 声明保持引用可编译、
 * 且运行期行为与原版一致（访问即 ReferenceError），**不臆造数值**。
 */
declare const UNIT_LEVEL_RATE: number;

// ── 原 data/skills/base.js ──
const __skills_0 = ((): SkillEntry[] => {
/**
 * Created by tdzl2003 on 1/31/17.
 */

/**
 * isAttack: 是否伴随普通攻击。如果是的话，只有可以进行普通攻击的时候才可释放技能。
 */
return  [
  {
    key: 'melee',
    name: '攻击',
    group: 'melee',
    description: level => {
      const bonus = (1+0.2*level);
      const min = 0.75*bonus*100, max = 1.25* bonus*100;
      return `普普通通的一击。对目标造成攻击力的${min|0}%-${max|0}%伤害。`
    },
    isAttack: true,
    maxExp(level) {
      return level**2 * 1000 + level*3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, leech = 0, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() * 0.5 + 0.75) * (level * 0.2 + 1);
      const isCrit = self.testCrit();
      world.sendDamage('melee', self, target, this, self.getCritBonus(isCrit) * val, isCrit);

      if (leech) {
        self.hp += leech;
      }

      self.rp += self.rpOnAttack;
      target.rp += target.rpOnAttacked;

      target.runAttrHooks(self, 'attacked');
    },
  },
  {
    key: 'melee.aoe',
    name: '炮击',
    group: 'melee',
    castTime: 500,
    description: level => {
      const bonus = (1+0.2*level);
      const min = 0.75*bonus*100, max = 1.25* bonus*100;
      return `普普通通的一击。对目标造成攻击力的${min|0}%-${max|0}%伤害。`
    },
    isAttack: true,
    maxExp(level) {
      return level**2 * 1000 + level*3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { leech = 0, atk } = self;
      const val = atk * (world.rng.skill.next() * 0.5 + 0.75) * (level * 0.2 + 1);

      for (const target of world.units.filter(v => self.willAttack(v))) {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const isCrit = self.testCrit();
        world.sendDamage('melee', self, target, this, self.getCritBonus(isCrit) * val, isCrit);

        target.rp += target.rpOnAttacked;

        target.runAttrHooks(self, 'attacked');
      }


      if (leech) {
        self.hp += leech;
      }

      self.rp += self.rpOnAttack;
    },
  },
];

})();

// ── 原 data/skills/warrior.js ──
const __skills_1 = ((): SkillEntry[] => {
/**
 * Created by tdzl2003 on 1/31/17.
 */

/**
 * isAttack: 是否伴随普通攻击。如果是的话，只有可以进行普通攻击的时候才可释放技能。
 */
return  [
  {
    key: 'thump',
    group: 'thump',
    name: '重击',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 250 * bonus,
        max = 350 * bonus;
      return `造成巨额的伤害。对目标造成攻击力的${min | 0}%-${max | 0}%伤害。`;
    },
    cost: {
      rp: 25,
    },
    coolDown: 1000,
    maxExp(level) {
      return level ** 2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk, leech = 0, critRate = 0, critBonus = 1.5 } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() + 2.5) * (level / 5 + 1);
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );
      if (leech) {
        self.hp += leech;
      }
      target.rp += target.rpOnAttacked;
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'cleave',
    name: '顺劈斩',
    group: 'melee',
    description: (level, self) => {
      const bonus =
        (1 + 0.2 * level) * self.runAttrHooks(1, 'cleaveDamageRate');
      const min = 40 * bonus,
        max = 60 * bonus;
      return `对最多三个目标分别造成(${min | 0}%-${max | 0}%)倍攻击力伤害。`;
    },
    isAttack: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { atk, target, leech = 0, critRate = 0, critBonus = 1.5 } = self;
      const damageRate = self.runAttrHooks(1, 'cleaveDamageRate');
      const val =
        atk * (world.rng.skill.next() * 0.2 + 0.4) * (level / 5 + 1) * damageRate;
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );

      let leechRatio = 0.4;

      const extraTargets = world.units
        .filter((v) => v !== target && self.willAttack(v))
        .slice(0, 2);
      extraTargets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const val =
          atk * (world.rng.skill.next() * 0.2 + 0.4) * (level / 10 + 1) * damageRate;
        leechRatio += 0.4;
        world.sendDamage(
          'melee',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * val,
          isCrit
        );
        target.runAttrHooks(self, 'attacked');
      });

      if (leech) {
        self.hp += leech * leechRatio;
      }
      self.rp += self.rpOnAttack;
      target.rp += target.rpOnAttacked;
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'whirlwind',
    group: 'thump',
    name: '旋风斩',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 40 * bonus,
        max = 60 * bonus;
      return `对所有目标造成${min | 0}%-${max | 0}%攻击力伤害。`;
    },
    coolDown: 800,
    cost: { rp: 15 },
    maxExp(level) {
      return level ** 2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const atk = self.atk * (level * 0.2 + 1);

      const targets = world.units.filter((v) => self.willAttack(v));
      const { critRate = 0, critBonus = 1.5, leech } = self;

      if (leech) {
        self.hp += leech;
      }

      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const val = atk * (world.rng.skill.next() * 0.2 + 0.4);
        const isCrit = self.testCrit();
        world.sendDamage(
          'melee',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * val,
          isCrit
        );
        target.runAttrHooks(self, 'attacked');
      });
    },
  },

  {
    key: 'shout',
    name: '战斗怒吼',
    description: (level) =>
      `恢复50点怒气，并在未来30秒内增加所有同伴${(10 + level * 5) | 0}%护甲。`,
    coolDown: 30000,
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    canUse(world, self) {
      // 在自己家不吼。
      return world.map !== 'home';
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      const allAliens = world.units.filter(
        (v) => v === self || self.willAssist(v)
      );
      const value = (1 + level * 0.5) * 0.1;
      const multiShouts = self.runAttrHooks(false, 'multiShouts');
      allAliens.forEach((target) => {
        target.addBuff(
          'shout',
          30000,
          value,
          multiShouts ? undefined : 'shout'
        );
      });
      self.rp += 50;
    },
  },

  {
    key: 'mortalStrike',
    name: '致死打击',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 1000 * bonus,
        max = 2000 * bonus;
      return `只能对血量少于20%的目标使用。对目标造成${min | 0}%-${
        max | 0
      }%攻击力伤害。`;
    },
    coolDown: (level, unit) => {
      return unit.runAttrHooks(8000, 'mortalStrikeCoolDown');
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self, level) {
      if (!self.target) {
        return false;
      }
      return self.target.hp <= self.target.maxHp * 0.2;
    },
    effect(world, self, level) {
      const { target } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const atk = self.atk;
      const val = atk * (world.rng.skill.next() * 10 + 10) * (1 + 0.2 * level);
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );
      target.runAttrHooks(self, 'attacked');
    },
  },

  // 技能符文
  {
    key: 'swordSkill',
    name: '狂热',
    group: 'melee',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 60 * bonus,
        max = 100 * bonus;
      return `对目标造成攻击力的${min | 0}%-${max | 0}%伤害，并在接下来的${
        level + 1
      }秒内增加10%伤害，此效果可以叠加。`;
    },
    targetType: 'target',
    isAttack: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, leech = 0, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() * 0.4 + 0.6) * (level * 0.2 + 1);
      const { critRate = 0, critBonus = 1.5 } = self;
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );

      if (leech) {
        self.hp += leech;
      }
      self.addBuff('swordSkill', (level + 1) * 1000, 0.1);

      self.rp += self.rpOnAttack;
      target.rp += target.rpOnAttacked;
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'meleeForRage',
    name: '怒击',
    group: 'melee',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 60 * bonus,
        max = 100 * bonus;
      return `对目标造成攻击力的${min | 0}%-${max | 0}%伤害，并获得${
        level + 1
      }点额外怒气。`;
    },
    targetType: 'target',
    isAttack: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, leech = 0, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() * 0.4 + 0.6) * (level * 0.2 + 1);
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );

      if (leech) {
        self.hp += leech;
      }

      self.rp += self.rpOnAttack + level + 1;
      target.rp += target.rpOnAttacked;
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'thumpHead',
    name: '重击·击颅',
    group: 'thump',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 200 * bonus,
        max = 280 * bonus;
      return `对目标造成攻击力的${min | 0}%-${max | 0}%伤害，并使目标昏迷${
        level + 1
      }秒。`;
    },
    cost: {
      rp: 25,
    },
    coolDown: 1000,
    maxExp(level) {
      return level ** 2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk, leech = 0, critRate = 0, critBonus = 1.5 } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() * 0.8 + 2) * (1 + 0.2 * level);
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );

      if (leech) {
        self.hp += leech;
      }
      target.stun(level + 1);
      target.rp += target.rpOnAttacked;
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'cleaveBlast',
    name: '爆裂顺劈斩',
    group: 'melee',
    description: (level, self) => {
      const bonus =
        (1 + 0.2 * level) * self.runAttrHooks(1, 'cleaveDamageRate');
      const min = 35 * bonus,
        max = 50 * bonus;
      const addMin = 15 * bonus,
        addMax = 25 * bonus;
      return `对最多三个目标分别造成(${min | 0}%-${
        max | 0
      }%)倍攻击力伤害。如果这一击杀死了敌人，会对所有敌人造成(${addMin | 0}%-${
        addMax | 0
      }%)伤害。`;
    },
    isAttack: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk, leech = 0, critRate = 0, critBonus = 1.5 } = self;
      const damageRate = self.runAttrHooks(1, 'cleaveDamageRate');
      const val =
        atk * (world.rng.skill.next() * 0.15 + 0.35) * (level * 0.2 + 1) * damageRate;

      let kills = 0;
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );

      if (target.camp === 'ghost') {
        kills++;
      }

      let leechRatio = 0.4;

      const extraTargets = world.units
        .filter((v) => v !== target && self.willAttack(v))
        .slice(0, 2);
      extraTargets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const val =
          atk * (world.rng.skill.next() * 0.15 + 0.35) * (level / 10 + 1) * damageRate;
        const isCrit = self.testCrit();
        leechRatio += 0.4;
        world.sendDamage(
          'melee',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * val,
          isCrit
        );
        if (target.camp === 'ghost') {
          kills++;
        }
        target.runAttrHooks(self, 'attacked');
      });

      if (kills > 0) {
        const allEnemy = world.units.filter((v) => self.willAttack(v));
        allEnemy.forEach((target) => {
          if (world.testDodge(self, target, this)) {
            return;
          }
          const val =
            atk * (world.rng.skill.next() * 0.1 + 0.15) * (level / 10 + 1) * damageRate;
          const isCrit = self.testCrit();
          world.sendDamage(
            'melee',
            self,
            target,
            this,
            self.getCritBonus(isCrit) * val,
            isCrit
          );
          target.runAttrHooks(self, 'attacked');
        });
      }

      if (leech) {
        self.hp += leech * leechRatio;
      }
      self.rp += self.rpOnAttack;
      if (target.camp !== 'ghost') {
        target.rp += target.rpOnAttacked;
      }
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'shoutShake',
    name: '震慑怒吼',
    description: (level) => {
      const rate = (1 - 1 / (1.1 + level * 0.1)) * 100;
      return `恢复50点怒气，并在未来30秒减少所有敌人${rate.toFixed(
        1
      )}%攻击力。`;
    },
    coolDown: 30000,
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    canUse(world, self) {
      // 在自己家不吼。
      return world.map !== 'home';
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      const allEnemy = world.units.filter((v) => self.willAttack(v));
      const value = 0.1 + level * 0.1;

      allEnemy.forEach((target) => {
        const stunResist = target.stunResist;
        const result = 1 / (1 + value / (1 + stunResist / 100));
        target.addBuff('shoutShake', 30000, result, 'shoutShake');
      });
      self.rp += 50;
    },
  },

  {
    key: 'whirlwindBlood',
    group: 'thump',
    name: '旋风斩·集血',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 30 * bonus,
        max = 40 * bonus;
      return `对所有目标造成${min | 0}%-${
        max | 0
      }%攻击力伤害，并汲取造成伤害10%的生命值。`;
    },
    coolDown: 800,
    cost: { rp: 15 },
    maxExp(level) {
      return level ** 2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const atk = self.atk * (level * 0.2 + 1);

      const targets = world.units.filter((v) => self.willAttack(v));
      const { leech = 0, critRate = 0, critBonus = 1.5 } = self;

      let totalDmg = 0;

      if (leech) {
        self.hp += leech;
      }

      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const val = atk * (world.rng.skill.next() * 0.1 + 0.3);
        const isCrit = self.testCrit();
        totalDmg += self.getCritBonus(isCrit) * val;
        world.sendDamage(
          'melee',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * val,
          isCrit
        );
        target.runAttrHooks(self, 'attacked');
      });

      world.sendHeal(self, self, this, totalDmg / 10);
    },
  },

  {
    key: 'commandShout',
    name: '命令怒吼',
    description: (level) =>
      `恢复50点怒气，并在未来30秒内增加所有同伴${
        (10 + level * 5) | 0
      }%生命上限。`,
    coolDown: 30000,
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    canUse(world, self) {
      // 在自己家不吼。
      return world.map !== 'home';
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      const allAliens = world.units.filter(
        (v) => v === self || self.willAssist(v)
      );
      const multiShouts = self.runAttrHooks(false, 'multiShouts');
      const value = level * 0.05 + 0.1;
      allAliens.forEach((target) => {
        target.addBuff(
          'commandShout',
          30000,
          value,
          multiShouts ? undefined : 'shout'
        );
        target.hp *= 1 + value;
      });
      self.rp += 50;
    },
  },

  {
    key: 'shockWave',
    name: '震荡波',
    group: 'shockWave',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 60 * bonus,
        max = 100 * bonus;
      return `对全体目标造成攻击力的${min | 0}%-${max | 0}%伤害，并使目标昏迷${
        level / 2 + 1
      }秒。`;
    },
    coolDown: (level) => 10000, // 这是为了防止过高的等级可以无限晕
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!world.units.find((v) => self.willAttack(v));
    },
    effect(world, self, level) {
      const { atk, critRate = 0, critBonus = 1.5 } = self;
      const targets = world.units.filter((v) => self.willAttack(v));

      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const val = atk * (world.rng.skill.next() * 0.4 + 0.6) * (1 + 0.2 * level);
        const isCrit = self.testCrit();
        world.sendDamage(
          'melee',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * val,
          isCrit
        );
        target.stun(level / 2 + 1);
        target.rp += target.rpOnAttacked;
        target.runAttrHooks(self, 'attacked');
      });
    },
  },

  {
    key: 'warrior.kick',
    name: '拳击',
    description: (level) =>
      `用力击打敌人的下颚，打断其正在释放的技能，并阻止其5秒内释放相同的技能`,
    coolDown: (level) => 10000 / (1 + level * 0.1),
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      const target = world.units.find(
        (v) =>
          self.willAttack(v) &&
          ((v.casting !== null && !v.casting.notBreakable) ||
            (v.reading !== null &&
              v.reading.skill &&
              !v.reading.skill.notBreakable))
      );
      return !!target;
    },
    effect(world, self, level) {
      const target = world.units.find(
        (v) =>
          self.willAttack(v) &&
          ((v.casting !== null && !v.casting.notBreakable) ||
            (v.reading !== null &&
              v.reading.skill &&
              !v.reading.skill.notBreakable))
      );
      world.sendSkillUsage(self, null, this);
      target.breakCasting(5000);
    },
  },
];

})();

// ── 原 data/skills/sorceress.js ──
const __skills_2 = ((): SkillEntry[] => {
/**
 * Created by tdzl2003 on 3/4/17.
 */

function addFlaming(self: UnitLike, target: UnitLike, value: number) {
  if (self.runAttrHooks(false, 'flaming')) {
    const buff = target.buffs.find((v) => v.group === 'flaming');
    if (buff) {
      buff.arg += value / 10;
      buff.resetTimer(10000);
    } else {
      target.addBuff('flaming', 10000, value / 10, 'flaming');
    }
  }
}

function magicArtist(self: UnitLike, type: string) {
  const isMagicArtist = self.runAttrHooks(false, 'magicArtist');
  const buff = self.buffs.find((v) => v.group === 'magicState');
  if (isMagicArtist) {
    if (!buff) {
      self.addBuff('magicState', null, type, 'magicState');
    } else if ((buff.arg as unknown as string) !== type) {
      buff.arg = type as unknown as number;
      self.addBuff('magicArtist', 5000, 0.1);
    }
  } else if (buff) {
    self.removeBuff(buff);
  }
}

function addColdAir(target: UnitLike) {
  const buff = target.buffs.find((v) => v.group === 'coldAir');
  if (buff) {
    buff.arg = Math.min(buff.arg + 0.01, 0.99);
  } else {
    target.addBuff('coldAir', null, 0.01, 'coldAir');
  }
}

function getLevelBonus(level: number) {
  if (level <= 60) {
    return level * 0.3 + 1;
  }
  if (level <= 70) {
    return level * 0.5 + 1 - 6;
  }
  return level * 0.5 + 1 - 6;
}

const TRANFORM_TYPES = [
  '羊',
  '鸡',
  '猪',
  '乌龟',
  '大象',
  '牛',
  '鼠',
  '兔',
  '蛇',
  '蛋',
];

return  [
  {
    key: 'iceArrow',
    name: '寒冰箭',
    element: 'ice',
    description: (level, self) => {
      const { int } = self;
      const dmg =
        10 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        getLevelBonus(level) *
        self.dmgAdd;
      return `对目标造成${dmg | 0}点寒冷伤害，并使目标未来3秒所有行动减缓20%`;
    },
    castTime: 1500,
    cost: {
      mp: (self) => 8 * (self.level * 0.2 + 1),
    },
    maxExp(level) {
      return level ** 2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return !!self.target && self.target.coldAbsorb < 1;
    },
    effect(world, self, level) {
      const { critRate, critBonus, target, int = 0 } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const dmg =
        10 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      if (world.rng.skill.next() < Number(self.runAttrHooks(false, 'soCold'))) {
        target.stun(3, 'freezed');
      } else {
        target.addBuff('cold', 3000, null, 'cold');
      }
      if (self.runAttrHooks(false, 'coldAir')) {
        addColdAir(target);
      }
      const isCrit = self.testCrit();
      world.sendDamage(
        'cold',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * dmg,
        isCrit
      );

      magicArtist(self, 'ice');
    },
  },
  {
    key: 'fireBall',
    name: '火球术',
    element: 'fire',
    description: (level, self) => {
      const { int } = self;
      const dmg =
        15 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      return `对目标造成${dmg | 0}点火焰伤害`;
    },
    castTime: 2000,
    cost: {
      mp: (self) => 10 * (self.level * 0.2 + 1),
    },
    maxExp(level) {
      return level ** 2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return !!self.target && self.target.fireAbsorb < 1;
    },
    effect(world, self, level) {
      const { critRate, critBonus, target, int = 0 } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const dmg =
        15 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      const isCrit = self.testCrit();
      world.sendDamage(
        'fire',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * dmg,
        isCrit
      );
      if (isCrit) {
        addFlaming(self, target, self.getCritBonus(isCrit) * dmg);
      }
      magicArtist(self, 'fire');

      // 烈焰狂热处理
      if (self.runAttrHooks(false, 'fireFrenzy')) {
        for (const skillState of self.skills) {
          if (skillState !== this && skillState.skillData.element === 'fire') {
            skillState.reduceCoolDown(1000);
          }
        }
      }
    },
  },
  {
    key: 'windBlade',
    name: '奥术飞弹',
    element: 'wind',
    description: (level, self) => {
      const { int } = self;
      const dmg =
        1 * getLevelBonus(self.level) * (int * 0.01 + 1) * self.dmgAdd;
      return `释放${level + 3}个飞弹，每个对目标造成${
        dmg | 0
      }点秘法伤害。每个飞弹有20%的几率攻击随机的目标。`;
    },
    coolDown: 1500,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { critRate, critBonus, int = 0, target: currentTarget } = self;
      const dmg =
        1 * getLevelBonus(self.level) * (int * 0.01 + 1) * self.dmgAdd;
      const validTargets = world.units.filter(
        (v) => v !== currentTarget && self.willAttack(v)
      );

      for (let i = 0; i < level + 3; i++) {
        let target = currentTarget;
        if (world.testDodge(self, target, this)) {
          return;
        }
        // 如果self.target为空，是当前目标已死亡，有其它目标的情况下，剩下的秘法球都去打随机目标。
        if (validTargets.length > 0 && (!self.target || world.rng.skill.next() < 0.2)) {
          // 更换目标
          target =
            validTargets[Math.floor(world.rng.skill.next() * validTargets.length)]!;
        }
        const isCrit = self.testCrit();
        world.sendDamage(
          'magic',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * dmg,
          isCrit
        );
      }
      magicArtist(self, 'wind');
    },
  },
  {
    key: 'burning',
    name: '灼烧',
    element: 'fire',
    description: (level, self) => {
      const { int } = self;
      const dmg =
        15 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      return `对目标造成${dmg | 0}点火焰伤害`;
    },
    coolDown: 8000,
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return !!self.target && self.target.fireAbsorb < 1;
    },
    effect(world, self, level) {
      const { target, int = 0 } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const dmg =
        15 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      const isCrit = self.testCrit();
      world.sendDamage(
        'fire',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * dmg,
        isCrit
      );
      if (isCrit) {
        addFlaming(self, target, self.getCritBonus(isCrit) * dmg);
      }
      magicArtist(self, 'fire');
    },
  },
  {
    key: 'iceNova',
    name: '霜之新星',
    element: 'ice',
    description: (level, self) => {
      return `冻结全体目标${level / 2 + 1}秒。`;
    },
    castTime: 500,
    coolDown: (level) => 10000,
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return !!world.units.find((v) => self.willAttack(v));
    },
    effect(world, self, level) {
      const targets = world.units.filter(
        (v) => self.willAttack(v) && v.coldAbsorb < 1
      );
      const coldAir = self.runAttrHooks(false, 'coldAir');

      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        target.stun(level / 2 + 1, 'freezed');
        if (coldAir) {
          addColdAir(target);
        }
      });
      magicArtist(self, 'ice');
    },
  },
  {
    key: 'magicShield',
    name: '魔法盾',
    element: 'wind',
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    canUse(world, self) {
      if (self.runAttrHooks(false, 'haveMagicShield')) {
        return false;
      }
      // 在自己家不吼。
      return world.map !== 'home';
    },
    description: (level, self) => {
      const { int } = self;
      const rate = ((int * 0.01 + 1) * (level * 0.2 + 1)) / 3; // 每点法力抵挡伤害。
      const total = rate * getLevelBonus(self.level) * 50; // 最多吸收伤害
      return `消耗法力值以吸收伤害，每点法力值吸收${rate.toFixed(
        1
      )}点伤害，最多吸收${total | 0}点伤害`;
    },
    coolDown: 10000,
    effect(world, self, level) {
      const { int = 0 } = self;
      const rate = ((int * 0.01 + 1) * (level * 0.2 + 1)) / 3; // 每点法力抵挡伤害。
      const total = rate * getLevelBonus(self.level) * 50; // 最多吸收伤害
      self.addBuff('magicShield', 60000, [rate, total]);
      magicArtist(self, 'wind');
    },
  },
  {
    key: 'flameStrike',
    name: '烈焰风暴',
    element: 'fire',
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    castTime: 3000,
    coolDown: 25000,
    canUse(world, self) {
      return !!self.target;
    },
    description: (level, self) => {
      const { int } = self;
      const dmg =
        15 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      return `对所有敌人造成${dmg | 0}点伤害。`;
    },
    effect(world, self, level) {
      const { critRate, critBonus, int = 0 } = self;
      const dmg =
        15 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      const targets = world.units.filter((v) => self.willAttack(v));

      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const isCrit = self.testCrit();
        world.sendDamage(
          'fire',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * dmg,
          isCrit
        );
        if (isCrit) {
          addFlaming(self, target, self.getCritBonus(isCrit) * dmg);
        }
      });
      magicArtist(self, 'fire');
    },
  },
  {
    key: 'iceShield',
    name: '冰霜护盾',
    group: 'shield',
    element: 'ice',
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    canUse(world, self) {
      // 在自己家不吼。
      return world.map !== 'home';
    },
    description: (level, self) => {
      const { int } = self;
      const def =
        (int * 0.01 + 1) * (level * 0.2 + 1) * getLevelBonus(self.level) * 3;
      return `增加${def | 0}点护甲，并使所有攻击者减速20%`;
    },
    coolDown: 30000,
    effect(world, self, level) {
      const { int } = self;
      const def =
        (int * 0.01 + 1) * (level * 0.2 + 1) * getLevelBonus(self.level) * 3;
      self.addBuff('iceShield', 60000, def, 'shield');
      magicArtist(self, 'ice');
    },
  },
  {
    key: 'transform',
    name: '变形术',
    element: 'wind',
    description: (level, self) => {
      let time = 5 + level;
      if (self.runAttrHooks(false, 'randomTransform')) {
        time *= 1.5;
      }
      return `变形一个随机的目标，使其不再攻击，持续${
        time | 0
      }秒。变形期间不能进行任何攻击或施法。受到任何伤害均会解除此效果。`;
    },
    castTime: 1000,
    coolDown: 10000,
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return !!world.units.find(
        (v) =>
          v !== self.target &&
          self.willAttack(v) &&
          v.runAttrHooks(false, 'transformed') === false
      );
    },
    effect(world, self, level) {
      const targets = world.units.filter(
        (v) =>
          v !== self.target &&
          self.willAttack(v) &&
          v.runAttrHooks(false, 'transformed') === false
      );
      const target = targets[Math.floor(world.rng.skill.next() * targets.length)]!;
      if (world.testDodge(self, target, this)) {
        return;
      }
      let type = '羊';
      let time = 5000 + level * 1000;
      if (self.runAttrHooks(false, 'randomTransform')) {
        type =
          TRANFORM_TYPES[Math.floor(world.rng.skill.next() * TRANFORM_TYPES.length)]!;
        time *= 1.5;
      }
      target.addBuff('transform', time, type, 'transform');
      magicArtist(self, 'wind');
    },
  },
  {
    key: 'fireShield',
    name: '烈焰护盾',
    group: 'shield',
    element: 'fire',
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    canUse(world, self) {
      // 在自己家不吼。
      return world.map !== 'home';
    },
    description: (level, self) => {
      const val = (level * 0.2 + 1) * 10;
      return `增加${val | 0}%暴击伤害，以及20%暴击几率`;
    },
    coolDown: 30000,
    effect(world, self, level) {
      const val = (level * 0.2 + 1) / 10;
      self.addBuff('fireShield', 60000, val, 'shield');
      magicArtist(self, 'fire');
    },
  },
  {
    key: 'iceLance',
    name: '冰枪术',
    element: 'ice',
    description: (level, self) => {
      const { int } = self;
      const dmg =
        15 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      return `对一个已被冻结的敌人造成${dmg | 0}点冰霜伤害，并解除冻结效果`;
    },
    coolDown: 800,
    maxExp(level) {
      return level ** 2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      const target = world.units.find(
        (v) =>
          self.willAttack(v) &&
          v.runAttrHooks(false, 'freezed') &&
          v.coldAbsorb < 1
      );
      return !!target;
    },
    effect(world, self, level) {
      const { critRate, critBonus, int = 0 } = self;
      let target;
      let freezed =
        self.target &&
        self.target.coldAbsorb < 0.5 &&
        self.target.runAttrHooks(false, 'freezed');
      if (self.target && freezed) {
        target = self.target;
      } else {
        target = world.units.find(
          (v) =>
            self.willAttack(v) &&
            v.runAttrHooks(false, 'freezed') &&
            v.coldAbsorb < 0.5
        );
        freezed = target && target.runAttrHooks(false, 'freezed');
      }
      if (!target) {
        return;
      }
      if (world.testDodge(self, target, this)) {
        return;
      }
      const dmg =
        15 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      const isCrit = self.testCrit();
      world.sendDamage(
        'cold',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * dmg,
        isCrit
      );
      target.removeBuff(freezed);
      if (self.runAttrHooks(false, 'coldAir')) {
        addColdAir(target);
      }

      magicArtist(self, 'ice');
    },
  },
  {
    key: 'awaking',
    name: '法力唤醒',
    element: 'wind',
    description: (level, self) => {
      const result = 30 + level;
      return `在3秒内恢复${result | 0}%法力值`;
    },
    // castTime: 3000,
    coolDown: (level, unit) => unit.runAttrHooks(60000, 'awakingCoolDown'),
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    shouldUse(world, self, level) {
      const used = 1 - self.mp / self.maxMp;
      return used >= 0.3 + level * 0.01;
    },
    effect(world, self, level) {
      // const rate = 0.3 + level * 0.01;
      // self.mp += self.maxMp * rate;
      self.startRead(
        'awaking',
        3000,
        ((0.3 + level * 0.01) * self.maxMp) / 3,
        this
      );
      magicArtist(self, 'wind');
    },
  },
  {
    key: 'counterSpelling',
    name: '法术反制',
    element: 'wind',
    description: (level) =>
      `反制一个目标，打断其正在释放的技能，并阻止其5秒内释放相同的技能`,
    coolDown: (level) => 10000 / (1 + level * 0.1),
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      const target = world.units.find(
        (v) =>
          self.willAttack(v) &&
          ((v.casting !== null && !v.casting.notBreakable) ||
            (v.reading !== null && !v.reading.notBreakable))
      );
      return !!target;
    },
    effect(world, self, level) {
      const target = world.units.find(
        (v) =>
          self.willAttack(v) &&
          ((v.casting !== null && !v.casting.notBreakable) ||
            (v.reading !== null && !v.reading.notBreakable))
      );
      world.sendSkillUsage(self, null, this);
      target.breakCasting(5000);
      magicArtist(self, 'wind');
    },
  },
  {
    key: 'dragonFlame',
    name: '龙息术',
    element: 'fire',
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 500;
    },
    coolDown: 10000,
    canUse(world, self) {
      return !!self.target;
    },
    description: (level, self) => {
      const { int } = self;
      const dmg =
        12 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      return `对最近的5个敌人造成${dmg | 0}点伤害，并使它们眩晕${
        level / 2 + 1
      }秒。`;
    },
    effect(world, self, level) {
      const { critRate, critBonus, int = 0 } = self;
      const dmg =
        12 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      const targets = world.units.filter(
        (v) => self.willAttack(v) && v.fireAbsorb < 1
      );

      targets.slice(0, 4).forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const isCrit = self.testCrit();
        world.sendDamage(
          'fire',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * dmg,
          isCrit
        );
        target.stun(level / 2 + 1);
        if (isCrit) {
          addFlaming(self, target, self.getCritBonus(isCrit) * dmg);
        }
      });
      magicArtist(self, 'fire');
    },
  },
];

})();

// ── 原 data/skills/assassin.js ──
const __skills_3 = ((): SkillEntry[] => {
/**
 * Created by tdzl2003 on 4/9/17.
 */

function addCombo(target: UnitLike, combo: ComboLike) {
  target.combos.push(combo);
  if (target.combos.length > 20) {
    target.combos.shift();
  }
}

function comboCount(target: UnitLike) {
  if (target) {
    return target.combos.length;
  }
  return 0;
}

function clearCombo(world: WorldLike, self: UnitLike, target: UnitLike, limit: number, finalAttack: AttackLike) {
  let combos;
  if (limit) {
    combos = target.combos.splice(0, limit);
  } else {
    combos = target.combos.splice(0);
  }
  combos.forEach((v) => {
    v.effect(world, self, finalAttack);
  });
  finalAttack.isCrit = self.testCrit(finalAttack.critRate);
  combos.forEach((v) => {
    v.postEffect(world, self, finalAttack);
  });
}

class Combo {
  value: number;
  constructor(value: number = 0) {
    this.value = value;
  }

  effect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void {}
  postEffect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void {}
}

class MeleeCombo extends Combo {
  override effect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void {
    finalAttack.dmg += this.value;
  }
}

class EnergyCombo extends Combo {
  override effect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void {
    finalAttack.critRate += this.value;
  }
}

class BloodCombo extends Combo {
  override postEffect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void {
    self.hp +=
      self.getCritBonus(finalAttack.isCrit, finalAttack.critBonus) * this.value;
  }
}

return  [
  {
    key: 'assassin.melee',
    name: '攻击',
    group: 'melee',
    expGroup: 'melee',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 0.6 * bonus * 100,
        max = 1 * bonus * 100;
      const extra = 0.4 * bonus * 100;
      return `普普通通的一击。对目标造成攻击力的${min | 0}%-${
        max | 0
      }%伤害。连击：在最终一击时额外造成${extra | 0}%武器伤害。`;
    },
    isAttack: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, leech = 0, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const rate = level * 0.2 + 1;
      const val = atk * (world.rng.skill.next() * 0.4 + 0.6) * rate;
      const isCrit = self.testCrit();
      const critBonus = self.getCritBonus(isCrit);
      world.sendDamage('melee', self, target, this, val * critBonus, isCrit);

      if (leech) {
        self.hp += leech;
      }

      addCombo(target, new MeleeCombo(atk * 0.4 * rate));
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'assassin.thump',
    group: 'finalAttack',
    name: '剔骨',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 150 * bonus,
        max = 250 * bonus;
      return `造成巨额的伤害。对目标造成武器每秒伤害的${min | 0}%-${
        max | 0
      }%伤害。最终一击：需要三个连击效果。`;
    },
    coolDown: 1000,
    maxExp(level) {
      return level ** 2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return comboCount(self.target) >= 3;
    },
    effect(world, self, level) {
      const {
        target,
        atk,
        atkSpeed,
        leech = 0,
        critRate = 0,
        critBonus = 1.5,
      } = self;
      const val = atk * (world.rng.skill.next() + 1.5) * (level / 5 + 1) * atkSpeed;

      const atkInfo: AttackLike = {
        dmg: val,
        critRate,
        critBonus,
      };

      clearCombo(world, self, target, 3, atkInfo);
      if (world.testDodge(self, target, this)) {
        return;
      }

      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(atkInfo.isCrit, atkInfo.critBonus) * atkInfo.dmg,
        atkInfo.isCrit
      );
      if (leech) {
        self.hp += leech;
      }
      target.rp += target.rpOnAttacked;
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'assassin.blood',
    name: '血债血偿',
    coolDown: 1500,
    cost: {
      ep: 20,
    },
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 1 * bonus * 100,
        max = 1.5 * bonus * 100;
      const extra = 0.2 * bonus * 100;
      return `用仇恨引导你的攻击，对目标造成武器每秒伤害的${min | 0}%-${
        max | 0
      }%伤害。连击：在最终一击时恢复武器每秒伤害的${extra.toFixed(1)}%生命。`;
    },
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, leech = 0, atk, atkSpeed } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const rate = level * 0.2 + 1;
      const val = atk * (world.rng.skill.next() * 0.5 + 1) * rate * atkSpeed;
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        val * self.getCritBonus(isCrit),
        isCrit
      );

      if (leech) {
        self.hp += leech;
      }

      addCombo(target, new BloodCombo(atk * 0.2 * rate * atkSpeed));
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'assassin.coherentExtrapolated',
    name: '集中意志',
    coolDown: 1500,
    cost: {
      ep: 20,
    },
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 1 * bonus * 100,
        max = 1.5 * bonus * 100;
      return `用意志引导你的攻击，对目标造成武器每秒伤害的${min | 0}%-${
        max | 0
      }%伤害。连击：使你的最终一击暴击几率提升5%。`;
    },
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, leech = 0, atk, atkSpeed } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const rate = level * 0.2 + 1;
      const val = atk * (world.rng.skill.next() * 0.5 + 1) * rate * atkSpeed;
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );

      if (leech) {
        self.hp += leech;
      }

      addCombo(target, new EnergyCombo(0.05));
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'assassin.cutting',
    group: 'finalAttack',
    name: '切割',
    coolDown: 1000,
    description: (level) => {
      const bonus = (1 + 0.2 * level) * 15;
      return `并增加${
        bonus | 0
      }%攻击速度和能量恢复速度，持续5秒。最终一击：需要至少五个连击效果，消耗并触发所有剩余连击效果。`;
    },
    maxExp(level) {
      return level ** 2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return comboCount(self.target) >= 5;
    },
    effect(world, self, level) {
      const { target, leech = 0, critRate = 0, critBonus = 1.5 } = self;
      const atkInfo: AttackLike = {
        dmg: 0,
        critRate,
        critBonus,
      };
      clearCombo(world, self, target, 0, atkInfo);
      if (world.testDodge(self, target, this)) {
        return;
      }

      const bonus = (1 + 0.2 * level) * 0.15 + 1;

      // 增加buff
      self.addBuff('assassin.cutting', 5000, bonus, 'assassin.cutting');

      // 触发连击的攻击效果
      if (atkInfo.dmg > 0) {
        world.sendDamage(
          'melee',
          self,
          target,
          this,
          self.getCritBonus(atkInfo.isCrit, atkInfo.critBonus) * atkInfo.dmg,
          atkInfo.isCrit
        );
        if (leech) {
          self.hp += leech;
        }
        target.rp += target.rpOnAttacked;
        target.runAttrHooks(self, 'attacked');
      }
    },
  },

  {
    key: 'assassin.ambush',
    name: '伏击',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 400 * bonus,
        max = 600 * bonus;
      return `对目标造成${min | 0}%-${
        max | 0
      }%攻击力伤害，30秒内不能对相同的目标再次使用。连击：再次造成相同的伤害值。`;
    },
    coolDown: (level) => 5000 / (1 + level / 10),
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self, level) {
      if (!self.target) {
        return false;
      }
      return !self.target.runAttrHooks(false, 'isAmbushed');
    },
    effect(world, self, level) {
      const { target, critRate = 0, critBonus = 1.5 } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const isCrit = self.testCrit(
        self.runAttrHooks(critRate, 'ambushCritRate')
      );

      const atk = self.atk;
      const val = atk * (world.rng.skill.next() * 2 + 4) * (1 + 0.2 * level);
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );
      addCombo(target, new MeleeCombo(val));
      target.addBuff('assassin.Ambush', 30000);
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'assassin.daggerFan',
    name: '刀扇',
    coolDown: 1500,
    cost: {
      ep: 30,
    },
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 0.6 * bonus * 100,
        max = 1 * bonus * 100;
      const extra = 0.1 * bonus * 100;
      return `对所有敌人造成武器每秒伤害的${min | 0}%-${
        max | 0
      }%伤害。连击：在最终一击时再次造成武器每秒伤害的${extra.toFixed(
        1
      )}%伤害。`;
    },
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { leech = 0, atk, atkSpeed } = self;
      const rate = level * 0.2 + 1;
      const val = atk * (world.rng.skill.next() * 0.4 + 0.6) * rate * atkSpeed;

      let haveTarget = false;
      for (const target of world.units.filter((v) => self.willAttack(v))) {
        if (world.testDodge(self, target, this)) {
          continue;
        }
        haveTarget = true;
        const isCrit = self.testCrit();
        world.sendDamage(
          'melee',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * val,
          isCrit
        );
        addCombo(target, new MeleeCombo(atk * 0.1 * rate * atkSpeed));
      }

      if (haveTarget && leech) {
        self.hp += leech;
      }
    },
  },

  {
    key: 'assassin.kick',
    name: '脚踢',
    description: (level) =>
      `用力踢飞一个目标，打断其正在释放的技能，并阻止其5秒内释放相同的技能`,
    coolDown: (level) => 10000 / (1 + level * 0.1),
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      const target = world.units.find(
        (v) =>
          self.willAttack(v) &&
          ((v.casting !== null && !v.casting.notBreakable) ||
            (v.reading !== null &&
              v.reading.skill &&
              !v.reading.skill.notBreakable))
      );
      return !!target;
    },
    effect(world, self, level) {
      const target = world.units.find(
        (v) =>
          self.willAttack(v) &&
          ((v.casting !== null && !v.casting.notBreakable) ||
            (v.reading !== null &&
              v.reading.skill &&
              !v.reading.skill.notBreakable))
      );
      world.sendSkillUsage(self, null, this);
      target.breakCasting(5000);
    },
  },

  {
    key: 'assassin.swordSkill',
    name: '狂热',
    group: 'melee',
    expGroup: 'swordSkill',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      const min = 60 * bonus,
        max = 100 * bonus;
      return `对目标造成攻击力的${min | 0}%-${
        max | 0
      }%伤害。连击：使最终一击和接下来的${level + 1}秒内增加10%伤害。`;
    },
    targetType: 'target',
    isAttack: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, leech = 0, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() * 0.4 + 0.6) * (level * 0.2 + 1);
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );

      if (leech) {
        self.hp += leech;
      }

      const combo = new Combo();

      combo.effect = (world, self, finalAttack) => {
        finalAttack.atkAdd = finalAttack.atkAdd || 1;
        finalAttack.atkAdd += 0.1;
      };
      combo.postEffect = (world, self, finalAttack) => {
        finalAttack.dmg *= finalAttack.atkAdd || 1;
        finalAttack.atkAdd = null;
        self.addBuff('swordSkill', (level + 1) * 1000, 0.1);
      };
      addCombo(target, combo);

      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'assassin.thumpHead',
    group: 'finalAttack',
    name: '击颅',
    description: (level) => {
      const bonus = 1 + 0.2 * level;
      return `使目标昏迷${(level + 1) / 2}秒。最终一击：需要四个连击效果。`;
    },
    coolDown: 1000,
    maxExp(level) {
      return level ** 2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return comboCount(self.target) >= 3;
    },
    effect(world, self, level) {
      const { target, leech = 0, critRate = 0, critBonus = 1.5 } = self;
      const atkInfo: AttackLike = {
        dmg: 0,
        critRate,
        critBonus,
      };

      clearCombo(world, self, target, 0, atkInfo);
      if (world.testDodge(self, target, this)) {
        return;
      }

      // 增加buff
      target.stun((level + 1) / 2);

      // 触发连击的攻击效果
      if (atkInfo.dmg > 0) {
        world.sendDamage(
          'melee',
          self,
          target,
          this,
          self.getCritBonus(atkInfo.isCrit, atkInfo.critBonus) * atkInfo.dmg,
          atkInfo.isCrit
        );
        if (leech) {
          self.hp += leech;
        }
        target.rp += target.rpOnAttacked;
        target.runAttrHooks(self, 'attacked');
      }
    },
  },

  {
    key: 'assassin.summonPuppet',
    name: '影分身',
    coolDown: (level) => 30000 / (1 + level / 10),
    description: (level) => {
      return `召唤一个拥有你50%生命值的分身，分散敌人的注意力。同时最多存在3个分身。升级减少此技能的冷却时间。`;
    },
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    canUse(world, self) {
      return (
        world.map !== 'home' &&
        world.units.filter(
          (v) =>
            v.summoner === self &&
            v.type === 'summon.assassin.puppet' &&
            v.camp !== 'ghost'
        ).length < 3
      );
    },
    effect(world, self, level) {
      world.addEnemy('summon.assassin.puppet', null, 0, self, this);
    },
  },
  {
    key: 'summon.puppet.comeToMe',
    name: '来打我啊',
    castTime: 1500,
    coolDown: 10000,
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      for (const target of world.units.filter((v) => self.willAttack(v))) {
        target.target = self;
      }
    },
  },

  {
    key: 'assassin.dodge',
    name: '闪避',
    description: (level) =>
      `在未来5秒内，${(100 - 100 / (2 + level * 0.1)).toFixed(
        2
      )}%几率闪躲所有攻击`,
    coolDown: 15000,
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    canUse(world, self) {
      // 在自己家不吼。
      return world.map !== 'home';
    },
    effect(world, self, level) {
      const value = 2 + level * 0.1;
      self.addBuff('assassin.dodge', 5000, value);
    },
  },
];

})();

// ── 原 data/skills/knight.js ──
const __skills_4 = ((): SkillEntry[] => {
/**
 * Created by tdzl2003 on 1/31/17.
 */

function addCombo(self: UnitLike, count = 1) {
  const max = self.runAttrHooks(3, 'maxComboPoint');
  self.runAttrHooks(count, 'holyCombo');
  self.comboPoint = Math.min(max, self.comboPoint + count);
}

function useCombo(self: UnitLike, count: number) {
  self.runAttrHooks(count, 'postCostComboPoint');
  self.comboPoint -= count;
}

/**
 * isAttack: 是否伴随普通攻击。如果是的话，只有可以进行普通攻击的时候才可释放技能。
 */
return  [
  {
    key: 'knight.melee',
    name: '攻击',
    group: 'melee',
    expGroup: 'melee',
    description: level => {
      const bonus = (1+0.2*level);
      const min = 0.75*bonus*100, max = 1.25* bonus*100;
      return `正义的一击。对目标造成攻击力的${min|0}%-${max|0}%伤害，产生一点圣能。`
    },
    isAttack: true,
    maxExp(level) {
      return level**2 * 1000 + level*3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, leech = 0, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() * 0.5 + 0.75) * (level * 0.2 + 1);
      const isCrit = self.testCrit();
      world.sendDamage('melee', self, target, this, self.getCritBonus(isCrit) * val, isCrit);

      if (leech) {
        self.hp += leech;
      }
      addCombo(self);
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'knight.thump',
    group: 'thump',
    name: '重击',
    expGroup: 'thump',
    description: level => {
      const bonus = (1+0.2*level);
      const min = 250 * bonus, max = 350 * bonus;
      return `审判的一击。造成巨额的伤害。对目标造成攻击力的${min|0}%-${max|0}%伤害。需要三点圣能。`
    },
    cost: {
      comboPoint: 3,
    },
    coolDown: 500,
    maxExp(level) {
      return level**2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk, leech = 0, critRate = 0, critBonus = 1.5 } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() + 2.5) * (level/5 + 1);
      const isCrit = self.testCrit();
      world.sendDamage('melee', self, target, this, self.getCritBonus(isCrit) * val, isCrit);
      if (leech) {
        self.hp += leech;
      }
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'knight.cleave',
    name: '顺劈斩',
    group: 'melee',
    description: (level, self) => {
      const bonus = (1+0.2*level) * self.runAttrHooks(1, 'cleaveDamageRate');
      const min = 30 * bonus, max = 42 * bonus;
      return `制裁的一击。对最多三个目标分别造成(${min|0}%-${max|0}%)倍攻击力伤害，产生一点圣能。`
    },
    isAttack: true,
    maxExp(level) {
      return level**2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { atk, target, leech = 0 } = self;
      const damageRate = self.runAttrHooks(1, 'cleaveDamageRate');
      const val = atk * (world.rng.skill.next()* 0.12 + 0.3) * (level / 5 + 1) * damageRate;
      const isCrit = self.testCrit();
      world.sendDamage('melee', self, target, this, self.getCritBonus(isCrit) * val, isCrit);

      let leechRatio = 0.4;

      const extraTargets = world.units.filter(v => v !== target && self.willAttack(v)).slice(0, 2);
      extraTargets.forEach( target => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const val = atk * (world.rng.skill.next()* 0.12 + 0.3) * (level / 10 + 1);
        leechRatio += 0.4;
        world.sendDamage('melee', self, target, this, self.getCritBonus(isCrit) * val, isCrit);
        target.runAttrHooks(self, 'attacked');
      });

      if (leech) {
        self.hp += leech * leechRatio;
      }
      addCombo(self);
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'knight.whirlwind',
    name: '破邪斩',
    description: level => {
      const bonus = (1+0.2*level);
      const min = 60 * bonus, max = 80 * bonus;
      return `荣耀的一击。对全体目标造成造成攻击力的${min|0}%-${max|0}%伤害。需要三点圣能。`
    },
    coolDown: 800,
    cost: {
      comboPoint: 3,
    },
    maxExp(level) {
      return level**2 * 600 + level * 1800 + 1200;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const atk = self.atk * (level*0.2 + 1);

      const targets = world.units.filter(v => self.willAttack(v));
      const { critRate = 0, critBonus = 1.5, leech } = self;

      if (leech) {
        self.hp += leech;
      }

      targets.forEach( target => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const val = atk * (world.rng.skill.next()* 0.2 + 0.6) ;
        const isCrit = self.testCrit();
        world.sendDamage('melee', self, target, this, self.getCritBonus(isCrit) * val, isCrit);
        target.runAttrHooks(self, 'attacked');
      });
    },
  },

  {
    key: 'knight.holySign',
    name: '圣光圣印',
    group: 'sign',
    coolDown: 8000,
    description: level => {
      const bonus = 10 + 2 * level;
      return `在目标身上印上光明的圣印，每个伤害目标的人恢复其造成伤害的${bonus}%生命值，持续10秒。`;
    },
    maxExp(level) {
      return level**2 * 200 + level*600 + 400;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const bonus = 0.1 + 0.02 * level;
      const { target } = self;
      target.addBuff('knight.holySign', 10000, bonus, 'knight.sign');
    }
  },

  {
    key: 'knight.damageSign',
    name: '审判圣印',
    group: 'sign',
    coolDown: 8000,
    description: level => {
      const bonus = (1+0.2*level) * 100 * 0.4;
      return `在目标身上印上审判的圣印，当其攻击或释放技能时对周围所有你的敌人造成你攻击力的${bonus | 0}%伤害，持续10秒。`;
    },
    maxExp(level) {
      return level**2 * 200 + level*600 + 400;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const bonus = (1+0.2*level) * 0.4;
      const { target } = self;
      target.addBuff('knight.damageSign', 10000, bonus, 'knight.sign');
    }
  },

  {
    key: 'knight.thumpHead',
    name: '制裁之锤',
    expGroup: 'knight.thumpHead',
    description: level => {
      return `使目标昏迷${level+5}秒。`
    },
    coolDown: 10000,
    maxExp(level) {
      return level**2 * 300 + level * 500 + 600;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target } = self;
      target.stun(level+5);
    },
  },

  {
    key: 'knight.sacrifice',
    name: '牺牲',
    group: 'melee',
    expGroup: 'sacrifice',
    description: level => {
      const bonus = (1+0.2*level);
      const min = 1*bonus*100, max = 1.75* bonus*100;
      return `绝望的一击。对目标造成攻击力的${min|0}%-${max|0}%伤害，你自己受到${(15/bonus).toFixed(1)}%的总伤害，产生一点圣能。`
    },
    isAttack: true,
    maxExp(level) {
      return level**2 * 1000 + level*3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, leech = 0, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      let val = atk * (world.rng.skill.next() * 0.75 + 1);
      const isCrit = self.testCrit();
      world.sendDamage('melee', self, self, this, self.getCritBonus(isCrit) * val * 0.15, isCrit);
      val *= (level * 0.2 + 1);
      world.sendDamage('melee', self, target, this, self.getCritBonus(isCrit) * val, isCrit);

      if (leech) {
        self.hp += leech;
      }
      addCombo(self);
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'knight.glory',
    name: '荣耀',
    description: level => {
      return `荣耀的力量。为自己恢复${10+level}%生命值。需要三点圣能。`
    },
    coolDown: 10000,
    cost: {
      comboPoint: (unit) => unit.runAttrHooks(false, 'cheapGlory') ? 0 :3,
    },
    maxExp(level) {
      return level**2 * 200 + level * 600 + 400;
    },
    effect(world, self, level) {
      world.sendHeal(self, self, this, self.maxHp * (0.1 + level * 0.01));
      world.sendSkillUsage(self, null, this);
    },
  },
  {
    key: 'knight.reflect',
    name: '盾牌反射',
    description: level => {
      const rate = 20 + level*4;
      return `受到法术伤害时，抵挡其伤害，并对伤害来源造成${rate}%的伤害，持续${level + 5}秒。`;
    },
    maxExp(level) {
      return level**2 * 200 + level * 600 + 400;
    },
    castTime: 2000,
    coolDown: level => 20000 + level * 2000,
    effect(world, self, level) {
      self.addBuff('knight.shieldReflect', (level + 5) * 1000, 0.2 + level * 0.04);
    },
  },
  {
    key: 'knight.holyShield',
    name: '保护祝福',
    description: level => {
      return `在未来${level+3}秒内，免疫所有的物理伤害。只会在生命值小于50%时使用。同时获得三点圣能。`;
    },
    maxExp(level) {
      return level**2 * 200 + level * 600 + 400;
    },
    coolDown: level => 30000 + level * 2000,
    shouldUse(world, self) {
      return self.hp < self.maxHp / 2;
    },
    effect(world, self, level) {
      self.addBuff('holyShield', (level + 3) * 1000);
      addCombo(self, 3);
    },
  },

  {
    key: 'knight.kick',
    name: '盾击',
    description: (level) => `用盾牌冲撞敌人，打断其正在释放的技能，并阻止其5秒内释放相同的技能`,
    coolDown: level => 10000 / (1 + level * 0.1),
    maxExp(level) {
      return level**2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      const target = world.units.find(v => self.willAttack(v) && (
      (v.casting !== null && !v.casting.notBreakable) ||
      (v.reading !== null && v.reading.skill &&!v.reading.skill.notBreakable)));
      return !!target;
    },
    effect(world, self, level) {
      const target = world.units.find(v => self.willAttack(v) && (
      (v.casting !== null && !v.casting.notBreakable) ||
      (v.reading !== null && v.reading.skill && !v.reading.skill.notBreakable)));
      world.sendSkillUsage(self, null, this);
      target.breakCasting(5000);
    },
  },
  {
    key: 'knight.pray',
    name: '祈祷',
    coolDown: 20000,
    description: (level) => {
      const interval = 5 / (1 + level * 0.2);
      return `在战斗的同时念诵祈祷的颂词，在接下来10秒内每${interval.toFixed(1)}秒获得一点圣能`;
    },
    maxExp(level) {
      return level**2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      self.addBuff('knight.pray', 10005, 5000/(1 + level * 0.2), 'knight.pray');
    }
  },

  {
    key: 'knight.melee1',
    name: '驱邪术',
    coolDown: 3000,
    description: level => {
      const bonus = (1+0.2*level);
      const min = 1*bonus*100, max = 1.5* bonus*100;
      return `用圣光的力量驱散邪恶。对目标造成攻击力的${min|0}%-${max|0}%伤害。`
    },
    maxExp(level) {
      return level**2 * 1000 + level*3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, leech = 0, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() * 0.5 + 1) * (level * 0.2 + 1);
      const { critRate = 0, critBonus = 1.5 } = self;
      const isCrit = self.testCrit();
      world.sendDamage('melee', self, target, this, self.getCritBonus(isCrit) * val, isCrit);

      if (leech) {
        self.hp += leech;
      }
      target.runAttrHooks(self, 'attacked');
    },
  },
  {
    key: 'knight.deserve',
    name: '奉献',
    coolDown: 10000,
    description: (level) => {
      const bonus = (1+0.2*level);
      const min = bonus*30, max = bonus*50;
      return `将圣光灌注到脚下的土地，在接下来的8秒内每2秒对所有敌人造成攻击力的${min|0}%-${max|0}%伤害。`;
    },
    maxExp(level) {
      return level**2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      self.addBuff('knight.deserve', 10005, level, 'knight.deserve');
    }
  },
];

})();

// ── 原 data/skills/elementSummoner.js ──
const __skills_5 = ((): SkillEntry[] => {
/**
 * Created by tdzl2003 on 3/4/17.
 */

function getLevelBonus(level: number) {
  if (level <= 60) {
    return level * 0.3 + 1;
  }
  if (level <= 70) {
    return level * 0.5 + 1 - 6;
  }
  return level * 0.5 + 1 - 6;
}

return  [
  {
    key: 'summonWindBlade',
    name: '召唤奥术球',
    expGroup: 'windBlade',
    element: 'wind',
    description: (level, self) => {
      const { int } = self;
      const dmg =
        1 * getLevelBonus(self.level) * (int * 0.01 + 1) * self.dmgAdd;
      return `召唤${level + 3}个奥术球，每个对目标造成${dmg |
        0}点秘法伤害。奥术球有80%几率攻击你当前的目标。`;
    },
    coolDown: 1500,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { int, target: currentTarget } = self;
      const dmg =
        1 * getLevelBonus(self.level) * (int * 0.01 + 1) * self.dmgAdd;
      const validTargets = world.units.filter(
        v => v !== currentTarget && self.willAttack(v),
      );

      for (let i = 0; i < level + 3; i++) {
        let target = currentTarget;
        if (world.testDodge(self, target, this)) {
          return;
        }
        const isCrit = self.testCrit();
        // 如果self.target为空，是当前目标已死亡，有其它目标的情况下，剩下的秘法球都去打随机目标。
        if (validTargets.length > 0 && (!self.target || world.rng.skill.next() < 0.2)) {
          // 更换目标
          target =
            validTargets[Math.floor(world.rng.skill.next() * validTargets.length)]!;
        }
        world.sendDamage(
          'magic',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * dmg,
          isCrit,
        );
      }
    },
  },
  {
    key: 'summonFire',
    name: '召唤火焰精灵',
    coolDown: 1500,
    cost: {
      mp: self => 25 * (self.level * 0.2 + 1),
    },
    description: (level, self) => {
      const { int } = self;
      const dmg =
        5 * getLevelBonus(self.level) * (int * 0.01 + 1) * (level * 0.3 + 1);
      return `召唤一个火焰精灵，使用火球术攻击你的敌人，每次攻击造成${dmg |
        0}伤害，持续15秒。`;
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return (
        world.map !== 'home' &&
        world.units.filter(
          v =>
            v.summoner === self &&
            v.type.indexOf('summon.element.fire') >= 0 &&
            v.camp !== 'ghost',
        ).length < self.runAttrHooks(1, 'summonCount')
      );
    },
    effect(world, self, level) {
      const unit = world.addEnemy('summon.element.fire', null, 0, self, this);
      unit.addBuff('summoned', self.runAttrHooks(15000, 'summonTime'));
      self.runAttrHooks(unit, 'summonedUnit');
    },
  },
  {
    key: 'summonWater',
    name: '召唤水元素',
    coolDown: 1500,
    cost: {
      mp: self => 20 * (self.level * 0.2 + 1),
    },
    description: (level, self) => {
      const { int } = self;
      const dmg =
        4 * getLevelBonus(self.level) * (int * 0.01 + 1) * (level * 0.3 + 1);
      return `召唤一个水元素，使用水箭术攻击你的敌人，每次攻击造成${dmg |
        0}伤害，持续15秒。`;
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return (
        world.map !== 'home' &&
        world.units.filter(
          v =>
            v.summoner === self &&
            v.type.indexOf('summon.element.water') >= 0 &&
            v.camp !== 'ghost',
        ).length < self.runAttrHooks(1, 'summonCount')
      );
    },
    effect(world, self, level) {
      const unit = world.addEnemy('summon.element.water', null, 0, self, this);
      unit.addBuff('summoned', self.runAttrHooks(15000, 'summonTime'));
      self.runAttrHooks(unit, 'summonedUnit');
    },
  },
  {
    key: 'healthDrill',
    name: '生命汲取',
    castTime: 1500,
    coolDown: 10000,
    description: (level, self) => {
      const { int } = self;
      const dmg =
        10 * getLevelBonus(self.level) * (int * 0.01 + 1) * (level * 0.3 + 1);
      return `对目标造成${dmg | 0}伤害，为你恢复${10 + level}%生命值。`;
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { critRate, critBonus, target, int } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const isCrit = self.testCrit();
      const dmg =
        10 *
        getLevelBonus(self.level) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1) *
        self.dmgAdd;
      world.sendHeal(self, self, this, self.maxHp * (0.1 + level * 0.01));
      world.sendDamage(
        'magic',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * dmg,
        isCrit,
      );
    },
  },
  {
    key: 'explodeSummons',
    name: '献祭',
    castTime: 1500,
    coolDown: level => 10000,
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    description: (level, self) => {
      const { int } = self;
      // const dmg = (level * 0.3 + 1);
      return `摧毁你的一个召唤物，对所有目标造成相当于召唤物生命上限的伤害。伤害类型取决于召唤物的类型。`;
    },
    canUse(world, self) {
      return !!world.units.find(v => v.summoner === self && v.target);
    },
    effect(world, self, level) {
      const summoners = world.units.filter(
        v => v.summoner === self && v.target,
      );
      const summoner = summoners[Math.floor(world.rng.skill.next() * summoners.length)]!;

      const dmgType = summoner.runAttrHooks('magic', 'elementType');

      const dmg = summoner.maxHp * (1 + level * 0.2);
      for (const target of world.units.filter(v => self.willAttack(v))) {
        const isCrit = self.testCrit();
        world.sendDamage(
          dmgType,
          summoner,
          target,
          this,
          self.getCritBonus(isCrit) * dmg,
          isCrit,
        );
      }

      self.runAttrHooks(summoner, 'onSummonExploded');
      summoner.kill();
    },
  },
  {
    key: 'summonEarth',
    name: '召唤岩石傀儡',
    coolDown: 1500,
    cost: {
      mp: self => 30 * (self.level * 0.2 + 1),
    },
    description: (level, self) => {
      const { int } = self;
      const dmg =
        6 * getLevelBonus(self.level) * (int * 0.01 + 1) * (level * 0.3 + 1);
      return `召唤一个岩石傀儡，每次攻击造成${dmg | 0}物理伤害，持续15秒。`;
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return (
        world.map !== 'home' &&
        world.units.filter(
          v =>
            v.summoner === self &&
            v.type.indexOf('summon.element.earth') >= 0 &&
            v.camp !== 'ghost',
        ).length < self.runAttrHooks(1, 'summonCount')
      );
    },
    effect(world, self, level) {
      const unit = world.addEnemy('summon.element.earth', null, 0, self, this);
      unit.addBuff('summoned', self.runAttrHooks(15000, 'summonTime'));
      self.runAttrHooks(unit, 'summonedUnit');
    },
  },
  {
    key: 'summonLightning',
    name: '召唤闪电风暴',
    coolDown: 1500,
    cost: {
      mp: self => 30 * (self.level * 0.2 + 1),
    },
    description: (level, self) => {
      const { int } = self;
      const dmg =
        6 * getLevelBonus(self.level) * (int * 0.01 + 1) * (level * 0.3 + 1);
      return `召唤一团变幻莫测的闪电风暴，每次攻击造成${dmg |
        0}闪电伤害，持续15秒。`;
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return (
        world.map !== 'home' &&
        world.units.filter(
          v =>
            v.summoner === self &&
            v.type.indexOf('summon.element.lightning') >= 0 &&
            v.camp !== 'ghost',
        ).length < self.runAttrHooks(1, 'summonCount')
      );
    },
    effect(world, self, level) {
      const unit = world.addEnemy(
        'summon.element.lightning',
        null,
        0,
        self,
        this,
      );
      unit.addBuff('summoned', self.runAttrHooks(15000, 'summonTime'));
      self.runAttrHooks(unit, 'summonedUnit');
    },
  },
  {
    key: 'summon.earth.comeToMe',
    name: '嘲讽',
    castTime: 500,
    coolDown: 5000,
    canUse(world, self) {
      return !!self.target && self.target.target !== self;
    },
    effect(world, self, level) {
      self.target.target = self;
    },
  },
  {
    key: 'summon.disappear',
    name: '隐身术',
    description:
      '让所有以你为目标的敌人重新选择目标。升级可以减少此技能的冷却时间',
    coolDown: level => (20000 / (level + 10)) * 10,
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    effect(world, self, level) {
      world.units.forEach(v => {
        if (v.target === self) {
          v.setTarget(null);
          v.findTarget();
        }
      });
    },
  },
  {
    key: 'summon.upgrade',
    name: '升级',
    description: level =>
      `升级你的一个召唤物，使其永久存在，提升${level}%生命值和伤害并获得一个新的技能。每种元素最多升级一个。`,
    castTime: 1000,
    coolDown: level => 20000,
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      const summons = world.units.filter(
        v => v.summoner === self && v.camp !== 'ghost',
      );
      const upgrades = summons.filter(v =>
        v.runAttrHooks(false, 'summon.upgraded'),
      );
      const map: Record<string, boolean> = {};
      for (const v of upgrades) {
        map[v.runAttrHooks('magic', 'elementType')] = true;
      }
      for (const s of summons) {
        if (!map[s.runAttrHooks('magic', 'elementType')]) {
          return true;
        }
      }
      return false;
    },
    effect(world, self, level) {
      const summons = world.units.filter(
        v => v.summoner === self && v.camp !== 'ghost',
      );
      const upgrades = summons.filter(v =>
        v.runAttrHooks(false, 'summon.upgraded'),
      );
      const map: Record<string, boolean> = {};
      for (const v of upgrades) {
        map[v.runAttrHooks('magic', 'elementType')] = true;
      }
      const validSummons = summons.filter(
        v => !map[v.runAttrHooks('magic', 'elementType')],
      );
      if (!validSummons.length) {
        return;
      }
      const target =
        validSummons[Math.floor(world.rng.skill.next() * validSummons.length)]!;
      world.sendSkillUsage(self, [target], this);
      const summmonedBuff = target.runAttrHooks(null, 'getSummonedBuff');
      if (summmonedBuff) {
        summmonedBuff.stopped = true;
        target.removeBuff(summmonedBuff);
      }
      target.transformType(target.type + '.2');
      target.addBuff('summon.upgraded', null, level, 'summon.upgraded');
    },
  },
];

})();

// ── 原 data/skills/enemy.js ──
const __skills_6 = ((): SkillEntry[] => {
/**
 * Created by tdzl2003 on 2/5/17.
 */
return  [
  {
    key: 'slime.swallow',
    name: '吞噬',
    description: '吞噬一个小型史莱姆，获取对方的所有生命值。',
    coolDown: 15000,
    castTime: 1000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      const target = world.units.find((v) => {
        return (
          v !== self && self.willAssist(v) && self.maxHp - self.hp > v.maxHp
        );
      });

      return !!target;
    },
    effect(world, self, level) {
      const target = world.units.find((v) => {
        return v !== self && self.willAssist(v);
      });

      world.sendSkillUsage(self, [target], this);
      const value = target.maxHp * (1 + level * 0.1);
      world.sendHeal(self, self, this, value);
      // self.hp += value;
      world.removeUnit(target);
    },
  },
  {
    key: 'wolf.heal',
    name: '舔舐伤口',
    castTime: 2000,
    description: '用心舔舐同伴的伤口，恢复100点生命值',
    coolDown: 10000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      const target = world.units.find(
        (v) => v !== self && self.willAssist(v) && v.maxHp - v.hp >= 20
      );
      return !!target;
    },
    effect(world, self, level) {
      const target = world.units
        .filter((v) => v !== self && self.willAssist(v) && v.maxHp - v.hp >= 20)
        .sort((a, b) => b.maxHp - b.hp - (a.maxHp - a.hp))[0];
      if (!target) {
        return;
      }
      world.sendSkillUsage(self, [target], this);
      target.hp += level || 100;
    },
  },
  {
    key: 'wolf.call',
    name: '召唤狼群',
    description: '召唤伙伴来共同作战',
    castTime: 500,
    coolDown: 45000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return world.units.filter((v) => v.camp === self.camp).length < 40;
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      world.addEnemy('wolf.giant', null, 0, self);
      world.addEnemy('wolf.minimal', null, 0, self);
      world.addEnemy('wolf.minimal', null, 0, self);
    },
  },
  {
    key: 'shaman.fireball',
    name: '火球术',
    description: '造成50点火焰伤害',
    coolDown: 10000,
    castTime: 2000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      world.sendDamage('fire', self, target, this, atk * 2.5, false);
    },
  },
  {
    key: 'bomb',
    name: '爆裂',
    description: '对全体造成100点火焰伤害',
    castTime: 20000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return true;
    },
    effect(world, self, level) {
      const targets = world.units.filter((v) => self.canAttack(v));
      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        world.sendDamage('fire', self, target, this, self.atk, false);
      });
      self.kill();
    },
  },
  {
    key: 'candle.call',
    name: '驱散暗影',
    description: '召唤一大堆蜡烛',
    castTime: 500,
    coolDown: 40000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return world.units.filter((v) => v.camp === self.camp).length < 50;
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      for (let i = 0; i < 8; i++) {
        world.addEnemy('kobold.candle', null, 0, self);
      }
    },
  },
  {
    key: 'fireElement.fireball',
    name: '火球术',
    description: '造成30点火焰伤害',
    castTime: 2000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const isCrit = self.testCrit();
      world.sendDamage(
        'fire',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * atk,
        isCrit
      );
    },
  },
  {
    key: 'kakarif.melee',
    name: '火焰冲击',
    group: 'melee',
    description: '造成巨额的火焰伤害',
    targetType: 'target',
    isAttack: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { atk, target } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      world.sendDamage('fire', self, target, this, atk);
    },
  },
  {
    key: 'kakarif.mad',
    name: '卡卡列夫之怒',
    description: '增加300%攻击速度，持续4秒。',
    targetType: 'target',
    castTime: 2000,
    coolDown: 30000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      self.addBuff('kakarif.mad', 4000);
    },
  },

  {
    key: 'zombie.thumpHead',
    name: '击颅',
    group: 'thump',
    description: (level) => {
      const bonus = 1 + 0.1 * level;
      const min = 200 * bonus,
        max = 280 * bonus;
      return `对目标造成攻击力的${min | 0}%-${max | 0}%伤害，并使目标昏迷${
        (level + 1) / 2
      }秒。`;
    },
    coolDown: 15000,
    maxExp(level) {
      return level ** 2 * 150 + level * 450 + 300;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk, leech = 0, critRate = 0, critBonus = 1.5 } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() * 0.8 + 2);
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );
      if (leech) {
        self.hp += leech;
      }
      target.breakCasting();
      target.stun((level + 1) / 2);
      target.rp += target.rpOnAttacked;
      target.runAttrHooks(self, 'attacked');
    },
  },

  {
    key: 'zombie.heal',
    name: '暗影治疗',
    description:
      '治疗所有盟友100点生命。每治疗一个盟友，就对所有敌人造成10点暗影伤害',
    castTime: 2000,
    coolDown: 20000,
    maxExp(level) {
      return level ** 2 * 150 + level * 450 + 300;
    },
    canUse(world, self) {
      return true;
    },
    effect(world, self, level) {
      const healTargets = world.units.filter((v) => self.willAssist(v));
      if (healTargets.length > 0) {
        for (const target of healTargets) {
          target.hp += 100;
        }
        const dmg = 10 * healTargets.length;
        const enemies = world.units.filter((v) => self.willAttack(v));
        for (const target of enemies) {
          if (world.testDodge(self, target, this)) {
            return;
          }
          world.sendDamage('dark', self, target, this, dmg, false);
        }
      }
    },
  },
  {
    key: 'zombie.hide',
    name: '驱使亡灵',
    description: '将自己的位置移动到最后，并调整所有目标为自己的敌人',
    castTime: 1000,
    coolDown: 30589,
    effect(world, self, level) {
      world.units.remove(self);
      world.units.push(self);
      world.units.forEach((v) => {
        if (v.target === self) {
          v.setTarget(null);
          v.findTarget();
        }
      });
    },
  },
  {
    key: 'shieldShock',
    name: '盾击',
    description: (level) =>
      `反制一个目标，打断其正在释放的技能，并阻止其${
        level + 5
      }秒内释放相同的技能`,
    coolDown: (level) => 10000 + level * 1000,
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      const target = world.units.find(
        (v) =>
          self.willAttack(v) &&
          ((v.casting !== null && !v.casting.notBreakable) ||
            (v.reading !== null &&
              v.reading.skill &&
              !v.reading.skill.notBreakable))
      );
      return !!target;
    },
    effect(world, self, level) {
      const target = world.units.find(
        (v) =>
          self.willAttack(v) &&
          ((v.casting !== null && !v.casting.notBreakable) ||
            (v.reading !== null &&
              v.reading.skill &&
              !v.reading.skill.notBreakable))
      );
      if (world.testDodge(self, target, this)) {
        return;
      }
      world.sendSkillUsage(self, null, this);
      target.breakCasting(5000 + level * 1000);
    },
  },
  {
    key: 'knight.heal',
    name: '圣光术',
    description: '治疗一个队友',
    castTime: 3000,
    coolDown: 30000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      const target = world.units.find(
        (v) => v !== self && self.willAssist(v) && v.maxHp - v.hp >= 100
      );
      return !!target;
    },
    effect(world, self, level) {
      const target = world.units
        .filter(
          (v) => v !== self && self.willAssist(v) && v.maxHp - v.hp >= 100
        )
        .sort((a, b) => b.maxHp - b.hp - (a.maxHp - a.hp))[0];
      if (!target) {
        return;
      }
      world.sendSkillUsage(self, [target], this);
      target.hp += self.maxHp / 2;
    },
  },
  {
    key: 'knight.shout',
    name: '战斗怒吼',
    description: (level) =>
      `在未来30秒内增加所有同伴${(10 + level * 10) | 0}%护甲。`,
    coolDown: 30000,
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    canUse(world, self) {
      // 在自己家不吼。
      return world.map !== 'home';
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      const allAliens = world.units.filter(
        (v) => v === self || self.willAssist(v)
      );
      allAliens.forEach((target) => {
        target.addBuff('shout', 30000, 1, 'shout');
      });
    },
  },
  {
    key: 'necromancer.ghostShield',
    name: '幽魂护卫',
    description: '召唤伙伴来共同作战',
    coolDown: 30000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !world.units.find((v) => v.type === 'chapter3.undead.ghostShield');
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      world.addEnemy('chapter3.undead.ghostShield', null, 0, self);
      world.addEnemy('chapter3.undead.ghostShield', null, 0, self);
      world.addEnemy('chapter3.undead.ghostShield', null, 0, self);
    },
  },
  {
    key: 'ghostShield',
    name: '幽魂护卫',
    description: '使奈布免疫所有伤害',
    castTime: 500,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!world.units.find((v) => v.type === 'chapter3.necromancer');
    },
    effect(world, self, level) {
      const target = world.units.find((v) => v.type === 'chapter3.necromancer');
      target.addBuff('ghostShield', 1000, null, 'ghostShield');
    },
  },
  {
    key: 'shaman.darkball',
    name: '暗影箭',
    description: '造成50点暗影伤害',
    coolDown: 10000,
    castTime: 2000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      world.sendDamage('dark', self, target, this, atk * 2.5, false);
    },
  },
  {
    key: 'darkElement.darkball',
    name: '暗影箭',
    description: '造成50点暗影伤害',
    castTime: 2000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      world.sendDamage('dark', self, target, this, atk, false);
    },
  },
  {
    key: 'simba.heal',
    name: '治疗波',
    description: '治疗一个队友',
    castTime: 3000,
    coolDown: 15000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      const target = world.units.find(
        (v) => self.willAssist(v) && v.maxHp - v.hp >= 5000
      );
      return !!target;
    },
    effect(world, self, level) {
      const target = world.units
        .filter((v) => self.willAssist(v) && v.maxHp - v.hp >= 5000)
        .sort((a, b) => b.maxHp - b.hp - (a.maxHp - a.hp))[0];
      if (!target) {
        return;
      }
      world.sendSkillUsage(self, [target], this);
      target.hp += 15000;
    },
  },
  {
    key: 'simba.thumpHead',
    name: '冲撞',
    group: 'thump',
    description: (level) => {
      const bonus = 1 + 0.1 * level;
      const min = 200 * bonus,
        max = 280 * bonus;
      return `对目标造成攻击力的${min | 0}%-${max | 0}%伤害，并使目标昏迷${
        (level + 5) / 2
      }秒。`;
    },
    coolDown: 15000,
    maxExp(level) {
      return level ** 2 * 150 + level * 450 + 300;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk, leech = 0, critRate = 0, critBonus = 1.5 } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const val = atk * (world.rng.skill.next() * 0.8 + 2);
      const isCrit = self.testCrit();
      world.sendDamage(
        'melee',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * val,
        isCrit
      );
      if (leech) {
        self.hp += leech;
      }
      target.breakCasting();
      target.stun((level + 5) / 2);
      target.rp += target.rpOnAttacked;
      target.runAttrHooks(self, 'attacked');
    },
  },
  {
    key: 'shaman.iceball',
    name: '寒冰箭',
    description: '造成50点寒冷呢伤害',
    coolDown: 10000,
    castTime: 2000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      world.sendDamage('cold', self, target, this, atk * 2.5, false);
    },
  },
  {
    key: 'murloc.thumpHead',
    name: '鱼人大军',
    description: '召唤大量悍不畏死的小鱼人，向敌人发起冲锋',
    coolDown: 30000,
    effect(world, self, level) {
      self.startRead('murloc.thumpHead', 5001, null, this);
    },
  },
  {
    key: 'murloc.army.thumpHead',
    name: '冰霜冲锋',
    castTime: 3000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return true;
    },
    effect(world, self, level) {
      const { atk } = self;
      const targets = world.units.filter((v) => v.camp === 'player');
      const target = targets[Math.floor(world.rng.skill.next() * targets.length)]!;
      if (!target || world.testDodge(self, target, this)) {
        self.kill();
        return;
      }
      const val = atk * (world.rng.skill.next() * 0.8 + 2);
      world.sendDamage('cold', self, target, this, val, false);
      target.breakCasting();
      target.stun((level + 5) / 2);
      target.rp += target.rpOnAttacked;
      target.runAttrHooks(self, 'attacked');
      self.kill();
    },
  },
  {
    key: 'murloc.shieldShout',
    name: '水之庇护',
    description: (level) => `为所有同伴增加一个护盾，吸收3000点伤害。`,
    coolDown: 30000,
    castTime: 2000,
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    canUse(world, self) {
      // 在自己家不吼。
      return world.map !== 'home';
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      const allAliens = world.units.filter(
        (v) => v === self || self.willAssist(v)
      );
      allAliens.forEach((target) => {
        target.addBuff('murloc.waterShield', 30000, 3000);
      });
    },
  },

  {
    key: 'fishzilla.summonSlaves',
    name: '召唤奴隶',
    description: '召唤伙伴来共同作战',
    coolDown: 10000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return world.units.filter((v) => v.camp === self.camp).length < 20;
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      world.addEnemy('chapter3.murloc.slaves', null, 0, self);
    },
  },

  {
    key: 'fishzilla.focus',
    name: '奥术射线',
    coolDown: 10,
    canUse(world, self) {
      return !!world.units.find((v) => v.type === 'chapter3.fishzilla');
    },
    effect(world, self, level) {
      const target = world.units.find((v) => v.type === 'chapter3.fishzilla');
      if (self.target !== target) {
        self.target = target;
      }
      self.startRead('fishzilla.focus', 100000, null, this);
    },
  },

  {
    key: 'fishzilla.bomb',
    name: '冰箭乱射',
    description: '对全体敌人造成300点冰霜伤害',
    castTime: 2000,
    coolDown: (level) => 20000 - level * 1000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return true;
    },
    effect(world, self, level) {
      const { atk, critRate = 0, critBonus = 1.5 } = self;

      const targets = world.units.filter((v) => self.willAttack(v));
      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const isCrit = self.testCrit();
        world.sendDamage(
          'cold',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * atk,
          isCrit
        );
      });
    },
  },
  {
    key: 'waterElement.waterArrow',
    name: '水箭术',
    description: '造成30点冰冷伤害',
    castTime: 2000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const isCrit = self.testCrit();
      world.sendDamage(
        'cold',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * atk,
        isCrit
      );
    },
  },
  {
    key: 'waterElement.waterArrow.notBreakable',
    name: '水箭术',
    description: '造成30点冰冷伤害',
    castTime: 2000,
    notBreakable: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const isCrit = self.testCrit();
      world.sendDamage(
        'cold',
        self,
        target,
        this,
        self.getCritBonus(isCrit) * atk,
        isCrit
      );
    },
  },
  {
    key: 'azathoth.transformIce',
    name: '形态转换',
    castTime: 3000,
    notBreakable: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return self.hp < self.maxHp * 0.7;
    },
    effect(world, self, level) {
      self.transformType('chapter3.element.azathoth.ice');
    },
  },
  {
    key: 'azathoth.transformEarth',
    name: '形态转换',
    castTime: 3000,
    notBreakable: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return self.hp < self.maxHp * 0.4;
    },
    effect(world, self, level) {
      self.transformType('chapter3.element.azathoth.earth');
    },
  },
  {
    key: 'azathoth.transformDark',
    name: '形态转换',
    castTime: 3000,
    notBreakable: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return self.hp < self.maxHp * 0.2;
    },
    effect(world, self, level) {
      self.transformType('chapter3.element.azathoth.dark');
    },
  },
  {
    key: 'azathoth.explode',
    name: '同归于尽',
    castTime: 30000,
    notBreakable: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return true;
    },
    effect(world, self, level) {
      for (const target of world.units.filter((v) => self.willAttack(v))) {
        world.sendDamage('real', self, target, this, 500000, true);
      }
      self.transformType('chapter3.element.azathoth.none');
      self.kill();
    },
  },
  {
    key: 'enemy.upgrade',
    name: '愤怒',
    description: '增加10%攻击力',
    coolDown: 30000,
    effect(world, self, level) {
      self.addBuff('enemy.upgrade');
    },
  },
  {
    key: 'waterElement.waterFlow',
    name: '激流',
    description: '造成30点冰冷伤害',
    notBreakable: true,
    castTime: 4000,
    coolDown: 30000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk } = self;
      world.sendDamage('cold', self, target, this, atk * 20, false);
    },
  },

  {
    key: 'orcs.summonWolf',
    cost: {
      ep: 50,
    },
    name: '召唤狼群',
    description: '召唤伙伴来共同作战',
    castTime: 1000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return world.units.filter((v) => v.camp === self.camp).length < 20;
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      world.addEnemy('chapter3.orcs.wolf', null, 0, self);
    },
  },

  {
    key: 'wolf.worry',
    name: '撕咬',
    coolDown: 20000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target } = self;
      world.sendSkillUsage(self, [target], this);
      target.addBuff('wolf.worry', 10000, self.atk, 'wolf.worry');
    },
  },
  {
    key: 'shaman.chainingLightning',
    name: '闪电链',
    description: '对随机5个敌人造成伤害，伤害依次减少20%',
    castTime: 1000,
    coolDown: 8000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target && self.hp <= self.maxHp * 0.6;
    },
    effect(world, self, level) {
      const targets = world.units.filter((v) => self.canAttack(v));
      let value = self.atk * 4;
      for (let i = 0; i < 5; i++) {
        if (targets.length < 1) {
          break;
        }
        const id = Math.floor(world.rng.skill.next() * targets.length);
        const target = targets.splice(id, 1)[0];
        if (world.testDodge(self, target, this)) {
          continue;
        }
        world.sendDamage('lightning', self, target, this, value, false);
        value *= 0.8;
      }
    },
  },

  {
    key: 'lightningElement.chainingLightning',
    name: '闪电链',
    description: '对随机3个敌人造成伤害，伤害依次减少20%',
    castTime: 2000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { atk, critRate = 0, critBonus = 1.5 } = self;

      const isCrit = world.rng.skill.next() < critRate;

      const targets = world.units.filter((v) => self.canAttack(v));
      let value = isCrit ? atk * critBonus : atk;
      for (let i = 0; i < 3; i++) {
        if (targets.length < 1) {
          break;
        }
        const id = Math.floor(world.rng.skill.next() * targets.length);
        const target = targets.splice(id, 1)[0];
        if (world.testDodge(self, target, this)) {
          continue;
        }
        world.sendDamage('lightning', self, target, this, value, isCrit);
        value *= 0.8;
      }
    },
  },

  {
    key: 'lightningElement.stunAll',
    name: '乱雷',
    coolDown: 10000,
    castTime: 1000,
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { atk, critRate = 0, critBonus = 1.5 } = self;
      const targets = world.units.filter((v) => self.willAttack(v));

      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const val = atk * (world.rng.skill.next() * 0.4 + 0.6) * (1 + 0.2 * level);
        const isCrit = self.testCrit();
        world.sendDamage(
          'lightning',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * val,
          isCrit
        );
        target.stun(level + 2);
        target.breakCasting();
        target.rp += target.rpOnAttacked;
        target.runAttrHooks(self, 'attacked');
      });
    },
  },

  {
    key: 'orcs.summonHealToken',
    name: '治疗图腾',
    description: '召唤伙伴来共同作战',
    castTime: 1000,
    coolDown: 15000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return (
        world.units.filter((v) => v.camp === self.camp).length < 20 &&
        self.hp <= self.maxHp * 0.3
      );
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      world.addEnemy('chapter3.orcs.totem', null, 0, self);
    },
  },

  {
    key: 'totem.heal',
    name: '治愈之雨',
    description: '治疗所有盟友100点生命。',
    castTime: 1000,
    maxExp(level) {
      return level ** 2 * 150 + level * 450 + 300;
    },
    canUse(world, self) {
      return true;
    },
    effect(world, self, level) {
      const healTargets = world.units.filter(
        (v) => self !== v && self.willAssist(v)
      );
      for (const target of healTargets) {
        target.hp += 10000;
      }
    },
  },

  {
    key: 'chapter4.humans.seck.summonDarkSoul',
    name: '召唤虚空行者',
    coolDown: 1500,
    cost: {
      mp: 1000,
    },
    description: (level, self) => {
      const { int } = self;
      const dmg =
        5 *
        (self.level * UNIT_LEVEL_RATE + 1) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1);
      return `召唤一个火焰精灵，使用火球术攻击你的敌人，每次攻击造成${
        dmg | 0
      }伤害，持续15秒。`;
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return (
        world.units.filter((v) => v.type === 'chapter4.humans.monster').length <
        1
      );
    },
    effect(world, self, level) {
      const unit = world.addEnemy(
        'chapter4.humans.monster',
        null,
        0,
        self,
        this
      );
      self.runAttrHooks(unit, 'summonedUnit');
    },
  },
  {
    key: 'chapter4.humans.seck.healthDrill',
    name: '生命汲取',
    castTime: 3000,
    coolDown: 18000,
    description: (level, self) => {
      const { int } = self;
      const dmg =
        10 *
        (self.level * UNIT_LEVEL_RATE + 1) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1);
      return `对目标造成${dmg | 0}伤害，为你恢复${10 + level}%生命值。`;
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { atk, target } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      const dmg = atk * 2;
      world.sendHeal(self, self, this, self.maxHp * (0.1 + level * 0.01));
      world.sendDamage('dark', self, target, this, dmg);
    },
  },
  {
    key: 'chapter4.humans.women.thumpHead',
    name: '魅惑',
    group: 'thump',
    description: (level) => {
      const bonus = 1 + 0.1 * level;
      const min = 200 * bonus,
        max = 280 * bonus;
      return `对目标造成攻击力的${min | 0}%-${max | 0}%伤害，并使目标昏迷${
        (level + 5) / 2
      }秒。`;
    },
    coolDown: 15000,
    maxExp(level) {
      return level ** 2 * 150 + level * 450 + 300;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      target.breakCasting();
      target.stun(5);
    },
  },
  {
    key: 'chapter4.humans.seck.summonWomen',
    name: '召唤魅魔',
    coolDown: 1500,
    cost: {
      mp: 1000,
    },
    description: (level, self) => {
      const { int } = self;
      const dmg =
        5 *
        (self.level * UNIT_LEVEL_RATE + 1) *
        (int * 0.01 + 1) *
        (level * 0.3 + 1);
      return `召唤一个火焰精灵，使用火球术攻击你的敌人，每次攻击造成${
        dmg | 0
      }伤害，持续15秒。`;
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return (
        world.units.filter((v) => v.type === 'chapter4.humans.women').length < 2
      );
    },
    effect(world, self, level) {
      const unit = world.addEnemy('chapter4.humans.women', null, 0, self, this);
      self.runAttrHooks(unit, 'summonedUnit');
    },
  },

  {
    key: 'knight.glory.enemy',
    name: '荣耀',
    description: (level) => {
      return `荣耀的力量。为自己恢复${10 + level}%生命值。需要三点圣能。`;
    },
    cost: {
      comboPoint: 3,
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return true;
    },
    effect(world, self, level) {
      const target = world.units
        .filter((v) => self.willAssist(v))
        .sort((a, b) => b.maxHp - b.hp - (a.maxHp - a.hp))[0];
      if (target) {
        world.sendHeal(self, target, this, self.maxHp * (0.1 + level * 0.01));
        world.sendSkillUsage(self, null, this);
      }
    },
  },

  {
    key: 'knight.thumpHead.enemy',
    name: '制裁之锤',
    expGroup: 'knight.thumpHead',
    description: (level) => {
      return `使目标昏迷${level + 3}秒。`;
    },
    coolDown: 10000,
    maxExp(level) {
      return level ** 2 * 300 + level * 500 + 600;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target } = self;
      target.stun(level + 3);
    },
  },

  {
    key: 'enemy.fearas.summonTrigger',
    name: '召唤陷阱',
    description: (level) => {
      return `召唤一个随机品牌的地雷。当心！`;
    },
    coolDown: 2000,
    maxExp(level) {
      return level ** 2 * 300 + level * 500 + 600;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      world.sendSkillUsage(self, null, this);
      const types = [
        'chapter4.humans.trigger.5.1',
        'chapter4.humans.trigger.5.2',
        'chapter4.humans.trigger.5.3',
        'chapter4.humans.trigger.5.4',
      ];
      const type = types[Math.floor(world.rng.skill.next() * types.length)]!;

      world.addEnemy(type, null, 0, self);

      if (type === types[3]) {
        world.sendGeneralMsg('额，拿错了。');
      } else {
        world.sendGeneralMsg('菲尔斯放置了一个地雷，快拆掉它！');
      }
    },
  },
  {
    key: 'enemy.fearas.bomb',
    name: '爆裂',
    description: '对全体造成100点火焰伤害',
    castTime: 5000,
    notBreakable: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return true;
    },
    effect(world, self, level) {
      const targets = world.units.filter((v) => self.canAttack(v));
      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        world.sendDamage('fire', self, target, this, self.atk, false);
      });
      self.kill();
    },
  },
  {
    key: 'enemy.fearas.bomb1',
    name: '爆裂',
    description: '对全体造成100点火焰伤害',
    castTime: 5000,
    notBreakable: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return true;
    },
    effect(world, self, level) {
      world.sendGeneralMsg('这是一颗哑炮。');
      self.kill();
    },
  },
  {
    key: 'enemy.fearas.bomb2',
    name: '损坏',
    description: '一会就坏了',
    castTime: 5000,
    notBreakable: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return true;
    },
    effect(world, self, level) {
      self.kill();
    },
  },

  {
    key: 'enemy.evil.reading1',
    name: '精神鞭笞',
    description: '造成持续的伤害',
    notBreakable: true,
    coolDown: 15000,
    effect(world, self, level) {
      self.startRead('enemy.evil.reading1', 5001, null, this);
    },
  },

  {
    key: 'enemy.evil.control',
    name: '精神控制',
    description: '造成持续的伤害',
    notBreakable: true,
    coolDown: 10000,
    castTime: 500,
    canUse(world, self) {
      return !!world.units.find(
        (unit) => unit.type === 'chapter4.humans.boss.milhous'
      );
    },
    effect(world, self, level) {
      const target = world.units.find(
        (unit) => unit.type === 'chapter4.humans.boss.milhous'
      );
      if (target) {
        target.addBuff('enemy.evil.control', null, null, 'control');
      }
      world.sendGeneralMsg('米尔豪斯晕了头！快让他恢复正常！');
    },
  },

  {
    key: 'silver.sorceress.boss.1.bolt',
    name: '奥术冲击',
    description: '造成50点火焰伤害',
    castTime: 2000,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target, atk } = self;
      if (world.testDodge(self, target, this)) {
        return;
      }
      world.sendDamage('magic', self, target, this, atk * 10, false);
    },
  },
  {
    key: 'earthElement.recovery',
    name: '修复',
    coolDown: 18000,
    castTime: 2000,
    description: (level) => {
      return `荣耀的力量。为自己恢复${10 + level}%生命值。需要三点圣能。`;
    },
    maxExp(level) {
      return level ** 2 * 200 + level * 600 + 400;
    },
    canUse(world, self) {
      return self.hp < self.maxHp;
    },
    effect(world, self, level) {
      world.sendHeal(self, self, this, self.maxHp * 0.3);
      world.sendSkillUsage(self, null, this);
    },
  },
  {
    key: 'fireElement.flameStrike',
    name: '烈焰风暴',
    maxExp(level) {
      return level ** 2 * 100 + level * 300 + 200;
    },
    castTime: 3000,
    coolDown: 25000,
    canUse(world, self) {
      return !!self.target;
    },
    description: (level, self) => {
      const { atk } = self;
      return `对所有敌人造成${atk}点伤害。`;
    },
    effect(world, self, level) {
      const { atk, critRate, critBonus } = self;
      const targets = world.units.filter((v) => self.willAttack(v));

      targets.forEach((target) => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const isCrit = self.testCrit();
        world.sendDamage(
          'fire',
          self,
          target,
          this,
          self.getCritBonus(isCrit) * atk,
          isCrit
        );
      });
    },
  },
  {
    key: 'shamansa.spew',
    name: '呕吐',
    maxExp(level) {
      return 1e20;
    },
    coolDown: 25000,
    notBreakable: true,
    canUse(world, self) {
      return !!self.target;
    },
    description: '将刚吃下去的吐出来',
    effect(world, self, level) {
      self.startRead('shamansa.spew', 5001, null, this);
    },
  },
  {
    key: 'rosa.sleepy',
    name: '昏昏欲睡',
    description: (level) => {
      const bonus = 1 + 0.1 * level;
      const min = 200 * bonus,
        max = 280 * bonus;
      return `对目标造成攻击力的${min | 0}%-${max | 0}%伤害，并使目标昏迷${
        (level + 5) / 2
      }秒。`;
    },
    coolDown: 15000,
    maxExp(level) {
      return level ** 2 * 150 + level * 450 + 300;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const targets = world.units.filter((v) => self.canAttack(v));

      for (const target of targets) {
        target.breakCasting();
        target.stun(5);
      }
    },
  },
  {
    key: 'rosa.angry',
    name: '起床气',
    description: '增加300%攻击速度，持续4秒。',
    targetType: 'target',
    castTime: 3000,
    coolDown: 30000,
    notBreakable: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      self.addBuff('rosa.angry', 5000);
    },
  },

  {
    key: 'chapter5.daughter.monster2',
    name: '幽闭',
    description: (level) => {
      return `使目标昏迷${level + 3}秒。`;
    },
    coolDown: 10000,
    castTime: 3000,
    maxExp(level) {
      return level ** 2 * 300 + level * 500 + 600;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      const { target } = self;
      target.breakCasting();
      target.stun(5);
    },
  },

  {
    key: 'chapter5.daughter.monster4',
    name: '惊慌失措',
    description: '增加300%攻击速度，持续4秒。',
    targetType: 'target',
    castTime: 3000,
    coolDown: 30000,
    notBreakable: true,
    maxExp(level) {
      return level ** 2 * 1000 + level * 3000 + 2000;
    },
    canUse(world, self) {
      return !!self.target;
    },
    effect(world, self, level) {
      self.addBuff('rosa.angry', 5000);
    },
  },
];

})();

export const skills: Record<string, SkillEntry> = arrayToMap([
  ...__skills_0,
  ...__skills_1,
  ...__skills_2,
  ...__skills_3,
  ...__skills_4,
  ...__skills_5,
  ...__skills_6,
]);
