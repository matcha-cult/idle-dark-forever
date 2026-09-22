/**
 * 刷怪池「可战性」门禁（W8 修正后的回归护栏）。
 *
 * 背景（真实缺陷）：新地图最初**只按 `level` 字段选怪**，把两个 1 级特例塞进了 `world.1`：
 * - `kobold.candle`（`camp:'neutral'` + `onPress` 机关，hp10 / **atk100**）——一刀秒人；
 * - `chapter3.murloc.army`（`camp:'neutral'`，hp1000）——中立坦克。
 *
 * 本引擎里阵营关系决定「能否自动索敌 / 能否被攻击」（`combat/camps.ts`）：
 * - `CampRelation.player.enemy = 'hate'` → 自动索敌（野怪）；
 * - `CampRelation.player.neutral = true` → 可攻击但**不会自动选中**；
 * - `CampRelation.player.alien` **不存在** → 玩家**根本无法攻击**（`chapter3.fishzilla.magician` 即为 alien）。
 *
 * 因此普通刷怪池与守关 BOSS **必须**是 `camp:'enemy'` 且非 `onPress` 机关；
 * 否则挂机会卡住波次（中立不被自动打）或直接无法通关（alien 不可攻击）。
 */
import { describe, expect, it } from 'vitest';

import type { DataTables, MapData } from '../contracts/data.js';
import type { EnemyEntry } from './_shapes.js';
import { createDefaultTables } from './index.js';

const tables = createDefaultTables();

/** 所有「有怪」的地图（含混沌图；`home` 无怪自动跳过）。 */
const combatMaps: Array<[string, MapData]> = Object.entries(tables.maps).filter(
  ([, map]) => (map.monsters ?? []).length > 0,
);

/**
 * 反向用例专用的**深拷贝**表。
 *
 * ⚠️ `createDefaultTables()` 的 `cloneTables` 只深拷 `loots` —— `maps[].monsters[].types`
 * 是**共享引用**，直接改会污染模块级 `tables`、跨用例泄漏。这里用 JSON 深拷隔离
 * （谓词只读 JSON 安全字段：key / 数值 / camp / name / types / boss，不读函数 hook）。
 */
function badTables(): DataTables {
  return JSON.parse(JSON.stringify(createDefaultTables())) as DataTables;
}

describe('刷怪池可战性门禁', () => {
  it('至少覆盖 13 张野外图 + 16 张混沌图（防止门禁空跑）', () => {
    expect(combatMaps.length).toBeGreaterThanOrEqual(29);
  });

  it('普通刷怪池全部是 camp=enemy 且非机关（可自动索敌、可被攻击）', () => {
    for (const [key, map] of combatMaps) {
      for (const spawn of map.monsters ?? []) {
        for (const enemyKey of Object.keys(spawn.types ?? {})) {
          const enemy = tables.enemies[enemyKey];
          expect(enemy, `${key} 引用了不存在的敌人 ${enemyKey}`).toBeDefined();
          expect(enemy!.camp, `${key} 普通怪 ${enemyKey} 的阵营`).toBe('enemy');
          expect(enemy!.onPress, `${key} 普通怪 ${enemyKey} 是 onPress 机关`).toBeUndefined();
        }
      }
    }
  });

  it('守关 BOSS 全部是 camp=enemy 且非机关', () => {
    for (const [key, map] of combatMaps) {
      if (!map.boss) continue;
      const boss = tables.enemies[map.boss];
      expect(boss, `${key} 的 boss ${map.boss} 不存在`).toBeDefined();
      expect(boss!.camp, `${key} BOSS ${map.boss} 的阵营`).toBe('enemy');
      expect(boss!.onPress, `${key} BOSS ${map.boss} 是 onPress 机关`).toBeUndefined();
    }
  });

  it('回归：world.1（段首，1 级）不得再用机关/中立特例，且 BOSS 必须是低数值怪', () => {
    const world1 = tables.maps['world.1'];
    expect(world1).toBeDefined();
    const normalKeys = (world1!.monsters ?? []).flatMap((spawn) => Object.keys(spawn.types ?? {}));
    expect(normalKeys).not.toContain('kobold.candle');
    expect(normalKeys).not.toContain('chapter3.murloc.army');
    // 段 0~5 的 BOSS 数值必须与玩家同段战力相称（原缺陷为 hp1000/atk15 的史莱姆王后）。
    const boss = tables.enemies[world1!.boss ?? ''];
    expect(boss, `world.1 boss=${world1!.boss}`).toBeDefined();
    expect(boss!.maxHp, 'world.1 BOSS 血量过高（会卡死解锁链）').toBeLessThanOrEqual(200);
    expect(boss!.atk, 'world.1 BOSS 攻击过高').toBeLessThanOrEqual(5);
  });

  it('回归：不得再把 alien（无法攻击）或 neutral（不自动索敌）当普通怪', () => {
    const offenders: string[] = [];
    for (const [key, map] of combatMaps) {
      for (const spawn of map.monsters ?? []) {
        for (const enemyKey of Object.keys(spawn.types ?? {})) {
          const camp = tables.enemies[enemyKey]?.camp;
          if (camp === 'alien' || camp === 'neutral') offenders.push(`${key} → ${enemyKey} (${camp})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('守关 BOSS 的 HP 不低于本图任一普通怪（防止守关者比杂兵弱）', () => {
    for (const [key, map] of combatMaps) {
      if (!map.boss) continue;
      const bossHp = tables.enemies[map.boss]!.maxHp ?? 0;
      for (const spawn of map.monsters ?? []) {
        for (const enemyKey of Object.keys(spawn.types ?? {})) {
          const hp = tables.enemies[enemyKey]!.maxHp ?? 0;
          expect(
            hp,
            `${key}: 普通怪 ${enemyKey} hp=${hp} > BOSS ${map.boss} hp=${bossHp}`,
          ).toBeLessThanOrEqual(bossHp);
        }
      }
    }
  });
});

// ───────────────────────── 守关 BOSS 重做（v4.2）7 条门禁 ─────────────────────────
//
// 规格真相：`/home/nbb/projects/user-tmp/map-boss-redesign-plan.md` §8.1。
// 每个门禁都抽成**接受 `DataTables` 的纯函数**，这样既能在真实表上断言「零违规」，
// 也能在克隆表上注入违规、断言「门禁一定红」（反向用例，防止门禁空跑）。

/** 本图刷怪池引用的全部敌人 key。 */
function poolKeysOf(map: MapData): string[] {
  return (map.monsters ?? []).flatMap((s) => Object.keys(s.types ?? {}));
}

/** 本图最强杂兵的 `maxHp` / `atk`（缺省按 0）。 */
function strongestMobOf(t: DataTables, map: MapData, field: 'maxHp' | 'atk'): number {
  let best = 0;
  for (const key of poolKeysOf(map)) {
    const value = t.enemies[key]?.[field];
    if (typeof value === 'number' && value > best) best = value;
  }
  return best;
}

/** v4.2 新增条目（带 `originKey` 溯源）：29 BOSS + 8 普通怪。 */
function newEntries(t: DataTables): Array<[string, EnemyEntry]> {
  return Object.entries(t.enemies)
    .map(([key, entry]) => [key, entry as unknown as EnemyEntry] as [string, EnemyEntry])
    .filter(([, entry]) => typeof entry.originKey === 'string');
}

/** 全部地图的 BOSS 引用。 */
function bossRefs(t: DataTables): Array<{ mapKey: string; bossKey: string }> {
  return Object.entries(t.maps)
    .filter(([, map]) => typeof map.boss === 'string')
    .map(([mapKey, map]) => ({ mapKey, bossKey: map.boss! }));
}

function worldMapsOf(t: DataTables): Array<[string, MapData]> {
  return Object.entries(t.maps).filter(([key]) => key.startsWith('world.'));
}

function chaosMapsOf(t: DataTables): Array<[string, MapData]> {
  return Object.entries(t.maps).filter(([key]) => key.startsWith('chaos.'));
}

/** 门禁 1：一 BOSS 一实体 —— 任一 BOSS key 只被一张图引用。 */
function duplicateBossRefs(t: DataTables): string[] {
  const byBoss = new Map<string, string[]>();
  for (const { mapKey, bossKey } of bossRefs(t)) {
    const list = byBoss.get(bossKey) ?? [];
    list.push(mapKey);
    byBoss.set(bossKey, list);
  }
  return [...byBoss]
    .filter(([, maps]) => maps.length > 1)
    .map(([bossKey, maps]) => `${bossKey} 被 ${maps.join(' + ')} 共用`);
}

/** 门禁 2：BOSS 不入普通池 —— 所有 `map.boss` 的 key ∩ 所有普通池 key = ∅。 */
function bossesInNormalPools(t: DataTables): string[] {
  const bossKeys = new Set(bossRefs(t).map((r) => r.bossKey));
  const out: string[] = [];
  for (const [mapKey, map] of Object.entries(t.maps)) {
    for (const key of poolKeysOf(map)) {
      if (bossKeys.has(key)) out.push(`${mapKey} 普通池含有 BOSS ${key}`);
    }
  }
  return out;
}

/**
 * 门禁 3a：**野外**数值地板（§5.3，13 图逐图核验）：
 * `BOSS.maxHp ≥ 3×本图最强杂兵 HP`、`BOSS.atk ≥ 1.5×本图最强杂兵 ATK`。
 */
function worldFloorViolations(t: DataTables): string[] {
  const out: string[] = [];
  for (const [mapKey, map] of worldMapsOf(t)) {
    const boss = t.enemies[map.boss ?? ''];
    if (!boss) {
      out.push(`${mapKey} 的 BOSS ${map.boss} 不存在`);
      continue;
    }
    const hp = strongestMobOf(t, map, 'maxHp');
    const atk = strongestMobOf(t, map, 'atk');
    if ((boss.maxHp ?? 0) < 3 * hp) out.push(`${mapKey}: BOSS HP ${boss.maxHp} < 3×${hp}`);
    if ((boss.atk ?? 0) < 1.5 * atk) out.push(`${mapKey}: BOSS ATK ${boss.atk} < 1.5×${atk}`);
  }
  return out;
}

/**
 * 门禁 3b：精英 `×4` 的**静态上界**（§10.2）。
 *
 * 三态里 BOSS 与精英**不会同场**（开荒态精英第 10 波 / BOSS 第 20 波；挂机态无 BOSS；
 * 混沌态不出精英），所以这只是保守上界。两图有**明确记录**的豁免：
 *  - `world.1`：段首 BOSS 受 `≤200 / ≤5` 硬上限保护（否则会卡死解锁链），160 < 3×4×25；
 *  - `world.3`：3000 < 3×4×300，但 BOSS 仍为精英的 2.5×，且二者从不同场。
 */
const ELITE_HP_X4_EXEMPT = new Set(['world.1', 'world.3']);

function eliteUpperBoundViolations(t: DataTables): string[] {
  const out: string[] = [];
  for (const [mapKey, map] of worldMapsOf(t)) {
    if (ELITE_HP_X4_EXEMPT.has(mapKey)) continue;
    const boss = t.enemies[map.boss ?? ''];
    const need = 3 * 4 * strongestMobOf(t, map, 'maxHp');
    if (!boss || (boss.maxHp ?? 0) < need) {
      out.push(`${mapKey}: BOSS HP ${boss?.maxHp} < 3×4×杂兵(${need})`);
    }
  }
  return out;
}

/**
 * 门禁 3c：**混沌**数值地板。HP 与野外同法；ATK 有三个**已记录**豁免阶。
 *
 * §9.3 Q2 已拍板「本轮不动」池里的 `chapter3.murloc.slaves`（atk 1000）——
 * T4/T5/T6 的 BOSS ATK 因而低于 `1.5×` 地板。设计稿 §5.3 的核验表只覆盖 13 张野外图。
 */
const CHAOS_ATK_FLOOR_EXEMPT = new Set(['chaos.t04', 'chaos.t05', 'chaos.t06']);

function chaosFloorViolations(t: DataTables): string[] {
  const out: string[] = [];
  for (const [mapKey, map] of chaosMapsOf(t)) {
    const boss = t.enemies[map.boss ?? ''];
    if (!boss) {
      out.push(`${mapKey} 的 BOSS ${map.boss} 不存在`);
      continue;
    }
    const hp = strongestMobOf(t, map, 'maxHp');
    if ((boss.maxHp ?? 0) < 3 * hp) out.push(`${mapKey}: BOSS HP ${boss.maxHp} < 3×${hp}`);
    if (!CHAOS_ATK_FLOOR_EXEMPT.has(mapKey)) {
      const atk = strongestMobOf(t, map, 'atk');
      if ((boss.atk ?? 0) < 1.5 * atk) out.push(`${mapKey}: BOSS ATK ${boss.atk} < 1.5×${atk}`);
    }
  }
  return out;
}

/** 门禁 4：战力（`maxHp × atk`）单调。野外按段位「不减」，混沌按 T 阶「严格递增」。 */
function powerOf(t: DataTables, mapKey: string): number {
  const boss = t.enemies[t.maps[mapKey]?.boss ?? ''];
  return (boss?.maxHp ?? 0) * (boss?.atk ?? 0);
}

function worldPower(t: DataTables): Array<[string, number]> {
  return worldMapsOf(t)
    .map(([key]) => [key, powerOf(t, key)] as [string, number])
    .sort((a, b) => Number(a[0].slice('world.'.length)) - Number(b[0].slice('world.'.length)));
}

function chaosPower(t: DataTables): Array<[string, number]> {
  return chaosMapsOf(t)
    .map(([key]) => [key, powerOf(t, key)] as [string, number])
    .sort((a, b) => Number(a[0].slice('chaos.t'.length)) - Number(b[0].slice('chaos.t'.length)));
}

/** 门禁 5：可战性 —— 新增 BOSS / 普通怪必须 `camp:'enemy'`、非 `onPress`、`loots` 非空。 */
function combatWorthinessViolations(t: DataTables): string[] {
  const out: string[] = [];
  for (const [key, entry] of newEntries(t)) {
    if (entry.camp !== 'enemy') out.push(`${key}: camp=${String(entry.camp)}`);
    if (entry.onPress) out.push(`${key}: 是 onPress 机关`);
    if (!Array.isArray(entry.loots) || entry.loots.length === 0) out.push(`${key}: loots 为空`);
  }
  return out;
}

/** 门禁 6：不抬人名 —— 新条目名字不得包含原生人形单位的个人名（§2.2）。 */
const FORBIDDEN_NAME_PARTS = ['卡罗', '奈布', '金牙', '萨布罗', '铁匠发狂', '鱼人督军', '彭彭', '辛巴', '丁满', '阿撒托斯', '奈因洛斯'];

function personNameViolations(t: DataTables): string[] {
  const out: string[] = [];
  for (const [key, entry] of newEntries(t)) {
    for (const part of FORBIDDEN_NAME_PARTS) {
      if (entry.name.includes(part)) out.push(`${key}: "${entry.name}" 含人名 "${part}"`);
    }
  }
  return out;
}

/**
 * 门禁 7：三合同族（P6）—— 每张**野外图**的普通池与 BOSS 必须落在同一族白名单内。
 * 混沌图的池 / BOSS 是既有内容（`boss.chaos.TNN` 为全新建制），不参与本门禁。
 */
const FAMILY_OF: Record<string, string> = {
  'slime.minimal': 'slime',
  'slime.giant.enemy': 'slime',
  'boss.world.01': 'slime',
  'boss.world.02': 'slime',
  'wolf.minimal': 'wolf',
  'wolf.giant': 'wolf',
  'wolf.frost': 'wolf',
  'boss.world.03': 'wolf',
  'boss.world.04': 'wolf',
  'kobold.miner': 'kobold',
  'kobold.shaman': 'kobold',
  'kobold.digger': 'kobold',
  'boss.world.06': 'kobold',
  'mine.ghoul': 'mine',
  'boss.world.05': 'mine',
  'knight.normal': 'knight',
  'knight.prayer': 'knight',
  'boss.world.07': 'knight',
  'chapter3.undead.ghost': 'undead',
  'chapter3.undead.zombie': 'undead',
  'chapter3.undead.ghostShield': 'undead',
  'boss.world.08': 'undead',
  'chapter3.beast.wildpig': 'beast',
  'chapter3.beast.lion': 'beast',
  'beast.bear': 'beast',
  'boss.world.09': 'beast',
  'mino.grunt': 'minotaur',
  'mino.seer': 'minotaur',
  'boss.world.10': 'minotaur',
  'chapter3.element.earth': 'element',
  'chapter3.element.fire': 'element',
  'chapter3.element.water': 'element',
  'boss.world.12': 'element',
  'hydra.spawn': 'hydra',
  'boss.world.11': 'hydra',
  'chapter3.murloc.minions': 'murloc',
  'chapter3.murloc.shaman': 'murloc',
  'phoenix.spark': 'phoenix',
  'boss.world.13': 'phoenix',
};

const MAP_ALLOWED_FAMILIES: Record<string, string[]> = {
  'world.1': ['slime'],
  'world.2': ['slime'],
  'world.3': ['wolf'],
  'world.4': ['wolf'],
  // 熔炉矿坑：狗头人占据的旧矿坑 + 坑底怨魂（矿坑族）。
  'world.5': ['mine', 'kobold'],
  'world.6': ['kobold'],
  'world.7': ['knight'],
  'world.8': ['undead'],
  'world.9': ['beast'],
  // 牛头人迷宫：牛头人 + 迷宫石像（元素）。
  'world.10': ['minotaur', 'element'],
  // 九头蛇深潭：水蛇 + 水中的鱼人喽啰。
  'world.11': ['hydra', 'murloc'],
  'world.12': ['element'],
  // 不死鸟圣坛：火系 + 不死鸟雏。
  'world.13': ['element', 'phoenix'],
};

function familyViolations(t: DataTables): string[] {
  const out: string[] = [];
  for (const [mapKey, map] of worldMapsOf(t)) {
    const allowed = MAP_ALLOWED_FAMILIES[mapKey];
    if (!allowed) {
      out.push(`${mapKey}: 未登记主题族`);
      continue;
    }
    const keys = [...poolKeysOf(map), ...(map.boss ? [map.boss] : [])];
    for (const key of keys) {
      const family = FAMILY_OF[key];
      if (family === undefined) out.push(`${mapKey} → ${key}: 未归类`);
      else if (!allowed.includes(family)) out.push(`${mapKey} → ${key}(${family}) 不在 ${allowed.join('/')}`);
    }
  }
  return out;
}

describe('守关 BOSS 重做（v4.2）· 7 条门禁', () => {
  it('门禁 1：每个 BOSS key 只被一张图引用（一实体一角色 P2）', () => {
    expect(duplicateBossRefs(tables)).toEqual([]);
    // 反向用例：把 world.2 的 BOSS 改成 world.1 的 ⇒ 必须红。
    const bad = badTables();
    bad.maps['world.2']!.boss = bad.maps['world.1']!.boss;
    expect(duplicateBossRefs(bad).length).toBeGreaterThan(0);
  });

  it('门禁 2：任何 BOSS key 都不得出现在普通刷怪池（P1 一 BOSS 一实体）', () => {
    expect(bossesInNormalPools(tables)).toEqual([]);
    // 反向用例：把一只 BOSS 塞进同图普通池 ⇒ 必须红。
    const bad = badTables();
    bad.maps['world.1']!.monsters![0]!.types!['boss.world.01'] = 1;
    expect(bossesInNormalPools(bad).length).toBeGreaterThan(0);
  });

  it('门禁 3a：野外 13 图 BOSS 压过最强杂兵（≥3×HP / ≥1.5×ATK，§5.3）', () => {
    expect(worldFloorViolations(tables)).toEqual([]);
    const bad = badTables();
    bad.enemies['boss.world.01']!.maxHp = 1;
    expect(worldFloorViolations(bad).length).toBeGreaterThan(0);
  });

  it('门禁 3b：精英 ×4 静态上界（§10.2；world.1 / world.3 有记录地豁免）', () => {
    expect(eliteUpperBoundViolations(tables)).toEqual([]);
    const bad = badTables();
    bad.enemies['boss.world.13']!.maxHp = 1;
    expect(eliteUpperBoundViolations(bad).length).toBeGreaterThan(0);
  });

  it('门禁 3c：混沌 HP 地板 + ATK 地板（T4/T5/T6 因 murloc.slaves 记录豁免）', () => {
    expect(chaosFloorViolations(tables)).toEqual([]);
    // 豁免不是「随便写的」：三图的池里必须真的有那只记录在案的精英杂兵。
    for (const key of CHAOS_ATK_FLOOR_EXEMPT) {
      expect(poolKeysOf(tables.maps[key]!), key).toContain('chapter3.murloc.slaves');
    }
    const bad = badTables();
    bad.enemies['boss.chaos.T01']!.maxHp = 1;
    expect(chaosFloorViolations(bad).length).toBeGreaterThan(0);
  });

  it('门禁 4：战力单调 —— 野外「不减」、混沌「严格递增」', () => {
    const world = worldPower(tables);
    for (let i = 1; i < world.length; i += 1) {
      expect(world[i]![1], `${world[i - 1]![0]} → ${world[i]![0]}`).toBeGreaterThanOrEqual(world[i - 1]![1]);
    }
    const chaos = chaosPower(tables);
    for (let i = 1; i < chaos.length; i += 1) {
      expect(chaos[i]![1], `${chaos[i - 1]![0]} → ${chaos[i]![0]}`).toBeGreaterThan(chaos[i - 1]![1]);
    }
    // 反向用例：交换 world.1 / world.13 的 BOSS ⇒ 单调性必须红。
    const bad = badTables();
    const a = bad.maps['world.1']!.boss;
    bad.maps['world.1']!.boss = bad.maps['world.13']!.boss;
    bad.maps['world.13']!.boss = a;
    const p = worldPower(bad);
    expect(p.some(([, v], i) => i > 0 && v < p[i - 1]![1])).toBe(true);
  });

  it('门禁 5：新增 BOSS / 普通怪可战（enemy + 非机关 + loots 非空）', () => {
    expect(combatWorthinessViolations(tables)).toEqual([]);
    const bad = badTables();
    delete (bad.enemies['boss.world.05'] as unknown as { loots?: unknown }).loots;
    expect(combatWorthinessViolations(bad).length).toBeGreaterThan(0);
  });

  it('门禁 6：新条目名字不抬原生个人名（P4）', () => {
    expect(personNameViolations(tables)).toEqual([]);
    const bad = badTables();
    bad.enemies['boss.world.07']!.name = '骑士队长卡罗';
    expect(personNameViolations(bad).length).toBeGreaterThan(0);
  });

  it('门禁 7：野外图三合同族 —— 普通池与 BOSS 同族同域（P6）', () => {
    expect(familyViolations(tables)).toEqual([]);
    const bad = badTables();
    // 往狼主题的 world.3 池里塞一只鱼人 ⇒ 必须红。
    bad.maps['world.3']!.monsters![0]!.types!['chapter3.murloc.minions'] = 1;
    expect(familyViolations(bad).length).toBeGreaterThan(0);
  });

  it('覆盖：29 BOSS + 8 普通怪全部带 originKey 溯源（P5 只加不改）', () => {
    const entries = newEntries(tables);
    const bosses = entries.filter(([key]) => key.startsWith('boss.'));
    const mobs = entries.filter(([key]) => !key.startsWith('boss.'));
    expect(bosses).toHaveLength(29);
    expect(mobs).toHaveLength(8);
    for (const [key, entry] of entries) {
      expect(typeof entry.originKey, key).toBe('string');
      // 溯源必须指向真实存在的原生条目。
      expect(tables.enemies[entry.originKey as string], `${key} → ${String(entry.originKey)}`).toBeDefined();
    }
  });

  it('勘误 §1.1-4b：world.9 / world.11 新池不含 `simba.goodFriends` 携带者 ⇒ 消除 W12 尾巴', () => {
    const carriers = new Set(['chapter3.beast.simba', 'chapter3.beast.pengpeng', 'chapter3.beast.dingman']);
    for (const mapKey of ['world.9', 'world.11']) {
      const map = tables.maps[mapKey]!;
      for (const key of poolKeysOf(map)) {
        expect(carriers.has(key), `${mapKey} 池含携带者 ${key}`).toBe(false);
      }
    }
    // world.9 的 BOSS 仍按 §5.4 沿用该 buff（确认它本身是携带者）。
    expect((tables.enemies['boss.world.09'] as unknown as EnemyEntry).buffs).toContainEqual({ type: 'simba.goodFriends' });
    // world.11 的 BOSS（原彭彭）**不继承** buff ⇒ 不再产生「BOSS 死后停刷」。
    expect((tables.enemies['boss.world.11'] as unknown as EnemyEntry).buffs ?? []).toEqual([]);
  });
});
