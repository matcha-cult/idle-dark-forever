/**
 * 全新地图种子（W3，R2）。
 *
 * 与旧 `data/maps.ts`（已物理删除）的关系：**整体替换**，不在存量上改。
 * 结构：
 *  - `home`：原样保留的安全区（无怪、无进入条件）；
 *  - `world.1` ~ `world.13`：13 张战斗图，`level` = 等级段下界
 *    （`1/5/15/25/35/45/55/65/75` 各 1 张，`85+` 共 4 张）；`requirement` 只保留 `level`；
 *  - 每张图带一个 `boss`（守关 BOSS 的敌人 key，W4 消费）。
 *
 * ⚠️ 本文件是**纯数据模块，无模块级副作用**：只有对象字面量，不注册、不 mock、不读写全局。
 * ⚠️ `total` = 一波的刷怪总量（W4 消费，`spawner` 用它判定「刷满 + 全部清空 = 完成一波」）。
 * ⚠️ `requirement.bossKilled` = 解锁链（W4）：进入本图需先击杀上一段图的野外 BOSS。
 * ⚠️ 不写旧秘境体系的副本 / 相位 / 分组 / 无尽字段：该体系在 W6 已删除。
 *
 * ## ⚠️ 选怪纪律（W8 修正，务必遵守）
 *
 * 本引擎里敌人的 **HP/ATK 完全取自 `enemies.ts` 的数据，不随等级缩放**；
 * `levelOverride`（普通=地图等级 / 稀有 +1 / BOSS +2）只影响**显示等级 / 经验判定 / 掉落门槛**。
 * 因此刷怪池与守关 BOSS 必须按**真实数值 + 阵营**挑选，不能只看 `level` 字段：
 *
 * 1. **必须 `camp: 'enemy'`**：`neutral` 不会被自动选为目标（挂机不推进波次）、
 *    `alien` 玩家**根本无法攻击**（`CampRelation.player.alien` 不存在）、
 *    `shrine` / `story` / `ghost` 不参战。`data/spawn-eligibility.test.ts` 有编译期之外的数据门禁。
 * 2. **禁止机关 / 交互单位**：如 `kobold.candle`（`onPress`、hp10/atk100）、
 *    `chapter3.murloc.army`（中立、hp1000）——它们不是普通杂兵。
 * 3. 每个段的刷怪池与 BOSS 取**数据等级落在该段内、数值与玩家同段战力相称**的敌人
 *    （原版就是按敌人自身等级调平衡的）。
 */

import type { MapEntry } from './_shapes.js';
import { arrayToMap } from './_util.js';

/** 战斗图刷怪条目的统一展示品质分布（普通 / 稀有 / 传奇）。 */
const QUALITY: number[] = [90, 9, 1];
const WARMUP = 1000;
const DELAY = 5000;
const MAX = 3;
/** 一波的刷怪总量（W4）：`total` 刷满且全部清空 = 完成一波，每 20 波出守关 BOSS。 */
const TOTAL = 8;

/** 造一条加权刷怪条目（仅数据，无副作用）。 */
function spawn(types: Record<string, number>): MapEntry['monsters'] {
  return [
    {
      types,
      warmup: WARMUP,
      delay: DELAY,
      max: MAX,
      total: TOTAL,
      quality: [...QUALITY],
      randomPosition: true,
    },
  ];
}

const __home: MapEntry = {
  key: 'home',
  name: '自宅',
  hint: '安全的避难所。休息够了就可以再度出发。',
};

const __world1: MapEntry = {
  key: 'world.1',
  // 段首图取 **1 级**（角色初始就是 1 级）：0 级不符合实际，且 0 级怪的经验窗口会被压到 <10。
  level: 1,
  name: '边境荒野',
  hint: '王国边境的荒芜地带，弱小的史莱姆在此游荡。',
  requirement: { level: 1 },
  exp: 5000,
  // 段 0~5：只有 `slime.minimal` 是数值最弱的可自动索敌杂兵；BOSS 用同系的巨史莱姆。
  boss: 'slime.giant.enemy',
  monsters: spawn({
    'slime.minimal': 10,
  }),
};

const __world2: MapEntry = {
  key: 'world.2',
  level: 5,
  name: '迷雾林间',
  hint: '终年浓雾不散的林间小径，史莱姆王后潜伏在雾中。',
  requirement: { level: 5, bossKilled: 'world.1' },
  exp: 20000,
  boss: 'slime.queen',
  monsters: spawn({
    'slime.minimal': 6,
    'slime.giant.enemy': 4,
  }),
};

const __world3: MapEntry = {
  key: 'world.3',
  level: 15,
  name: '腐骨沼泽',
  hint: '腐水与白骨交错的沼泽，凶暴的巨狼在雾里游弋。',
  requirement: { level: 15, bossKilled: 'world.2' },
  exp: 80000,
  boss: 'wolf.giant',
  monsters: spawn({
    'slime.giant.enemy': 5,
    'wolf.minimal': 5,
  }),
};

const __world4: MapEntry = {
  key: 'world.4',
  level: 25,
  name: '狼嚎雪原',
  hint: '风雪呼啸的冻原，狼群在夜里格外凶暴。',
  requirement: { level: 25, bossKilled: 'world.3' },
  exp: 150000,
  boss: 'wolf.king',
  monsters: spawn({
    'wolf.minimal': 5,
    'wolf.giant': 3,
    'kobold.miner': 2,
  }),
};

const __world5: MapEntry = {
  key: 'world.5',
  level: 35,
  name: '废弃矿坑',
  hint: '被狗头人占据的旧矿坑，矿工与萨满盘踞其中。',
  requirement: { level: 35, bossKilled: 'world.4' },
  exp: 250000,
  boss: 'zombies.hammersmith',
  monsters: spawn({
    'kobold.miner': 4,
    'zombies.farmer': 3,
    'kobold.shaman': 2,
  }),
};

const __world6: MapEntry = {
  key: 'world.6',
  level: 45,
  name: '亡者墓园',
  hint: '常年不散的尸气让死者重新站起，贪婪的食尸鬼在碑间翻找。',
  requirement: { level: 45, bossKilled: 'world.5' },
  exp: 400000,
  boss: 'kobold.goldteeth',
  monsters: spawn({
    'kakarif.generations': 4,
    'knight.normal': 3,
    'kakarif.servants': 2,
  }),
};

const __world7: MapEntry = {
  key: 'world.7',
  level: 55,
  name: '骑士哨站',
  hint: '堕落骑士扼守的哨站，祈祷声从不停歇。',
  requirement: { level: 55, bossKilled: 'world.6' },
  exp: 600000,
  boss: 'knight.leader',
  monsters: spawn({
    'knight.normal': 4,
    'knight.prayer': 3,
    'kakarif.servants': 2,
  }),
};

const __world8: MapEntry = {
  key: 'world.8',
  level: 65,
  name: '幽魂回廊',
  hint: '幽魂与亡者在长长的回廊里往复徘徊。',
  requirement: { level: 65, bossKilled: 'world.7' },
  exp: 900000,
  boss: 'chapter3.necromancer',
  monsters: spawn({
    'chapter3.undead.ghost': 4,
    'chapter3.undead.zombie': 3,
    'chapter3.undead.ghostShield': 2,
  }),
};

const __world9: MapEntry = {
  key: 'world.9',
  level: 75,
  name: '猛兽巢穴',
  hint: '野兽的巢穴，越靠近深处吼声越沉。',
  requirement: { level: 75, bossKilled: 'world.8' },
  exp: 1300000,
  boss: 'chapter3.beast.simba',
  monsters: spawn({
    'chapter3.beast.wildpig': 4,
    'chapter3.beast.lion': 3,
    'chapter3.murloc.minions': 2,
    'chapter3.murloc.shaman': 1,
  }),
};

const __world10: MapEntry = {
  key: 'world.10',
  level: 85,
  name: '鱼人海湾',
  hint: '咸腥的海湾里，鱼人部落正在集结。',
  requirement: { level: 85, bossKilled: 'world.9' },
  exp: 1800000,
  boss: 'chapter3.murloc.warlord',
  monsters: spawn({
    'chapter3.murloc.minions': 4,
    'chapter3.murloc.shaman': 3,
    'chapter3.murloc.slaves': 1,
  }),
};

const __world11: MapEntry = {
  key: 'world.11',
  level: 85,
  name: '疯狂兽场',
  hint: '巨兽相互吞噬的战场，庞然大物盘踞中央。',
  requirement: { level: 85, bossKilled: 'world.9' },
  exp: 2000000,
  boss: 'chapter3.beast.pengpeng',
  monsters: spawn({
    'chapter3.beast.dingman': 4,
    'chapter3.beast.wildpig': 3,
    'chapter3.beast.lion': 3,
  }),
};

const __world12: MapEntry = {
  key: 'world.12',
  level: 85,
  name: '元素祭坛',
  hint: '火、水、土三种元素在此地交锋。',
  requirement: { level: 85, bossKilled: 'world.9' },
  exp: 2200000,
  boss: 'chapter3.element.azathoth.fire',
  monsters: spawn({
    'chapter3.element.fire': 4,
    'chapter3.element.water': 3,
    'chapter3.element.earth': 3,
  }),
};

const __world13: MapEntry = {
  key: 'world.13',
  level: 85,
  name: '混沌前沿',
  hint: '混沌大军的前哨，兽人与水元素混杂行进。',
  requirement: { level: 85, bossKilled: 'world.9' },
  exp: 2400000,
  boss: 'chapter3.waterElement.Nynnroth',
  monsters: spawn({
    'chapter4.orcs.warrior': 4,
    'chapter3.orcs.wolf': 3,
    'chapter4.orcs.hunter': 2,
    'chapter3.waterElement': 1,
  }),
};

export const maps: Record<string, MapEntry> = arrayToMap([
  __home,
  __world1,
  __world2,
  __world3,
  __world4,
  __world5,
  __world6,
  __world7,
  __world8,
  __world9,
  __world10,
  __world11,
  __world12,
  __world13,
]);
