/**
 * 经验**不做等级差衰减**（W10 回归钉）。
 *
 * ## 背景：被移除的那道窗口
 *
 * `PlayerUnit.gotExp` 曾经按 `dis = min(自身等级, 70) − 怪物等级` 每级递减 10%，
 * 并在 `dis >= 10` 时**直接 return、经验归零**。而 W4 的段位模型是
 * 「怪物等级 = 地图等级（`levelOverride`）」「解锁门槛 = 上一段内容等级 + 10」——
 * 于是那道窗口**恰好等于段位宽度**：越接近解锁线经验越低，到线正好归零。
 *
 * 在 `world.2`（地图等级 5）升 `world.3`（要求等级 15）上实测：
 * 13 级经验倍率 20%、14 级 10%、15 级 0%，13→14 需 **21228 次击杀 ≈ 5300 波**。
 * 全库 388 个角色中，除脚本 grant 出来的测试号，**没有任何角色自然推进过 `world.2`**。
 *
 * ## 现在的口径（本文件钉死的四件事）
 *
 * 1. 经验**只看怪物经验分布**（`enemyData.exp` × `2 ** quality`）与 `expRate`，
 *    **不随等级差变化**；
 * 2. `gotExp` 的第二个参数（怪物等级）保留为冻结端口契约，但**不参与计算** ——
 *    传 `0` / 负数 / `NaN` / `Infinity` / 极大值都不改变结果；
 * 3. 打远低于自身的怪**不倒扣、不归零**；打远高于自身的怪**也不加成**；
 * 4. 满级后经验仍然丢弃（Q8：无巅峰），这条与衰减无关，不要一起删。
 *
 * ⚠️ 后期调整经验曲线请改**数据**（`data/enemies.ts` 的 `exp`）或 `expRate`，
 * **不要**重新引入等级差系数 —— 那会把段位推进链再次锁死。
 */
import { describe, expect, it } from 'vitest';

import { makePlayer, makeTables, makeTestWorld } from './test-support.js';

/** 在地图等级 `mapLevel` 上击杀一只 `dummy`（数据等级 1、`exp = 10`），返回玩家与 exp 事件值。 */
function killDummy(
  mapLevel: number,
  playerLevel: number,
  quality = 0,
): {
  player: ReturnType<typeof makePlayer>;
  amounts: number[];
} {
  const tables = makeTables();
  tables.maps['field']!.level = mapLevel;
  const player = makePlayer({ level: playerLevel, exp: 0, maxExp: 1_000_000 });
  const t = makeTestWorld({ seed: 1, tables, player, map: 'field' });
  t.world.addPlayer(player);

  const enemy = t.world.addEnemy('dummy', null, quality);
  enemy.kill(false);

  const amounts = t.sink.events
    .filter((e) => e.kind === 'exp')
    .map((e) => e.amount as number);
  return { player, amounts };
}

describe('经验不做等级差衰减', () => {
  it('段下界：玩家等级 = 地图等级 → 足额', () => {
    const { player, amounts } = killDummy(25, 25);
    expect(amounts).toEqual([10]);
    expect(player.exp).toBe(10);
  });

  it('段内 L+5：**不再减半**（旧实现给 5）', () => {
    const { amounts } = killDummy(25, 30);
    expect(amounts).toEqual([10]);
  });

  it('段上界 L+10：**不再归零**（旧实现 `dis = 10` → 不发 exp 事件）', () => {
    const { player, amounts } = killDummy(25, 35);
    expect(amounts).toEqual([10]);
    expect(player.exp).toBe(10);
  });

  it('越级 10 级以上：**不再归零**（旧实现直接 return）', () => {
    const { amounts } = killDummy(1, 15);
    expect(amounts).toEqual([10]);
  });

  it('极远等级差（地图 1 级 / 玩家 100 级）：仍足额', () => {
    const { amounts } = killDummy(1, 100);
    expect(amounts).toEqual([10]);
  });

  it('低等级打高等级图：不倒扣（不是负数），也不加成', () => {
    const { amounts } = killDummy(75, 65);
    expect(amounts).toEqual([10]);
  });

  it('每个段下界 L 都有经验且等于数据值（L=1/5/15/25/75/85）', () => {
    for (const level of [1, 5, 15, 25, 75, 85]) {
      const { amounts, player } = killDummy(level, level);
      expect(amounts, `map=${level} player=${level}`).toEqual([10]);
      expect(player.exp, `map=${level}`).toBeGreaterThan(0);
    }
  });

  it('品质仍然放大经验：`exp × 2 ** quality`（精英 = quality 2 → ×4）', () => {
    expect(killDummy(25, 25, 0).amounts).toEqual([10]);
    expect(killDummy(25, 25, 1).amounts).toEqual([20]);
    expect(killDummy(25, 25, 2).amounts).toEqual([40]);
  });
});

describe('gotExp 的第二个参数（怪物等级）不再参与计算', () => {
  /** 玩家 1 级，直接调 `world.gotExp(v, level)`，返回 sink 上报的 exp 值。 */
  function expForLevelParam(level: number): number | undefined {
    const player = makePlayer({ level: 1, exp: 0, maxExp: 1_000_000 });
    const t = makeTestWorld({ seed: 1, tables: makeTables(), player, map: 'field' });
    t.world.addPlayer(player);
    t.world.gotExp(100, level);
    const events = t.sink.events.filter((e) => e.kind === 'exp');
    return events.at(-1)?.amount as number | undefined;
  }

  it('0 / 负数 / NaN / Infinity / 极大值 都得到同一个结果（旧实现多数情况给 0）', () => {
    // 旧实现：玩家 1 级、怪物等级 0 → dis = 1 → 90%；NaN / Infinity → 归零。
    for (const level of [0, -1, -1e9, Number.NaN, Infinity, -Infinity, 1e9, 1]) {
      expect(expForLevelParam(level), `level=${level}`).toBe(100);
    }
  });

  it('自身等级 70 以上也不再被 70 截断（旧实现用 `min(level, 70)` 参与判定）', () => {
    const player = makePlayer({ level: 120, exp: 0, maxExp: 1_000_000 });
    const t = makeTestWorld({ seed: 1, tables: makeTables(), player, map: 'field' });
    t.world.addPlayer(player);
    t.world.gotExp(100, 1);
    expect(t.sink.events.filter((e) => e.kind === 'exp').at(-1)?.amount).toBe(100);
  });
});

describe('与衰减无关、必须保留的行为', () => {
  it('满级后经验仍然丢弃（不再有任何巅峰轨迹）', () => {
    const player = makePlayer({ level: 100, maxLevel: 100, exp: 0, maxExp: 100 });
    const t = makeTestWorld({ seed: 1, tables: makeTables(), player, map: 'field' });
    t.world.addPlayer(player);
    t.world.gotExp(1_000_000, 1);
    expect(player.level).toBe(100);
    expect(player.exp).toBe(0);
    // sink 仍如实上报（收益报告要用），丢弃只发生在 `player.exp` 累加处。
    expect(t.sink.events.filter((e) => e.kind === 'exp').at(-1)?.amount).toBe(1_000_000);
  });

  it('没有玩家单位时不崩（receivers 为空 → 不发事件）', () => {
    const t = makeTestWorld({ seed: 1, tables: makeTables(), map: 'field' });
    expect(() => t.world.gotExp(100, 1)).not.toThrow();
    expect(t.sink.events.filter((e) => e.kind === 'exp')).toEqual([]);
  });
});
