/**
 * `BattleWorld.sendSkillUsage` 回归单测
 *
 * 背景：数据表技能（`data/skills.ts`）的 `effect` 会调用
 * `world.sendSkillUsage(...)`，但 `BattleWorld` 此前**没有该方法** —— 触发这些技能的战斗会抛
 * `world.sendSkillUsage is not a function`，异常被上层 catch 吞掉（离线秘境整段无收益）。
 *
 * 覆盖：sink 未实现（可选端口）→ 不抛错；sink 实现 → 收到结构化载荷；空目标 / 非技能来源边界。
 */
import { describe, expect, it } from 'vitest';
import { makePlayer, makeTestWorld } from './test-support.js';

describe('BattleWorld.sendSkillUsage', () => {
  it('sink 未实现 `skillUsage` → 安全 no-op（不抛错）', () => {
    const t = makeTestWorld({ seed: 1 });
    const player = t.world.addPlayer(makePlayer());
    expect(() => t.world.sendSkillUsage(player, null, null)).not.toThrow();
    expect(() => t.world.sendSkillUsage(player, [player], null)).not.toThrow();
  });

  it('sink 实现时收到结构化载荷；`targets = null` → 空数组', () => {
    const t = makeTestWorld({ seed: 1 });
    const seen: Array<{ unitId: string; name: string; targets: string[]; skill: string }> = [];
    (t.sink as unknown as { skillUsage: (e: (typeof seen)[number]) => void }).skillUsage = (e) =>
      seen.push(e);
    const player = t.world.addPlayer(makePlayer());

    t.world.sendSkillUsage(player, [player], null);
    t.world.sendSkillUsage(player, null, null);

    expect(seen).toHaveLength(2);
    expect(seen[0]?.unitId).toBe(player.id);
    expect(seen[0]?.targets).toEqual([player.id]);
    expect(seen[0]?.skill).toBe('');
    expect(seen[1]?.targets).toEqual([]);
    expect(typeof seen[0]?.name).toBe('string');
  });
});
