/**
 * 混沌仪地图（W6，R3）—— `chaos.t01..t16`。
 *
 * 与 `data/maps-world.ts` 的关系：**新增文件**，不修改野外地图种子。
 *
 * 规格（13 号任务书 §1 R3 / §2.1 Q5 / §2.3 / §4 W6）：
 * - **T1~T16**，地图等级 = `84 + T`（T1=85 … T16=100），`chaos: T` 标记本图属混沌仪；
 * - 怪物等级由 W4 的 `levelOverride` 机制生成：普通 = 地图等级 / 稀有 +1 / BOSS +2；
 * - **守关 BOSS 可重复刷**（每 20 波），且**不**写入 `worldBossKilled`（见 `spawner.ts`）；
 * - **不出现在普通 `map.list`**（`map-dto.ts` 按 `chaos` 过滤），只能由混沌仪钥石序列进入；
 * - `total` = 一波的刷怪总量（W4 消费）；每 20 波出守关 BOSS。
 *
 * ⚠️ 本文件是**纯数据模块，无模块级副作用**。
 * ⚠️ 敌人 key 全部取自既有 `enemies.ts`（不新增敌人）；高 T 阶使用高阶元素 / 水元素 / 阿撒托斯。
 */

import type { MapEntry } from './_shapes.js';
import { arrayToMap } from './_util.js';
import { chaosLevelOfTier, chaosMapKeyOfTier } from '../rules/chaos.js';

/** 战斗图刷怪条目的统一展示品质分布（普通 / 稀有 / 传奇）。 */
const QUALITY: number[] = [90, 9, 1];
const WARMUP = 1000;
const DELAY = 5000;
const MAX = 3;
/** 一波的刷怪总量（W4）：每 20 波出一次守关 BOSS。 */
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

/**
 * 每个 T 阶的刷怪池与守关 BOSS（敌人 key 全部来自既有 `enemies.ts`）。
 *
 * ⚠️ 选怪纪律同 `maps-world.ts`：**必须是 `camp:'enemy'`、非 `onPress` 机关**，
 * 且 **BOSS 的 HP 不低于本图任一普通怪**（否则「守关者」比杂兵还弱，且波次奖励倒挂）。
 * `data/spawn-eligibility.test.ts` 有门禁。
 *
 * 阶梯按 BOSS 强度递增：2.5k → 6k → 10k → 40k → 60k → 80k → 150k → 300k →
 * 1M（阿撒托斯）→ 1.6M（尼恩罗斯）→ 2.4M（兽人萨满）→ 10M（鱼斯拉）。
 */
const CHAOS_TIERS: ReadonlyArray<{ readonly types: Record<string, number>; readonly boss: string }> = [
  { types: { 'chapter3.undead.ghost': 4, 'chapter3.undead.ghostShield': 3, 'chapter3.undead.zombie': 3 }, boss: 'chapter3.beast.wildpig' },
  { types: { 'chapter3.undead.zombie': 4, 'chapter3.beast.wildpig': 3, 'chapter3.beast.lion': 3 }, boss: 'chapter3.murloc.shaman' },
  { types: { 'chapter3.murloc.minions': 4, 'chapter3.murloc.shaman': 3, 'chapter3.undead.zombie': 3 }, boss: 'chapter3.murloc.slaves' },
  { types: { 'chapter3.murloc.slaves': 4, 'kakarif.illusion': 3, 'knight.leader': 3 }, boss: 'chapter3.beast.dingman' },
  { types: { 'kakarif.illusion': 4, 'knight.leader': 3, 'chapter3.murloc.slaves': 3 }, boss: 'chapter3.beast.simba' },
  { types: { 'chapter3.murloc.slaves': 4, 'chapter3.beast.dingman': 3, 'chapter3.waterElement': 3 }, boss: 'chapter3.beast.pengpeng' },
  { types: { 'chapter3.beast.simba': 4, 'chapter3.beast.dingman': 3, 'chapter3.waterElement': 3 }, boss: 'chapter4.orcs.warrior' },
  { types: { 'chapter3.element.fire': 4, 'chapter3.element.water': 3, 'chapter3.beast.pengpeng': 3 }, boss: 'chapter3.waterElement.giants' },
  { types: { 'chapter3.waterElement.giants': 4, 'chapter4.orcs.warrior': 3, 'chapter3.element.earth': 3 }, boss: 'chapter3.murloc.warlord' },
  { types: { 'chapter4.orcs.warrior': 4, 'chapter3.waterElement.giants': 3, 'chapter3.element.earth': 3 }, boss: 'chapter3.element.azathoth.fire' },
  { types: { 'chapter3.element.fire': 4, 'chapter3.element.water': 3, 'chapter3.element.earth': 3 }, boss: 'chapter3.element.azathoth.ice' },
  { types: { 'chapter3.element.fire': 4, 'chapter3.element.earth': 3, 'chapter3.waterElement.giants': 3 }, boss: 'chapter3.element.azathoth.earth' },
  { types: { 'chapter3.element.fire': 4, 'chapter3.element.water': 3, 'chapter3.waterElement.giants': 3 }, boss: 'chapter3.element.azathoth.dark' },
  { types: { 'chapter3.element.azathoth.fire': 4, 'chapter3.element.azathoth.ice': 3, 'chapter3.element.azathoth.earth': 3 }, boss: 'chapter3.waterElement.Nynnroth' },
  { types: { 'chapter3.waterElement.Nynnroth': 4, 'chapter3.element.azathoth.none': 3, 'chapter3.waterElement.giants': 3 }, boss: 'chapter3.orcs.shaman' },
  { types: { 'chapter3.orcs.shaman': 4, 'chapter3.waterElement.Nynnroth': 3, 'chapter3.element.azathoth.dark': 3 }, boss: 'chapter3.fishzilla' },
];

function buildChaosMap(tier: number): MapEntry {
  const key = chaosMapKeyOfTier(tier);
  const level = chaosLevelOfTier(tier);
  const config = CHAOS_TIERS[tier - 1];
  if (key === null || level === null || config === undefined) {
    throw new Error(`混沌图数据缺失：T${tier}`);
  }
  return {
    key,
    name: `混沌 T${tier}`,
    hint: `无尽混沌领域（T${tier}）——守关者每 20 波现身。`,
    level,
    chaos: tier,
    exp: 4000 + tier * 2000,
    boss: config.boss,
    monsters: spawn({ ...config.types }),
  };
}

/** `chaos.t01..t16`（稳定顺序）。 */
export const chaosMaps: Record<string, MapEntry> = arrayToMap(
  Array.from({ length: 16 }, (_, index) => buildChaosMap(index + 1)),
);
