/**
 * ⚠️ 由原版 `data/buffs/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 词缀 / 传奇的 `generate(level)` 改为 `generate(level, rng)`，内部 `Math.random()` → `rng()`。
 */

import type { AttackLike, BuffEntry, BuffStateLike, ComboLike, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/buffs/warrior.js ──
const __buffs_0 = ((): BuffEntry[] => {
/**
 * Created by tdzl2003 on 2/3/17.
 */

return  [
  {
    key: 'swordSkill',
    name: '狂热',
    description: '伤害增加百分比',
    hooks: {
      atkAdd(value){
        return this.arg + value;
      },
    },
  },
  {
    key: 'shout',
    name: '战斗怒吼',
    description: '护甲增加百分比',
    hooks: {
      defAdd(value){
        return this.arg + value;
      },
    },
  },
  {
    key: 'commandShout',
    name: '命令怒吼',
    description: '生命上限增加百分比',
    hooks: {
      maxHpAdd(value){
        return this.arg + value;
      },
    },
  },
  {
    key: 'shoutShake',
    name: '震慑怒吼',
    description: '伤害增加百分比',
    hooks: {
      atkMul(value){
        return this.arg * value;
      },
    },
  },
  {
    key: 'stunned',
    name: '昏迷',
    description: '不能行动',
    didRemove() {
      this.unit.timeline.resume();
      this.unit.tryUseSkill(this.unit.canUseSkill());
    },
    didAppear() {
      this.unit.timeline.pause();
    },
    hooks: {
      stunned(val) {
        return true;
      },
    },
  },
];

})();

// ── 原 data/buffs/enemies.js ──
const __buffs_1 = ((): BuffEntry[] => {
/**
 * Created by tdzl2003 on 2/3/17.
 */

return  [
  {
    key: 'kakarif.mad',
    name: '狂热',
    description: '增加卡卡列夫攻击速度',
    hooks: {
      atkSpeedMul(value){
        return value * 4;
      },
    },
  },
  {
    key: 'shieldReflect',
    name: '盾牌反射',
    description: '反射所有法术伤害',
    hooks: {
      shieldReflect: (v, type) => {
        return type !== 'melee' ? 0.2 : undefined;
      },
    },
  },
  {
    key: 'ghostShield',
    name: '幽魂护盾',
    hooks: {
      absorbed(val) {
        // 吸收全部伤害
        return 0;
      },
    },
  },
  {
    key: 'murloc.thumpHead',
    name: '鱼人大军',
    effectInterval: 500,
    effect(world){
      world.addEnemy('chapter3.murloc.army', null, 0, this.unit);
    },
  },
  {
    key: 'murloc.waterShield',
    name: '水泡护盾',
    description() {
      return '吸收伤害';
    },
    hooks: {
      absorbed(val) {
        const total = this.arg;
        const absorb = Math.min(val, total);
        this.arg -= absorb;
        if (this.arg <= 0.001) {
          // 伤害吸收完毕
          this.over();
        }
        return val - absorb;
      },
    },
  },
  {
    key: 'fishzilla.focus',
    name: '奥术射线',
    hidden: true,
    description() {
      return '使目标受到的所有伤害提升100%';
    },
    didAppear() {
      if (this.unit.target) {
        this.targetBuff = this.unit.target.addBuff('fishzilla.focused');
      }
    },
    willRemove() {
      if (this.targetBuff) {
        this.targetBuff.unit.removeBuff(this.targetBuff);
        this.targetBuff = null;
      }
    }
  },
  {
    key: 'fishzilla.focused',
    name: '奥术射线',
    notSave: true,
    description() {
      return '使目标受到的所有伤害提升100%';
    },
    hooks: {
      willDamaged(val, from) {
        return val * 2;
      },
    }
  },
  {
    key: 'nynnroth.shield',
    name: '定海',
    description: '减少所受的90%冰冷伤害',
    hooks: {
      willDamaged(value, to, damageType){
        if (damageType === 'cold') {
          return value / 10;
        }
        return value;
      },
    },
  },
  {
    key: 'enemy.upgrade',
    name: '愤怒',
    description: '增加攻击力',
    hooks: {
      atkAdd(value) {
        return value + 0.1;
      },
    },
  },
  {
    key: 'wolf.worry',
    name: '撕咬',
    effectInterval: 2000,
    effect(world){
      world.sendDamage('melee', null, this.unit, null, this.arg, false);
    },
  },
  {
    key: 'enemy.evil.reading1',
    name: '精神鞭笞',
    effectInterval: 500,
    effect(world){
      const self = this.unit;
      const { target } = self;
      if (!target) {
        self.removeBuff(this);
        return;
      }
      world.sendDamage('dark', self, target, this.skill, self.atk * 0.2, false);
    },
  },

  {
    key: 'enemy.evil.control',
    name: '精神控制',
    didAppear() {
      this.unit.setCamp('enemy');
    },
    willRemove() {
      this.unit.setCamp('alien');
    },
  },

  {
    key: 'shamansa.spew',
    name: '呕吐',
    effectInterval: 500,
    effect(world){
      world.addEnemy('chapter5.woodElf.arms', null, 0, this.unit);
    },
  },

  {
    key: 'rosa.angry',
    name: '狂热',
    description: '增加卡卡列夫攻击速度',
    hooks: {
      atkSpeedMul(value){
        return value * 4;
      },
    },
  },
];

})();

// ── 原 data/buffs/sorceress.js ──
const __buffs_2 = ((): BuffEntry[] => {
/**
 * Created by tdzl2003 on 3/4/17.
 */

function addColdAir(target: UnitLike) {
  const buff = target.buffs.find(v => v.group === 'coldAir');
  if (buff) {
    buff.arg = Math.min(buff.arg + 0.01, 0.99);
  } else {
    target.addBuff('coldAir', null, 0.01, 'coldAir');
  }
}

return  [
  {
    key: 'cold',
    name: '寒冷',
    description: '所有行动减缓20%。',
    hooks: {
      cold(val) {
        return true;
      },
      speedRateMul: val => val * 0.8,
    },
  },
  {
    key: 'coldAir',
    name: '冻气',
    description: '所有行动减缓。',
    hooks: {
      cold(val) {
        return true;
      },
      speedRateMul(val) {
        return val * (1 - (this.arg || 0));
      },
    },
  },
  {
    key: 'freezed',
    name: '冻结',
    description: '不能行动',
    hooks: {
      freezed(val) {
        return this;
      },
    },
    willRemove() {
      this.unit.timeline.resume();
      this.unit.tryUseSkill(this.unit.canUseSkill());
    },
    didAppear() {
      this.unit.timeline.pause();
    }
  },
  {
    key: 'magicShield',
    name: '魔法盾',
    description() {
      return '消耗魔法并吸收伤害';
    },
    hooks: {
      haveMagicShield(){
        return true;
      },
      absorbed(val) {
        const { unit } = this;
        const rate = (this.arg as unknown as [number, number])[0];
        const total = (this.arg as unknown as [number, number])[1];
        const absorb = Math.min(val, total, rate * unit.mp);
        const cost = absorb/rate;
        unit.mp -= cost;
        unit.runAttrHooks(cost, 'postCostMp');
        (this.arg as unknown as [number, number])[1] -= absorb;
        if ((this.arg as unknown as [number, number])[1] <= 0.001) {
          // 伤害吸收完毕
          this.over();
        }
        return val - absorb;
      },
    },
  },
  {
    key: 'iceShield',
    name: '冰霜护盾',
    description() {
      return '冰冻攻击者';
    },
    hooks: {
      def(value) {
        return value + this.arg;
      },
      attacked(from) {
        const { unit } = this;
        if (Math.random() < Number(unit.runAttrHooks(false, 'soCold'))) {
          if (!from.stun(3, 'freezed')) {
            // 冻结被抵抗，依然减速。
            from.addBuff('cold', 3000, null, 'cold');
          }
        } else {
          from.addBuff('cold', 3000, null, 'cold');
        }
        if (unit.runAttrHooks(false, 'coldAir')) {
          addColdAir(from);
        }
        return from;
      },
    },
  },
  {
    key: 'transform',
    name: '变形术',
    description: '变形',
    hooks: {
      transformed(val) {
        return true;
      },
      displayName(val) {
        return `[${this.arg}]${val}`;
      },
      damaged(val) {
        if (val > 0) {
          this.over();
        }
        return val;
      }
    },
    willRemove() {
      this.unit.timeline.resume();
      this.unit.tryUseSkill(this.unit.canUseSkill());
    },
    didAppear() {
      this.unit.timeline.pause();
    }
  },
  {
    key: 'fireShield',
    name: '烈焰护盾',
    description() {
      return '增加暴击几率和暴击伤害';
    },
    hooks: {
      critRate(value) {
        return value + 0.2;
      },
      critBonus(value) {
        return value + this.arg;
      },
    },
  },
  {
    key: 'flaming',
    name: '燃尽',
    hidden: true,
    description() {
      return '造成持续的火焰伤害';
    },
    effectInterval: 1000,
    effect(world){
      world.sendDamage('fire', null, this.unit, null, this.arg, 0);
    },
  },
  {
    key: 'awaking',
    name: '唤醒',
    hidden: true,
    hooks: {
      mpRecovery(value) {
        return value + this.arg;
      }
    }
  },
  {
    key: 'magicState',
    name: '法力共鸣',
    hidden: true,
    description() {
      return '下一个不同系的法术将使你的攻击力上升10%，持续5秒';
    },
  },
  {
    key: 'magicArtist',
    name: '法力交织',
    description: '伤害增加百分比',
    hooks: {
      dmgAdd(value){
        return this.arg + value;
      },
    },
  },
  {
    key: 'manaShield',
    name: '法力护盾',
    description() {
      return '吸收伤害';
    },
    hooks: {
      absorbed(val) {
        const { unit } = this;
        const total = this.arg;
        const absorb = Math.min(val, total);
        this.arg -= absorb;
        if (this.arg <= 0.001) {
          // 伤害吸收完毕
          this.over();
        }
        return val - absorb;
      },
    },
  },
];

})();

// ── 原 data/buffs/assassin.js ──
const __buffs_3 = ((): BuffEntry[] => {
/**
 * Created by tdzl2003 on 2/3/17.
 */

return  [
  {
    key: 'assassin.cutting',
    name: '切割',
    description: '增加攻击速度和能量恢复速度',
    hooks: {
      atkSpeed(value) {
        return this.arg * value;
      },
      epRecoveryMul(value) {
        return this.arg * value;
      },
    },
  },
  {
    key: 'assassin.Ambush',
    name: '伏击',
    notRemoveWhenTransform: true,
    description: '不能再次被伏击',
    hooks: {
      isAmbushed(value) {
        return true;
      },
    },
  },
  {
    key: 'assassin.dodge',
    name: '闪避',
    description: '几率闪避所有攻击',
    hooks: {
      noDodgeRate(value) {
        return value / this.arg;
      },
    },
  },
  {
    key: 'assassin.prevertDeath',
    name: '假死',
    description: '减少所受所有伤害的90%',
    hooks: {
      willDamaged(value) {
        return value * 0.1;
      },
    },
  },
  {
    key: 'assassin.prevertDeathCD',
    name: '假死冷却',
    description: '最近激活过了假死，不能再次激活',
    hooks: {},
  },
];

})();

// ── 原 data/buffs/knight.js ──
const __buffs_4 = ((): BuffEntry[] => {
/**
 * Created by tdzl2003 on 2/3/17.
 */

function addCombo(self: UnitLike, count = 1) {
  const max = self.runAttrHooks(3, 'maxComboPoint');
  self.runAttrHooks(count, 'holyCombo');
  self.comboPoint = Math.min(max, self.comboPoint + count);
}

return  [
  {
    key: 'knight.holySign',
    name: '圣光圣印',
    description: '恢复攻击者的生命值',
    hooks: {
      damaged(value, from) {
        from.hp += value * this.arg;
        return value;
      },
    },
  },
  {
    key: 'knight.damageSign',
    name: '审判圣印',
    description: '恢复攻击者的生命值',
    hooks: {
      preskill(skill, world) {
        const bonus = this.arg;
        const { playerUnit } = world;
        if (!playerUnit) {
          return;
        }
        const { atk } = playerUnit;
        const targets = world.units.filter(v=>playerUnit.willAttack(v));
        for (const target of targets) {
          if (world.testDodge(playerUnit, target, this)) {
            return;
          }
          const val = atk * bonus ;
          const crit = playerUnit.testCrit();
          const critBonus = playerUnit.getCritBonus(crit);
          world.sendDamage('holy', playerUnit, target, {name: '审判圣印'}, val * critBonus, crit);
        }
      },
    },
  },
  {
    key: 'knight.shieldReflect',
    name: '盾牌反射',
    description: '反射所有法术伤害',
    hooks: {
      shieldReflect(v, type) {
        return type !== 'melee' && type !== 'real' ? this.arg : 0;
      },
    },
  },
  {
    key: 'holyShield',
    name: '圣盾术',
    hooks: {
      absorbed(val, type) {
        // 吸收全部伤害
        if (type === 'melee') {
          return 0;
        }
        return val;
      },
    },
  },
  {
    key: 'knight.pray',
    name: '祈祷',
    effectInterval() {
      return this.arg;
    },
    effect(world) {
      const { unit } = this;
      if (unit) {
        addCombo(unit);
      }
    },
  },
  {
    key: 'knight.deserve',
    name: '奉献',
    effectInterval: 2000,
    effect(world) {
      const { unit : self, arg: level } = this;
      if (!self) {
        return;
      }
      const atk = self.atk * (level*0.2 + 1);

      const targets = world.units.filter(v => self.willAttack(v));
      const { critRate = 0, critBonus = 1.5 } = self;

      targets.forEach( target => {
        if (world.testDodge(self, target, this)) {
          return;
        }
        const val = atk * (Math.random()* 0.2 + 0.3) ;
        const crit = self.testCrit();
        const critBonus = self.getCritBonus(crit);
        world.sendDamage('melee', self, target, this.skill, val * critBonus, crit);
        target.runAttrHooks(self, 'attacked');
      });
    },
  },
];

})();

// ── 原 data/buffs/simba.js ──
const __buffs_5 = ((): BuffEntry[] => {
/**
 * Created by tdzl2003 on 2/3/17.
 */

return  [
  {
    key: 'simba.comeOnFriends',
    name: '好兄弟加油',
    hooks: {
      speedRate: (value) => value * 2,
    },
  },
  {
    key: 'simba.goodFriends',
    name: '好兄弟',
    hooks: {
      willClean(value, self, world) {
        const brothers = world.units.filter(v => v !== self && v.runAttrHooks(false, 'simba.goodFriends'));

        let someAlive = false;
        for (const b of brothers) {
          if (b.camp !== 'ghost') {
            b.addBuff('simba.comeOnFriends');
            someAlive = true;
          }
        }

        if (someAlive) {
          return false;
        }
        for (const friend of brothers) {
          friend.setCleanTimer();
        }
        return value;
      }
    },
  }
];

})();

// ── 原 data/buffs/elementSummoner.js ──
const __buffs_6 = ((): BuffEntry[] => {
/**
 * Created by tdzl2003 on 3/4/17.
 */


return  [
  {
    key: 'summoned',
    name: '召唤生物',
    hidden: true,
    description: '到点就挂',
    hooks: {
      getSummonedBuff(value) {
        return this;
      }
    },
    willRemove() {
      if (this.unit.camp !== 'ghost' && !this.stopped) {
        this.unit.kill();
      }
    },
  },
  {
    key: 'summon.upgraded',
    name: '升级',
    description: '升级了',
    notRemoveWhenTransform: true,
    hooks: {
      atkMul(val) {
        return val * (this.arg / 100 + 1);
      },
      maxHpMul(val) {
        return val * (this.arg / 100 + 1);
      },
      'summon.upgraded': function() {
        return true;
      }
    }
  },
  {
    key: 'legend-wand-1',
    name: '鞭笞',
    description: '攻击速度增加100%',
    hooks: {
      speedRateMul(value) {
        return value * 2;
      }
    },
  },
];

})();

// ── 原 data/buffs/shrine.js ──
const __buffs_7 = ((): BuffEntry[] => {
/**
 * Created by tdzl2003 on 5/6/17.
 */

return  [
  {
    key: 'shrine.energy',
    name: '能量圣殿',
    description: '恢复能量速度提高',
    hooks: {
      mpRecovery(value) {
        return value + this.unit.maxMp * 0.1;
      },
      rpReceiveMul(value) {
        return value * 3;
      },
      epRecoveryMul(value) {
        return value * 3;
      },
    },
  },
  {
    key: 'shrine.power',
    name: '威能圣殿',
    description: '恢复能量速度提高',
    hooks: {
      atkMul(value) {
        return value * 1.5;
      },
      dmgMul(value) {
        return value * 1.5;
      },
    },
  },
];

})();

export const buffs: Record<string, BuffEntry> = arrayToMap([
  ...__buffs_0,
  ...__buffs_1,
  ...__buffs_2,
  ...__buffs_3,
  ...__buffs_4,
  ...__buffs_5,
  ...__buffs_6,
  ...__buffs_7,
]);
