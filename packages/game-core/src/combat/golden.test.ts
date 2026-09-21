/**
 * 金样回归（任务书门禁 1）。
 *
 * 固定 `seed` + 固定初始状态（内联 fixture 的 1 级玩家 + `field` 持续刷 dummy），
 * 推进固定虚拟时长，断言：
 * 1. **同种子两次运行的事件流与最终状态逐字节一致**；
 * 2. 事件流与最终状态的 FNV-1a 哈希等于首次运行记录下来的金样常数；
 * 3. 换种子必须得到不同的事件流（证明随机确实参与了推演，不是「假确定性」）。
 */

import { describe, expect, it } from 'vitest';

import type { BattleWorld } from './battle-world.js';
import { hashString, makePlayer, makeTestWorld, type RecordingSink } from './test-support.js';

/** 金样参数：改动战斗逻辑时这里必须显式更新并解释原因。 */
const GOLDEN_SEED = 20240919;
const GOLDEN_MS = 30000;
// 事件哈希重录：`damage`/`heal`/`dodge` 新增可选 `skillName`，`exp` 新增可选 `whoId`
// （都只是给日志用的展示信息，见 §21）。**只改事件载荷，不影响战斗推演** ——
// 状态哈希仍是 0xf7d493b3、事件条数仍是 27、同种子两次运行仍逐字节一致。
const GOLDEN_EVENT_HASH = 0x1dd67f6b; // = 500596587
// W11 重录：`EnemyBorn.dumpState()` 新增 `lastEliteWave` / `lastBossWave` 两个里程碑字段
// （波次里程碑幂等与跨会话恢复要用，见 `spawner.ts`）。⚠️ 这是**状态快照的形状变化**，
// 不是推演变化 —— 证据：**事件哈希与事件条数都没动**（0x1dd67f6b / 27 条），
// 且金样场景（1 级玩家打 `field` 的 `dummy`、30s）里 `wave` 根本没推进到里程碑，
// 两个新字段恒为 0。
// 上一次重录留痕：W12 同屏上限改「全图存活敌对怪总数」（Born 被挡住时保持轮询，
// dumpState 的 timer 剩余时间随之变化）；事件流同样不变。
const GOLDEN_STATE_HASH = 0x3af5fd2f; // = 989199663
const GOLDEN_EVENT_COUNT = 27; // 首次运行记录，见交付报告
// ⚠️ 曾有一次「结算处取整」的改动重录过这三个常数，但随后撤销：取整改的是**平衡**
// （0.4→0 让弱怪打高防玩家彻底无效；保底 1 又抬高 <1 伤害），而原版只在**展示层**
// `Math.round`、引擎全程浮点（`dark-forever-memorize/src/logics/renderMessage.js`）。
// 因此取整回到展示层，战斗逻辑与金样保持原样。

interface GoldenRun {
  sink: RecordingSink;
  world: BattleWorld;
  eventsJson: string;
  stateJson: string;
}

function run(seed: number, ms = GOLDEN_MS): GoldenRun {
  const t = makeTestWorld({ seed, map: 'field' });
  t.world.addPlayer(makePlayer());
  t.world.onMapChanged();
  t.clock.advanceBy(ms);
  const eventsJson = JSON.stringify(t.sink.events);
  const stateJson = JSON.stringify(t.world.dumpState());
  return { sink: t.sink, world: t.world, eventsJson, stateJson };
}

describe('金样回归：固定种子 + 固定初始状态', () => {
  it('同种子两次运行逐字节一致', () => {
    const a = run(GOLDEN_SEED);
    const b = run(GOLDEN_SEED);
    expect(b.eventsJson).toBe(a.eventsJson);
    expect(b.stateJson).toBe(a.stateJson);
    expect(a.sink.events.length).toBeGreaterThan(0);
  });

  it(`事件流哈希 == 0x${GOLDEN_EVENT_HASH.toString(16)}`, () => {
    const a = run(GOLDEN_SEED);
    expect(hashString(a.eventsJson)).toBe(GOLDEN_EVENT_HASH);
    expect(a.sink.events.length).toBe(GOLDEN_EVENT_COUNT);
  });

  it(`世界最终状态哈希 == 0x${GOLDEN_STATE_HASH.toString(16)}`, () => {
    const a = run(GOLDEN_SEED);
    expect(hashString(a.stateJson)).toBe(GOLDEN_STATE_HASH);
  });

  it('换种子产生不同事件流（随机确实参与推演）', () => {
    const a = run(GOLDEN_SEED);
    const b = run(GOLDEN_SEED + 1);
    expect(b.eventsJson).not.toBe(a.eventsJson);
  });

  it('推进更长时间仍是确定性的（分片推进 == 一次性推进）', () => {
    const oneShot = run(GOLDEN_SEED, 20000);

    const t = makeTestWorld({ seed: GOLDEN_SEED, map: 'field' });
    t.world.addPlayer(makePlayer());
    t.world.onMapChanged();
    // 分片推进：每 250ms 一片，结果必须与一次性推进完全一致。
    for (let i = 0; i < 80; i++) {
      t.clock.advanceBy(250);
    }
    expect(JSON.stringify(t.sink.events)).toBe(oneShot.eventsJson);
    expect(JSON.stringify(t.world.dumpState())).toBe(oneShot.stateJson);
  });
});
