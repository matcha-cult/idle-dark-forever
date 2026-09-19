/**
 * 数据层「内核方法缺失 / 取错接收者」回归单测。
 *
 * 两个缺陷同源（详见 `data/_shapes.gate.ts` 与 AGENTS §11 的 `lootRule` 教训）：
 *
 *  1. `world.sendGeneralMsg(...)`：`enemies.ts` 里 26 处机关提示 / BOSS 对话调用了它，
 *     但 `BattleWorld` 上**根本没有这个方法** ⇒ 每次调用抛
 *     `world.sendGeneralMsg is not a function`，在线被 tick 的 try/catch 吞成一条 WARN，
 *     离线被结算的 catch 吞掉 —— 玩家永远看不到这些提示。
 *     修法：在 `BattleWorld` 上补适配器，转发到既有端口 `BattleSink.general`。
 *
 *  2. `year2018.heal` 的 `effect` 写的是 `this.summoner`，但引擎调用该 hook 时
 *     `this` 是 **SkillState**（`SkillState.effect` 里的 `skillData.effect.call(this, ...)`），
 *     而 `summoner` 只存在于 `Unit` ⇒ 恒为 `undefined`，配合 `if (!target) return;`
 *     使这个技能**永远静默不生效**。修法：从第二参数（施法单位）取 `self.summoner`。
 */
import { describe, expect, it } from 'vitest';

import { createDefaultTables } from '../data/index.js';
import { SkillState } from './skill-state.js';
import { makePlayer, makeTestWorld } from './test-support.js';

describe('BattleWorld.sendGeneralMsg（原版 world.sendGeneralMsg → BattleSink.general）', () => {
  it('提示文本原样透传到 sink.general', () => {
    const t = makeTestWorld({ map: 'home', seed: 7 });
    t.world.sendGeneralMsg('科力克：年轻的战士，你是否具备足够的毅力？');

    expect(t.sink.events).toEqual([
      { kind: 'general', text: '科力克：年轻的战士，你是否具备足够的毅力？' },
    ]);
  });

  it('不再抛 is not a function；空串与数字等边界按 String() 归一', () => {
    const t = makeTestWorld({ map: 'home', seed: 7 });

    expect(() => t.world.sendGeneralMsg('')).not.toThrow();
    t.world.sendGeneralMsg(0 as unknown as string);
    t.world.sendGeneralMsg(null as unknown as string);

    const texts = t.sink.events.map((e) => (e as { text: string }).text);
    expect(texts).toEqual(['', '0', 'null']);
  });

  it('真实数据链路：进图产生的 enemy.appear 与本方法走同一条 general 通道', () => {
    const t = makeTestWorld({ map: 'home', seed: 7 });
    t.world.addPlayer(makePlayer());
    t.world.addEnemy('dummy', null);

    t.world.sendGeneralMsg('机关被触动了。');
    expect(t.sink.events.map((e) => (e as { text: string }).text)).toEqual([
      'enemy.appear:Dummy',
      '机关被触动了。',
    ]);
  });
});

describe('year2018.heal 的施法者取法（this.summoner 恒 undefined 的修复）', () => {
  /** 造一只「召唤物 + 召唤者」：effect 应当治疗召唤者。 */
  function makeSummon() {
    const tables = createDefaultTables();
    const t = makeTestWorld({ map: 'home', tables, seed: 11 });
    const summoner = t.world.addPlayer(makePlayer());
    // 第 4 个参数是 summoner；`borner` 传 null 表示非刷怪点出身。
    const summon = t.world.addEnemy('slime.minimal', null, 0, summoner);
    return { t, summoner, summon };
  }

  it('effect 治疗的是 summoner（修复前 hp 完全不变）', () => {
    const { t, summoner, summon } = makeSummon();
    summoner.hp = 1;
    const before = summoner.hp;

    const state = new SkillState(t.world, summon, 'year2018.heal', {});
    expect(() => state.effect()).not.toThrow();

    // `Unit.hp` 的 setter 会 clamp 到 maxHp，所以断言「确实涨了且涨到上限」
    expect(summoner.hp).toBeGreaterThan(before);
    expect(summoner.hp).toBe(summoner.maxHp);
  });

  it('canUse：只有召唤者血量低于 25% 才可用（原版 self.summoner 语义）', () => {
    const { t, summon } = makeSummon();
    const state = new SkillState(t.world, summon, 'year2018.heal', {});
    const canUse = t.world.tables.skills['year2018.heal']!.canUse!;

    const summoner = summon.summoner!;
    summoner.hp = Math.floor(summoner.maxHp * 0.5);
    expect(canUse.call(state, t.world, summon, 1)).toBe(false);

    summoner.hp = Math.max(1, Math.floor(summoner.maxHp * 0.1));
    expect(canUse.call(state, t.world, summon, 1)).toBe(true);
  });

  it('无召唤者时两者都安全返回（不抛错 / 不可用）', () => {
    const tables = createDefaultTables();
    const t = makeTestWorld({ map: 'home', tables, seed: 13 });
    t.world.addPlayer(makePlayer());
    const lonely = t.world.addEnemy('slime.minimal', null, 0, null);

    const state = new SkillState(t.world, lonely, 'year2018.heal', {});
    expect(() => state.effect()).not.toThrow();
    expect(t.world.tables.skills['year2018.heal']!.canUse!.call(state, t.world, lonely, 1)).toBe(
      false,
    );
  });
});
