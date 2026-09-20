/**
 * ⚠️ 由原版 `data/goods/` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 `ai-docs/pending-data-port.md`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，`module.exports = X` 变为 `return X`；
 *  - 函数体的 `this` / `world` / `self` 由 `_shapes.ts` 的视图类型提供上下文，契约参数类型不变；
 *  - 随机一律走注入的 `Rng` 端口，本文件**零** `Math.random()`：
 *    词缀 / 传奇的 `generate` 用形参 `rng`；技能 / buff / 强化 hook 用 `world.rng.skill`（标签 `'skill'`）。
 */

import type { AttackLike, BuffStateLike, ComboLike, GoodEntry, UnitLike, WorldLike } from './_shapes.js';
import { arrayToMap } from './_util.js';

// ── 原 data/goods/junks.js ──
const __goods_0 = ((): GoodEntry[] => {
/**
 * Created by tdzl2003 on 2/2/17.
 */

return  [
  {
    key: 'mucus',
    type: 'junk',
    name: '粘液',
    description: '黏糊糊的一团，不小心咽下去可能会窒息。',
    stack: 9999,
    price: 1,
  },
  {
    key: 'boneFragment',
    type: 'junk',
    name: '碎骨',
    description: '骨头的碎片，已经看不清来自什么生物，希望不是人类……',
    stack: 9999,
    price: 2,
  },
  {
    key: 'furFragment',
    type: 'junk',
    name: '破烂的毛皮',
    description: '破破烂烂的兽皮，没有办法缝合了。',
    stack: 9999,
    price: 4,
  },
  {
    key: 'animalMeat',
    type: 'junk',
    name: '新鲜的肉',
    description: '肉很新鲜，喜欢它的不止是人类……',
    stack: 9999,
    price: 8,
  },

  {
    key: 'candle',
    type: 'junk',
    name: '破烂的蜡烛',
    description: '传说蜡烛帮狗头人驱散了恐怖的暗影，带来了光明，是狗头人最珍视的宝物。',
    stack: 9999,
    price: 12,
  },
  {
    key: 'zombieMeat',
    type: 'junk',
    name: '僵尸肉',
    description: '僵尸的肉，散发着奇怪的臭气。就这也有人收购，简直细思极恐……',
    stack: 9999,
    price: 12,
  },
  {
    key: 'junkEquips',
    type: 'junk',
    name: '破损的装甲',
    description: '圣堂教会剩骑士的装备，看起来被擦洗了无数遍。剩骑士真是很穷的一种职业……',
    stack: 9999,
    price: 20,
  },
  {
    key: 'elementJunk',
    type: 'junk',
    name: '无用的元素颗粒',
    description: '来自元素位面的物质，但已经丝毫没有了元素的波动。',
    stack: 9999,
    price: 20,
  },
  {
    key: 'wood',
    type: 'material',
    name: '木块',
    description: '一块普通木头。',
    quality: 1,
    price: 5,
    stack: 9999,
  },
  {
    key: 'stick',
    type: 'material',
    name: '树枝',
    quality: 0,
    description: '一小段树枝，削尖了也许可以当武器用。',
    price: 2,
    stack: 9999,
  },
  {
    key: 'cloth',
    type: 'material',
    name: '破布',
    quality: 0,
    description: '一小片破布，已经看不出原本的颜色了。',
    price: 2,
    stack: 9999,
  },
  {
    key: 'fur',
    type: 'material',
    name: '完整的毛皮',
    description: '一块完整的兽皮。看起来就很保暖。',
    quality: 0,
    price: 5,
    stack: 9999,
  },
  {
    key: 'animalBone',
    type: 'material',
    name: '兽骨',
    description: '一块很完整的兽骨。布帕阿姨家的汪会很喜欢。',
    quality: 0,
    price: 5,
    stack: 9999,
  },
  {
    key: 'wolfTeeth',
    type: 'material',
    name: '狼牙',
    description: '无比锋利的狼牙，还在闪闪发光。',
    quality: 1,
    price: 15,
    stack: 9999,
  },

  // 第二章道具
  {
    key: 'copper',
    type: 'material',
    name: '红铜',
    stack: 9999,
    description: '天然的高纯度铜矿，延展性很不错，就是有些软。',
    quality: 0,
    price: 20,
  },
  {
    key: 'stannum',
    type: 'material',
    name: '锡石',
    stack: 9999,
    description: '锡的氧化物，需要先进行熔炼方可进行锻造。',
    quality: 0,
    price: 40,
  },
  {
    key: 'fireElement',
    type: 'material',
    name: '火元素精华',
    stack: 9999,
    description: '蕴含火元素能量的燃素，可以取暖或者照明。',
    quality: 1,
    price: 50,
  },
  // 邻村 掉落
  {
    key: 'zombieBone',
    type: 'material',
    name: '僵尸骨',
    quality: 0,
    stack: 9999,
    price: 20,
    description: '蕴含魔力的骨头，散发着黑色的烟雾。',
  },
  {
    key: 'silk',
    type: 'material',
    name: '丝绸',
    quality: 0,
    stack: 9999,
    price: 40,
    description: '光滑的丝绸，质地非常好。',
  },
  {
    key: 'mithril',
    type: 'material',
    name: '秘银',
    quality: 1,
    stack: 9999,
    price: 50,
    description: '导魔性很好的金属。',
  },
  {
    key: 'ghostCream',
    type: 'material',
    name: '幽魂精华',
    quality: 0,
    stack: 9999,
    price: 50,
    description: '幽魂的浓缩精华，靠近了还能听到声声惨叫。',
  },
  {
    key: 'bodyDust',
    type: 'material',
    name: '尸尘',
    quality: 0,
    stack: 9999,
    price: 50,
    description: '尘归尘，土归土……',
  },
];

})();

// ── 原 data/goods/materials.js ──
const __goods_1 = ((): GoodEntry[] => {
/**
 * Created by tdzl2003 on 2/2/17.
 */

return  [
  {
    key: 'dust1',
    type: 'material',
    name: '微光之尘',
    quality: 1,
    stack: 9999,
    price: 4,
    energy: 4,
    description: '在黑暗中会微微发光。',
  },
  {
    key: 'piece1',
    type: 'material',
    name: '微光碎片',
    quality: 2,
    stack: 9999,
    price: 8,
    energy: 8,
    description: '一整块发出微微光芒的碎片',
  },
  {
    key: 'dust2',
    type: 'material',
    name: '闪光之尘',
    quality: 1,
    stack: 9999,
    price: 20,
    energy: 20,
    description: '有淡淡的光芒在闪耀。',
  },
  {
    key: 'piece2',
    type: 'material',
    name: '闪光碎片',
    quality: 2,
    stack: 9999,
    price: 40,
    energy: 40,
    description: '蓝色的光芒似有似无。',
  },
  {
    key: 'dust3',
    type: 'material',
    name: '强光之尘',
    quality: 1,
    stack: 9999,
    price: 50,
    energy: 50,
    description: '闪耀着强烈的光芒。',
  },
  {
    key: 'piece3',
    type: 'material',
    name: '强光碎片',
    quality: 2,
    stack: 9999,
    price: 100,
    energy: 100,
    description: '闪耀着强烈的光芒。',
  },
  {
    key: 'dust4',
    type: 'material',
    name: '炫目之尘',
    quality: 1,
    stack: 9999,
    price: 120,
    energy: 120,
    description: '闪耀着炫目的光芒。',
  },
  {
    key: 'piece4',
    type: 'material',
    name: '炫目碎片',
    quality: 2,
    stack: 9999,
    price: 240,
    energy: 240,
    description: '闪耀着炫目的光芒。',
  },
  {
    key: 'dust5',
    type: 'material',
    name: '幻彩之尘',
    quality: 1,
    stack: 9999,
    price: 200,
    energy: 200,
    description: '闪耀着炫目的光芒。',
  },
  {
    key: 'piece5',
    type: 'material',
    name: '幻彩碎片',
    quality: 2,
    stack: 9999,
    price: 400,
    energy: 400,
    description: '闪耀着炫目的光芒。',
  },
  {
    key: 'dust6',
    type: 'material',
    name: '神秘之尘',
    quality: 1,
    stack: 9999,
    price: 350,
    energy: 350,
    description: '闪耀着炫目的光芒。',
  },
  {
    key: 'piece6',
    type: 'material',
    name: '神秘碎片',
    quality: 2,
    stack: 9999,
    price: 700,
    energy: 700,
    description: '闪耀着炫目的光芒。',
  },
];

})();

// ── 原 data/goods/weapons.js ──
const __goods_2 = ((): GoodEntry[] => {
/**
 * Created by tdzl2003 on 4/8/17.
 */

return  [
  {
    key: 'wand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '法杖',
    description: '就是普通的法杖。',

    mpFromKill: 0.5,
    mpRecovery: 0.5,
    minLevel: 999999,   //这样就不会直接掉落了。
  },

  // 等级1-5
  {
    key: 'stickSword',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '细木剑',
    description: '手工制的细木剑，比起玩具更像是工艺品。',

    minLevel: 1,
    maxLevel: 10,
    atkSpeed: 0.4,
  },
  {
    key: 'stickWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '细木法杖',
    description: '也就是削平了的树枝，想要凤凰羽毛什么的是没有的。',

    minLevel: 1,
    maxLevel: 10,
    mpFromKill: 1,
  },
  {
    key: 'stickDagger',
    type: 'equip',
    class: 'dagger',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '细木匕首',
    description: '磨光的细木，戳在身上有点疼。',

    minLevel: 1,
    maxLevel: 10,
    atkSpeed: 0.7,
  },

  // 等级3-10
  {
    key: 'woodSword',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '木剑',
    description: '手工制的木剑，比起武器更像是玩具。',

    minLevel: 6,
    maxLevel: 20,
    atkSpeed: 0.5,
  },
  {
    key: 'woodWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '木杖',
    description: '老爷爷们人手一个的东西，居然能用来施法？',

    minLevel: 6,
    maxLevel: 20,
    mpFromKill: 1,
  },
  {
    key: 'woodDagger',
    type: 'equip',
    class: 'dagger',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '木匕首',
    description: '木头削成的匕首，表面很锋利。',

    minLevel: 6,
    maxLevel: 20,
    atkSpeed: 0.9,
  },

  // 等级8-15
  {
    key: 'boneSword',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '骨剑',
    description: '骨头磨成的剑，看起来就很瘆人。',

    minLevel: 16,
    maxLevel: 30,
    atkSpeed: 0.6,
  },
  {
    key: 'boneWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '骨杖',
    description: '看起来很适合兽人酋长。',

    minLevel: 16,
    maxLevel: 30,
    mpFromKill: 1,
  },
  {
    key: 'boneDagger',
    type: 'equip',
    class: 'dagger',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '骨刺',
    description: '骨头上尖利的部位，十分完整。',

    minLevel: 16,
    maxLevel: 30,
    atkSpeed: 0.8,
  },

  // 等级12-20
  {
    key: 'wolfTeethMace',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '狼牙棒',
    description: '狼牙棒是狼牙造的？逗我呢？',

    minLevel: 24,
    maxLevel: 40,
    atkSpeed: 0.4,
  },
  {
    key: 'wolfTeethWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '狼牙巫杖',
    description: '塔子金够~',

    minLevel: 24,
    maxLevel: 40,
    mpFromKill: 1,
  },
  {
    key: 'wolfTeethDagger',
    type: 'equip',
    class: 'dagger',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '狼牙匕',
    description: '完整的狼牙，加上了小块木柄。',

    minLevel: 24,
    maxLevel: 40,
    atkSpeed: 0.9,
  },

  // 等级16-25
  {
    key: 'copperSword',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '铜剑',
    description: '红彤彤的金属剑，并不坚固。',
    minLevel: 32,
    maxLevel: 50,
    atkSpeed: 0.6,
  },
  {
    key: 'copperBigSword',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'twoHandMelee',
    name: '铜巨剑',
    description: '巨大的铜剑。因为铜的韧性不够所以有些破损了。',
    minLevel: 32,
    maxLevel: 50,
    atkSpeed: 0.4,
  },
  {
    key: 'copperDagger',
    type: 'equip',
    class: 'dagger',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '铜匕首',
    description: '通体由红铜打制，很是美观。',

    minLevel: 32,
    maxLevel: 50,
    atkSpeed: 0.8,
  },

  {
    key: 'zombieBoneHandyWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '魔骨手杖',
    description: '这是一个手杖。"手"杖的意思是上面还粘着一只没有处理掉的僵尸手。',

    minLevel: 32,
    maxLevel: 50,
    mpFromKill: 1,
  },
  {
    key: 'zombieBoneWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '魔骨巨杖',
    description: '感受一下吧，手持僵尸火腿战斗的感觉。',

    minLevel: 32,
    maxLevel: 50,
    mpFromKill: 0.5,
    mpRecovery: 0.5,
  },

  // 等级20-30
  {
    key: 'copperSword2',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '青铜剑',
    description: '青铜制成的剑，相当坚固。',

    minLevel: 40,
    maxLevel: 60,
    atkSpeed: 0.6,
  },
  {
    key: 'copperBigSword2',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'twoHandMelee',
    name: '青铜巨剑',
    description: '巨大的青铜剑。看起来非常沉重。',

    minLevel: 40,
    maxLevel: 60,
    atkSpeed: 0.4,
  },
  {
    key: 'copperDagger2',
    type: 'equip',
    class: 'dagger',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '青铜匕首',
    description: '青铜造的匕首，像是从古墓中发掘出来的。',

    minLevel: 40,
    maxLevel: 60,
    atkSpeed: 0.9,
  },
  {
    key: 'mithrilShortWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '秘银短杖',
    description: '通体秘银打制的短杖，导魔性能非常好。',

    minLevel: 40,
    maxLevel: 60,
    mpFromKill: 1,
  },
  {
    key: 'mithrilWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '秘银巨杖',
    description: '不要被名字糊弄了。其实是木质杖体，镀了一层秘银。',

    minLevel: 40,
    maxLevel: 60,
    mpFromKill: 0.5,
    mpRecovery: 0.5,
  },

  // 等级25-35
  {
    key: 'magicBoneSword',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '魔骨短剑',
    description: '磨尖的骨头做成的短剑，非常吓人。',

    minLevel: 50,
    maxLevel: 70,
    atkSpeed: 0.6,
  },
  {
    key: 'magicBoneBigSword',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'twoHandMelee',
    name: '魔骨巨剑',
    description: '磨尖的大腿骨，还有幽魂缠绕，非常吓人。',

    minLevel: 50,
    maxLevel: 70,
    atkSpeed: 0.4,
  },
  {
    key: 'magicBoneDagger2',
    type: 'equip',
    class: 'dagger',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '魔骨匕首',
    description: '带有魔力的尖利骨头。',

    minLevel: 50,
    maxLevel: 70,
    atkSpeed: 0.9,
  },

  {
    key: 'ghostCreamShortWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '幽魂魔杖',
    description: '你能听到魔杖发出阵阵呻吟。',

    minLevel: 50,
    maxLevel: 70,
    mpFromKill: 1,
  },
  {
    key: 'ghostCreamStick',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '幽魂长棍',
    description: '一大段连接而成的长骨，缠绕着很多幽魂。',

    minLevel: 50,
    maxLevel: 70,
    mpFromKill: 0.5,
    mpRecovery: 0.5,
  },

  // 等级30-40
  {
    key: 'mithrilCopperSword',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '秘银青铜剑',
    description: '掺了秘银的青铜剑，坚固且轻巧。',

    minLevel: 60,
    atkSpeed: 0.6,
  },
  {
    key: 'mithrilCopperBigSword',
    type: 'equip',
    class: 'sword',
    position: 'weapon',
    equipCategory: 'twoHandMelee',
    name: '秘银青铜巨剑',
    description: '掺了秘银的巨大青铜剑，难得如此轻巧。',

    minLevel: 60,
    atkSpeed: 0.4,
  },
  {
    key: 'mithrilCopperDagger2',
    type: 'equip',
    class: 'dagger',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '秘银匕首',
    description: '华丽的匕首，极其轻便。',

    minLevel: 60,
    atkSpeed: 1.0,
  },
  {
    key: 'mithrilStannumShortWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '合金锡杖',
    description: '秘银和锡合金的短杖，导魔性能非常好。',

    minLevel: 60,
    mpFromKill: 1,
  },
  {
    key: 'mithrilStannumWand',
    type: 'equip',
    class: 'wand',
    position: 'weapon',
    equipCategory: 'oneHand',
    name: '合金巨杖',
    description: '秘银和锡的合金组成的巨大长棍，表面非常光滑。',

    minLevel: 60,
    mpFromKill: 0.5,
    mpRecovery: 0.5,
  },
];

})();

// ── 原 data/goods/armors.js ──
const __goods_3 = ((): GoodEntry[] => {
/**
 * Created by tdzl2003 on 4/8/17.
 */

return  [

  // 等级1-5
  {
    key: 'dress',
    type: 'equip',
    position: 'plastron',
    class: 'cloth',
    name: '布衣',
    description: '普通的村民装束，满是补丁和破洞。',

    minLevel: 1,
    maxLevel: 10,
  },
  {
    key: 'skirt',
    type: 'equip',
    position: 'boots',
    class: 'cloth',
    name: '布裙',
    description: '普通的村民装束，不太适合男性。',

    minLevel: 1,
    maxLevel: 10,
  },

  // 等级4-15
  {
    key: 'rattanArmor',
    type: 'equip',
    position: 'plastron',
    class: 'armor',
    name: '藤甲',
    description: '将木条绑在一起组成的护甲，稍微能起到一点防御作用。',

    minLevel: 8,
    maxLevel: 30,
  },
  {
    key: 'rattanShinGuard',
    type: 'equip',
    position: 'boots',
    class: 'armor',
    name: '藤护胫',
    description: '将木条绑在一起组成的护腿，稍微能起到一点防御作用。',

    minLevel: 8,
    maxLevel: 30,
  },
  {
    key: 'hardDress',
    type: 'equip',
    position: 'plastron',
    class: 'cloth',
    name: '硬布甲',
    description: '少许木板贴合布料缝制成的护甲。对魔力很亲和。',
    level: 8,

    minLevel: 8,
    maxLevel: 30,
  },
  {
    key: 'boot',
    type: 'equip',
    position: 'boots',
    class: 'cloth',
    name: '长靴',
    description: '将木条绑在一起组成的长靴，居然还非常的好看。',
    level: 8,

    minLevel: 8,
    maxLevel: 30,
  },

  // 等级10-25
  {
    key: 'leatherArmor',
    type: 'equip',
    position: 'plastron',
    class: 'armor',
    name: '皮甲',
    description: '一块完整的狼皮做成的皮甲，可以Cosplay德鲁伊。',

    minLevel: 20,
    maxLevel: 50,
  },
  {
    key: 'leatherTrousers',
    type: 'equip',
    position: 'boots',
    class: 'armor',
    name: '皮裤',
    description: '不知道为什么穿它的时候，想着它曾经属于一只野兽，就感觉有点悲风。',

    minLevel: 20,
    maxLevel: 50,
  },
  {
    key: 'leatherDress',
    type: 'equip',
    position: 'plastron',
    class: 'cloth',
    name: '短皮甲',
    description: '这短皮甲是露脐的。再收集皮鞭和蜡烛可以组成套装。',

    minLevel: 20,
    maxLevel: 50,
  },
  {
    key: 'leatherSkirt',
    type: 'equip',
    position: 'boots',
    class: 'cloth',
    name: '短皮裙',
    description: '穿起来非常凉爽，也很养眼。',

    minLevel: 20,
    maxLevel: 50,
  },

  // 等级20-35
  {
    key: 'copperArmor',
    type: 'equip',
    position: 'plastron',
    class: 'armor',
    name: '锁子甲',
    description: '铜环串联而成的胸甲，远远看去像身上挂满了铜钱，很是炫富。',

    minLevel: 40,
    maxLevel: 70,
  },
  {
    key: 'copperShinGuard',
    type: 'equip',
    position: 'boots',
    class: 'armor',
    name: '锁链靴',
    description: '木质的鞋底，铜环串联而成鞋面，防御力很不错。',

    minLevel: 40,
    maxLevel: 70,
  },
  {
    key: 'silkDress',
    type: 'equip',
    position: 'plastron',
    class: 'cloth',
    name: '丝衣',
    description: '很漂亮的丝衣，袖子很长，像是戏服。',

    minLevel: 40,
    maxLevel: 70,
  },
  {
    key: 'silkSocks',
    type: 'equip',
    position: 'boots',
    class: 'cloth',
    name: '丝袜',
    description: '性感的丝袜，特别显得腿细。',

    minLevel: 40,
    maxLevel: 70,
  },

  // 等级30-45
  {
    key: 'boneArmor',
    type: 'equip',
    position: 'plastron',
    class: 'armor',
    name: '骨甲',
    description: '烧焦的人骨紧密排列，不但防御良好而且轻便，但是敢穿的人真不多……',

    minLevel: 60,
  },
  {
    key: 'boneShinGuard',
    type: 'equip',
    position: 'boots',
    class: 'armor',
    name: '骨靴',
    description: '用骨片雕琢而成的靴子，已经看不出骨头来自哪个部位了。',

    minLevel: 60,
  },

  {
    key: 'mithrilDress',
    type: 'equip',
    position: 'plastron',
    class: 'cloth',
    name: '秘银衬衫',
    description: '布料掺杂秘银制造的衬衫，不过到处是镂空，不知道是为了美观还是为了节约成本。',

    minLevel: 60,
  },
  {
    key: 'mithrilPlastron',
    type: 'equip',
    position: 'plastron',
    class: 'armor',
    name: '秘银胸甲',
    description: '布料掺杂秘银制造的衬衫，不过到处是镂空，不知道是为了美观还是为了节约成本。',

    minLevel: 60,
  },
  {
    key: 'mithrilSkirt',
    type: 'equip',
    position: 'boots',
    class: 'cloth',
    name: '秘银短裙',
    description: '一层布料一层秘银叠加而成的褶裙，自带防走光被动。',

    minLevel: 60,
  },
];

})();

// ── 原 data/goods/jewels.js ──
const __goods_4 = ((): GoodEntry[] => {
/**
 * Created by tdzl2003 on 4/8/17.
 */

return  [

  {
    key: 'ornament',
    type: 'equip',
    class: 'ornament',
    position: 'amulet',
    name: '饰品',
    description: '就是普通的饰品。',

    minLevel: 999999,   //这样就不会直接掉落了。
  },

  {
    key: 'copperRing',
    type: 'equip',
    class: 'ornament',
    position: 'ring1',
    name: '铜拉环',
    description: '看起来就是罐头上取下来的一样。',

    minLevel: 35,
    maxLevel: 60,
  },

  {
    key: 'zombieHeart',
    type: 'equip',
    class: 'ornament',
    position: 'amulet',
    name: '灌魔心脏',
    description: '还在微微的跳动。',

    minLevel: 32,
    maxLevel: 80,
  },

  {
    key: 'ironRing',
    type: 'equip',
    class: 'ornament',
    position: 'ring1',
    name: '钢指环',
    description: '百炼钢化作绕指柔。',

    minLevel: 35,
  },

  {
    key: 'goldNecklace',
    type: 'equip',
    class: 'ornament',
    position: 'amulet',
    name: '金项链',
    description: '暴发户专属。',

    minLevel: 35,
  },

  {
    key: 'mithrilRing',
    type: 'equip',
    class: 'ornament',
    position: 'ring1',
    name: '秘银指环',
    description: '我就知道有钱人什么东西都能用上贵金属。',

    minLevel: 60,
  },

  {
    key: 'mithrilStannumRing',
    type: 'equip',
    class: 'ornament',
    position: 'amulet',
    name: '合金项链',
    description: '反光度非常好，可以卖个好价钱。',

    minLevel: 80,
  },
];

})();

// ── 工艺通货 12 种 + 精华 6 种（实装；效果文案取自修仙设计稿，炼器效果下期接） ──
//
// 约定：`currency.<code>` = 可堆叠工艺通货；`essence.<code>` = 定向精华（同为 `material` + `stack`）。
// ⚠️ 本期只实装**物品与掉落**；`description` 是下期炼器系统的接线说明，尚未有消费方。
// 修仙原表 13 种通货中的 `vaal`（瓦尔宝珠）**不实装**（用户指定）。
// 精华槽共 12 个：本期实装 6 个，其余 6 个是 `essence.07..12` 空位（不参与掉落）。
const __goods_craft = ((): GoodEntry[] => {
  // `wallet: true`（R1）：通货 / 精华不占背包格，计入 `Player.wallet`（无上限）。
  const currency = (key: string, name: string, price: number, description: string): GoodEntry => ({
    key: `currency.${key}`,
    type: 'material',
    name,
    description,
    price,
    stack: 9999,
    wallet: true,
  });
  const essence = (key: string, name: string, description: string): GoodEntry => ({
    key: `essence.${key}`,
    type: 'material',
    name,
    description,
    price: 150,
    stack: 9999,
    wallet: true,
  });
  const reserved = (n: number): GoodEntry => {
    const nn = String(n).padStart(2, '0');
    return {
      key: `essence.${nn}`,
      type: 'material',
      name: `精华·空位 ${nn}`,
      description: '精华槽位预留（下期实装，暂不参与掉落）。',
      price: 0,
      stack: 9999,
      // 精华空位同属钱包物品（与实装精华一致），避免将来实装时出现承载层分叉。
      wallet: true,
    };
  };
  return [
    // 工艺通货（price = 面额阶梯；掉落稀有度见 data/index.ts 的 CRAFT_DROP_RATES）
    currency('transmute', '蜕变石', 10, '凡品 → 灵品（roll 1~2 条词缀）。'),
    currency('alchemy', '点金石', 25, '凡品 → 宝品（roll 3~6 条词缀）。'),
    currency('chaos', '混沌石', 50, '重 roll 当前品阶的词条数与词缀。'),
    currency('scour', '重铸石', 80, '清除全部词缀，还原凡品（唯一降阶途径）。'),
    currency('annul', '剥离石', 120, '随机移除 1 条词缀，品阶不变。'),
    currency('blessed', '祝福石', 200, '重 roll 基础属性数值。'),
    currency('exalt', '崇高石', 350, '新增 1 条词缀；灵品满 2 条再使用即升宝品。'),
    currency('ember', '古灵余烬', 500, '新增/替换基底词缀。'),
    currency('wisp', '古灵溶液', 500, '新增/替换基底词缀。'),
    currency('divine', '神圣石', 1000, '重 roll 词缀数值（不改词条数与种类）。大额交易通货。'),
    currency('fracture', '破溃宝珠', 1500, '锁定 1 条词缀为天定铭文。大额交易通货。'),
    currency('mirror', '映道镜', 10000, '复制一件物品，镜像不可再复制。极稀有。'),
    // 精华 6 种（实装；按前后缀 + 词缀族定向）
    essence('atk', '锋锐精华', '定向：前缀必出锋锐（攻击）族。'),
    essence('spirit', '蕴灵精华', '定向：前缀必出蕴灵（灵性）族。'),
    essence('def', '御土精华', '定向：前缀必出御土（防御）族。'),
    essence('hp', '太一精华', '定向：前缀必出太一（生命）族。'),
    essence('regen', '回春精华', '定向：后缀必出回春（回复）族。'),
    essence('insight', '悟性精华', '定向：后缀必出悟性族。'),
    // 精华空位 6 个（下期实装，不参与掉落）
    reserved(7),
    reserved(8),
    reserved(9),
    reserved(10),
    reserved(11),
    reserved(12),
  ];
})();

export const goods: Record<string, GoodEntry> = arrayToMap([
  ...__goods_0,
  ...__goods_1,
  ...__goods_2,
  ...__goods_3,
  ...__goods_4,
  ...__goods_craft,
]);
