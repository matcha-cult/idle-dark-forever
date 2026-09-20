/**
 * 经验衰减窗口 vs 等级段（W9 回归）。
 *
 * 缺陷背景：`EnemyUnit.kill()` 曾把怪物等级**先 `transformEquipLevel`（1~120 级减半）**
 * 再交给 `PlayerUnit.gotExp` 做等级差衰减。而 W4 的规则是「普通 = 地图等级」、
 * 段位 = 玩家等级带 —— 于是 `dis = 玩家等级 − 地图等级/2`：
 * world.4（地图等级 25）起，玩家一到进图门槛（25）就已经 `dis=12 ≥ 10`，**经验恒为 0**，
 * 进度永久卡在 ~Lv.20，够不到后续解锁门槛（死锁）。
 *
 * 修复：经验判定改用**怪物真实等级**（`EnemyUnit.level`，含 W4 的 `levelOverride`）。
 * 本文件钉死「经验窗口 = 段位」：地图等级 L 的怪，在玩家 `< L+10` 时给经验、`≥ L+10` 时归零。
 */
import { describe, expect, it } from 'vitest';

import { makePlayer, makeTables, makeTestWorld } from './test-support.js';

/** 在地图等级 `mapLevel` 上击杀一只 `dummy`（数据等级 1、exp=10），返回玩家与 sink。 */
function killDummy(mapLevel: number, playerLevel: number): {
  player: ReturnType<typeof makePlayer>;
  amounts: number[];
} {
  const tables = makeTables();
  tables.maps['field']!.level = mapLevel;
  const player = makePlayer({ level: playerLevel, exp: 0, maxExp: 1_000_000 });
  const t = makeTestWorld({ seed: 1, tables, player, map: 'field' });
  t.world.addPlayer(player);

  const enemy = t.world.addEnemy('dummy', null, 0);
  // W4：非混沌地图的普通怪等级覆写为地图等级。
  expect(enemy.level, `map=${mapLevel} 的普通怪等级`).toBe(mapLevel);
  enemy.kill(false);

  const amounts = t.sink.events
    .filter((e) => e.kind === 'exp')
    .map((e) => e.amount as number);
  return { player, amounts };
}

describe('经验衰减窗口与等级段对齐', () => {
  it('段下界：玩家等级 = 地图等级 → 不衰减，足额经验', () => {
    // 旧实现（transformEquipLevel(25)=13）会给 0。
    const { player, amounts } = killDummy(25, 25);
    expect(amounts).toEqual([10]);
    expect(player.exp).toBe(10);
  });

  it('每个段下界 L 都有经验（L=1/15/25/75/85）', () => {
    for (const level of [1, 15, 25, 75, 85]) {
      const { amounts, player } = killDummy(level, level);
      expect(amounts, `map=${level} player=${level}`).toEqual([10]);
      expect(player.exp, `map=${level}`).toBeGreaterThan(0);
    }
  });

  it('段内 L+5：经验减半', () => {
    const { amounts } = killDummy(25, 30);
    expect(amounts).toEqual([5]);
  });

  it('段上界 L+10：`dis = 10` → 归零（不发 exp 事件）', () => {
    const { amounts, player } = killDummy(25, 35);
    expect(amounts).toEqual([]);
    expect(player.exp).toBe(0);
  });

  it('越级 10 级以上：归零', () => {
    const { amounts } = killDummy(1, 15);
    expect(amounts).toEqual([]);
  });

  it('低等级打高等级图：不倒扣，足额经验', () => {
    const { amounts } = killDummy(75, 65);
    expect(amounts).toEqual([10]);
  });
});
