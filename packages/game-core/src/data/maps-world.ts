/**
 * 全新地图种子（W3，R2）。
 *
 * 与旧 `data/maps.ts`（已物理删除）的关系：**整体替换**，不在存量上改。
 * 结构：
 *  - `home`：原样保留的安全区（无怪、无进入条件）；
 *  - `world.1` ~ `world.13`：13 张战斗图，`level` = 等级段下界
 *    （`1/5/15/25/35/45/55/65/75` 各 1 张，`85+` 共 4 张）；`level` 是**内容/建议等级**，
 *    **不参与解锁判定**（见下一条）；
 *  - 每张图带一个 `boss`（守关 BOSS 的敌人 key，W4 消费）。
 *
 * ## 守关 BOSS 重做（v4.2，P6 三合一）
 *
 * **地图名（主题）= 普通刷怪池 = 守关 BOSS**，三者必须同族/同域：
 *  - BOSS 一律指向 `data/map-bosses.ts` 的传奇条目 `boss.world.01..13`（旧 BOSS key 已全部换下）；
 *  - 刷怪池按主题重排（去沼泽狼 / 去鱼人的兽巢 / 牛头人迷宫 / 九头蛇深潭 / …）；
 *  - 地图名与 hint 同步重写，读名字就能猜到守关者是谁。
 *  门禁见 `data/spawn-eligibility.test.ts`（BOSS 唯一 / 不入普通池 / 数值地板 / 单调 / 可战性 /
 *  不抬人名 / 三合同族）。
 *
 * ⚠️ 本文件是**纯数据模块，无模块级副作用**：只有对象字面量，不注册、不 mock、不读写全局。
 * ⚠️ `total` = 一波的刷怪总量（W4 消费，`spawner` 用它判定「刷满 + 全部清空 = 完成一波」）。
 * ⚠️ `requirement` = **只用 `bossKilled` 的通关链**（W11）：`world.1` 无门槛，`world.N` 需先击杀
 *    上一段图的守关 BOSS（85+ 四张统一接 `world.9`）。**不要把 `level` 放回解锁条件** ——
 *    `level` 同时是怪物等级覆写来源，一旦它又是门槛，解锁线就正好落在经验衰减零点上（历史上
 *    因此整条推进链不可达：world.2 实测 13→14 需 21228 次击杀）。UI 只把它显示为「建议等级」。
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
/** 每只怪的刷新间隔（实际会在 2000 ± 500ms 内抖动，见 `Born.setTimer`）。 */
const DELAY = 2000;
/** 同屏最多 4 只怪物（含守关 BOSS 与召唤物；达到上限即暂停自然刷新）。 */
const MAX = 4;
/** 一波的刷怪总量（W4）：`total` 刷满且全部清空 = 完成一波，每 20 波出守关 BOSS。 */
const TOTAL = 4;

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
  exp: 5000,
  // 段 0~5：只有 `slime.minimal` 是数值最弱的可自动索敌杂兵；BOSS 用同系的变异史莱姆
  // （`boss.world.01`，传奇档，数值 160/3，受 ≤200 / ≤5 的段首硬上限约束）。
  boss: 'boss.world.01',
  monsters: spawn({
    'slime.minimal': 10,
  }),
};

const __world2: MapEntry = {
  key: 'world.2',
  level: 5,
  name: '迷雾林间',
  hint: '终年浓雾不散的林间小径，空气里飘着令人作呕的甜腥味——臭源就在雾里。',
  requirement: { bossKilled: 'world.1' },
  exp: 20000,
  boss: 'boss.world.02',
  monsters: spawn({
    'slime.minimal': 6,
    'slime.giant.enemy': 4,
  }),
};

const __world3: MapEntry = {
  key: 'world.3',
  level: 15,
  name: '腐骨林地',
  hint: '白骨散落的枯林，狼群在暗处低吼，狼妖就伏在骨堆之后。',
  requirement: { bossKilled: 'world.2' },
  exp: 80000,
  boss: 'boss.world.03',
  monsters: spawn({
    'wolf.minimal': 6,
    'wolf.giant': 4,
  }),
};

const __world4: MapEntry = {
  key: 'world.4',
  level: 25,
  name: '狼嚎雪原',
  hint: '风雪呼啸的冻原，狼群在夜里格外凶暴，狼主一嚎便群狼毕至。',
  requirement: { bossKilled: 'world.3' },
  exp: 150000,
  boss: 'boss.world.04',
  monsters: spawn({
    'wolf.minimal': 4,
    'wolf.giant': 3,
    'wolf.frost': 3,
  }),
};

const __world5: MapEntry = {
  key: 'world.5',
  level: 35,
  name: '熔炉矿坑',
  hint: '被狗头人占据的旧矿坑，坑底那座熄灭的熔炉里还烧着怨魂。',
  requirement: { bossKilled: 'world.4' },
  exp: 250000,
  boss: 'boss.world.05',
  monsters: spawn({
    'kobold.miner': 4,
    'mine.ghoul': 3,
    'kobold.shaman': 3,
  }),
};

const __world6: MapEntry = {
  key: 'world.6',
  level: 45,
  name: '狗头人金窟',
  hint: '狗头人把抢来的财宝都藏进了这座地窟，暴君亲自坐镇。',
  requirement: { bossKilled: 'world.5' },
  exp: 400000,
  boss: 'boss.world.06',
  monsters: spawn({
    'kobold.miner': 3,
    'kobold.digger': 4,
    'kobold.shaman': 3,
  }),
};

const __world7: MapEntry = {
  key: 'world.7',
  level: 55,
  name: '堕誓哨站',
  hint: '背弃誓约的骑士扼守的哨站，无冕者站在哨塔顶端。',
  requirement: { bossKilled: 'world.6' },
  exp: 600000,
  boss: 'boss.world.07',
  monsters: spawn({
    'knight.normal': 5,
    'knight.prayer': 5,
  }),
};

const __world8: MapEntry = {
  key: 'world.8',
  level: 65,
  name: '噬魂回廊',
  hint: '幽魂与亡者在长长的回廊里往复徘徊，暗影法师在尽头吞食它们。',
  requirement: { bossKilled: 'world.7' },
  exp: 900000,
  boss: 'boss.world.08',
  monsters: spawn({
    'chapter3.undead.ghost': 4,
    'chapter3.undead.zombie': 3,
    'chapter3.undead.ghostShield': 2,
  }),
};

const __world9: MapEntry = {
  key: 'world.9',
  level: 75,
  name: '蛮荒兽巢',
  hint: '野兽的巢穴，越靠近深处吼声越沉，巨狮在骸骨堆上踱步。',
  requirement: { bossKilled: 'world.8' },
  exp: 1300000,
  boss: 'boss.world.09',
  monsters: spawn({
    'chapter3.beast.wildpig': 4,
    'chapter3.beast.lion': 3,
    'beast.bear': 3,
  }),
};

const __world10: MapEntry = {
  key: 'world.10',
  level: 85,
  name: '牛头人迷宫',
  hint: '混沌守卫·牛头人盘踞的迷宫，每一次转弯都可能撞上斧刃。',
  requirement: { bossKilled: 'world.9' },
  exp: 1800000,
  boss: 'boss.world.10',
  monsters: spawn({
    'mino.grunt': 4,
    'mino.seer': 3,
    // 迷宫里的石像：元素系杂兵，作为「居所」主题里的场景物。
    'chapter3.element.earth': 3,
  }),
};

const __world11: MapEntry = {
  key: 'world.11',
  level: 85,
  name: '九头蛇深潭',
  hint: '混沌守卫·九头蛇盘踞的深潭，斩下一颗头，还有更多在等着。',
  requirement: { bossKilled: 'world.9' },
  exp: 2000000,
  boss: 'boss.world.11',
  monsters: spawn({
    'hydra.spawn': 4,
    // 水中的鱼人喽啰：与深潭主题相符的次级杂兵。
    'chapter3.murloc.minions': 3,
    'chapter3.murloc.shaman': 3,
  }),
};

const __world12: MapEntry = {
  key: 'world.12',
  level: 85,
  name: '奇美拉岩窟',
  hint: '混沌守卫·奇美拉栖息的岩窟，三种元素在它体内撕咬。',
  requirement: { bossKilled: 'world.9' },
  exp: 2200000,
  boss: 'boss.world.12',
  monsters: spawn({
    'chapter3.element.fire': 4,
    'chapter3.element.water': 3,
    'chapter3.element.earth': 3,
  }),
};

const __world13: MapEntry = {
  key: 'world.13',
  level: 85,
  name: '不死鸟圣坛',
  hint: '混沌守卫·不死鸟的圣坛，火焰熄灭之处，灰烬里又亮起火星。',
  requirement: { bossKilled: 'world.9' },
  exp: 2400000,
  boss: 'boss.world.13',
  monsters: spawn({
    'chapter3.element.fire': 5,
    'phoenix.spark': 5,
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
