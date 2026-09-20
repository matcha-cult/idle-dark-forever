/**
 * `ChaosLogicService` 在线编排集成单测（W6）—— 内存夹具，不碰 DB。
 *
 * 覆盖：解锁门槛 / start 消耗钥石进入正确阶 / clear 前进 / death(回普通) / death(继续，3 连败跳过)
 * / 缺钥石干净停止 / 地图列表隐藏混沌图。
 *
 * 事件驱动路径走真实 `InProcessEventBus`（与运行时同一条链路）：emit 后等一个宏任务，
 * 让 `onModuleInit` 里 fire-and-forget 的异步推进收敛。
 */
import { describe, expect, it } from 'vitest';
import type { ActionResult, WorldSnapshotDto } from '@idle-dark/protocol';
import { worldBossMapKeys } from '@idle-dark/game-core';
import { ChaosLogicService } from '../../../src/modules/logic/chaos/chaos.logic.service.js';
import { mapListDtoOf } from '../../../src/modules/logic/shared/map-dto.js';
import { InProcessEventBus } from '../../../src/modules/logic/shared/event-bus.js';
import type { BattleCommandPort } from '../../../src/modules/logic/shared/battle-command.js';
import { giveInventory, makeFakeContexts, makeFixture, type Fixture } from '../_helpers.js';

interface EnterCall {
  userId: number;
  characterId: string;
  mapKey: string;
  allowChaos: boolean;
}

function makeBattle(): { calls: EnterCall[]; battle: BattleCommandPort } {
  const calls: EnterCall[] = [];
  const battle = {
    enterMap: async (
      userId: number,
      characterId: string,
      mapKey: string,
      _opId?: string,
      options?: { allowChaos?: boolean },
    ): Promise<ActionResult<WorldSnapshotDto>> => {
      calls.push({ userId, characterId, mapKey, allowChaos: options?.allowChaos === true });
      return { success: true, data: { map: mapKey } as never };
    },
  } as unknown as BattleCommandPort;
  return { calls, battle };
}

function unlockedFixture(): Fixture {
  const fixture = makeFixture();
  for (const key of worldBossMapKeys(fixture.tables.maps)) {
    fixture.player.markWorldBossKilled(key);
  }
  return fixture;
}

function makeService(fixture: Fixture) {
  const { calls, battle } = makeBattle();
  const bus = new InProcessEventBus();
  const service = new ChaosLogicService(makeFakeContexts(fixture), battle, bus);
  service.onModuleInit();
  return { service, calls, bus };
}

/** 发一次 battle 结算事件并等异步推进收敛。 */
async function emitEnded(
  bus: InProcessEventBus,
  tier: number,
  outcome: 'clear' | 'death',
): Promise<void> {
  bus.emit({ type: 'ChaosRunEnded', userId: 1, characterId: 'char-1', tier, outcome });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function expectOk<T>(result: ActionResult<T>): Promise<T> {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('unreachable');
  return result.data;
}

describe('ChaosLogicService · 解锁门槛', () => {
  it('未通关全部野外 BOSS：state.unlocked=false、阶位全锁、start 拒绝', async () => {
    const fixture = makeFixture();
    const { service, calls } = makeService(fixture);
    const state = await expectOk(await service.state(1, 'char-1'));
    expect(state.unlocked).toBe(false);
    expect(state.tiers).toHaveLength(16);
    expect(state.tiers.every((tier) => tier.unlocked === false)).toBe(true);
    expect(state.tiers[0]).toMatchObject({
      tier: 1,
      mapKey: 'chaos.t01',
      level: 85,
      keystoneKey: 'keystone.t01',
    });

    const started = await service.start(1, 'char-1');
    expect(started.success).toBe(false);
    if (!started.success) expect(started.data.code).toBe('CHAOS_LOCKED');
    expect(calls).toHaveLength(0);
  });

  it('通关全部 13 个野外 BOSS 后解锁', async () => {
    const fixture = unlockedFixture();
    const { service } = makeService(fixture);
    const state = await expectOk(await service.state(1, 'char-1'));
    expect(state.unlocked).toBe(true);
    expect(state.tiers.every((tier) => tier.unlocked === true)).toBe(true);
  });
});

describe('ChaosLogicService · start / 推进', () => {
  it('start：消耗 1 把钥石并进入对应 T 阶', async () => {
    const fixture = unlockedFixture();
    giveInventory(fixture, { key: 'keystone.t02', count: 2 }, 0);
    const { service, calls } = makeService(fixture);

    const set = await expectOk(await service.setSequence(1, 'char-1', ['keystone.t02']));
    expect(set.sequence).toEqual(['keystone.t02']);

    const state = await expectOk(await service.start(1, 'char-1'));
    expect(state.active).toBe(true);
    expect(state.currentTier).toBe(2);
    expect(state.tiers[1]?.keystoneCount).toBe(1);
    expect(fixture.player.countGood('keystone.t02')).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ mapKey: 'chaos.t02', allowChaos: true });
  });

  it('clear：结算后消耗下一把并进入下一阶', async () => {
    const fixture = unlockedFixture();
    giveInventory(fixture, { key: 'keystone.t02', count: 1 }, 0);
    giveInventory(fixture, { key: 'keystone.t03', count: 1 }, 1);
    const { service, calls, bus } = makeService(fixture);
    await service.setSequence(1, 'char-1', ['keystone.t02', 'keystone.t03']);
    await service.start(1, 'char-1');
    expect(calls[0]?.mapKey).toBe('chaos.t02');

    await emitEnded(bus, 2, 'clear');

    expect(calls[1]?.mapKey).toBe('chaos.t03');
    expect(fixture.player.chaosActive).toBe(true);
    expect(fixture.player.chaosIndex).toBe(1);
    expect(fixture.player.countGood('keystone.t03')).toBe(0);
  });

  it('clear 后序列走完 → 干净停止并回普通地图', async () => {
    const fixture = unlockedFixture();
    giveInventory(fixture, { key: 'keystone.t02', count: 1 }, 0);
    const { service, calls, bus } = makeService(fixture);
    await service.setSequence(1, 'char-1', ['keystone.t02']);
    await service.start(1, 'char-1');

    await emitEnded(bus, 2, 'clear');
    expect(fixture.player.chaosActive).toBe(false);
    expect(calls[1]?.mapKey).toBe('home');
  });

  it('death × normal → 中断并回普通地图', async () => {
    const fixture = unlockedFixture();
    giveInventory(fixture, { key: 'keystone.t02', count: 3 }, 0);
    const { service, calls, bus } = makeService(fixture);
    await service.setSequence(1, 'char-1', ['keystone.t02']);
    await service.setFailMode(1, 'char-1', 'normal');
    await service.start(1, 'char-1');

    await emitEnded(bus, 2, 'death');
    expect(fixture.player.chaosActive).toBe(false);
    expect(calls[1]?.mapKey).toBe('home');
    // 中断不再消耗钥石
    expect(fixture.player.countGood('keystone.t02')).toBe(2);
  });

  it('death × continue：连续失败重试当前把，3 连败后跳到下一把', async () => {
    const fixture = unlockedFixture();
    giveInventory(fixture, { key: 'keystone.t02', count: 9 }, 0);
    giveInventory(fixture, { key: 'keystone.t03', count: 9 }, 1);
    const { service, calls, bus } = makeService(fixture);
    await service.setSequence(1, 'char-1', ['keystone.t02', 'keystone.t03']);
    await service.setFailMode(1, 'char-1', 'continue');
    await service.start(1, 'char-1'); // 消耗 1 把 t02

    await emitEnded(bus, 2, 'death'); // retry 0→1
    expect(fixture.player.chaosIndex).toBe(0);
    expect(fixture.player.chaosRetry).toBe(1);
    expect(calls[1]?.mapKey).toBe('chaos.t02');

    await emitEnded(bus, 2, 'death'); // retry 1→2
    expect(fixture.player.chaosRetry).toBe(2);
    expect(calls[2]?.mapKey).toBe('chaos.t02');

    await emitEnded(bus, 2, 'death'); // 3 连败 → 跳下一把
    expect(fixture.player.chaosIndex).toBe(1);
    expect(fixture.player.chaosRetry).toBe(0);
    expect(calls[3]?.mapKey).toBe('chaos.t03');
    expect(fixture.player.countGood('keystone.t03')).toBe(8);
    // 消耗 3 把 t02（start + 2 次重试；第 3 次失败已跳到 t03）
    expect(fixture.player.countGood('keystone.t02')).toBe(6);
  });

  it('下一把钥石缺失 → 干净停止（不跳读后续）', async () => {
    const fixture = unlockedFixture();
    giveInventory(fixture, { key: 'keystone.t02', count: 1 }, 0);
    const { service, calls, bus } = makeService(fixture);
    await service.setSequence(1, 'char-1', ['keystone.t02', 'keystone.t03']);
    await service.start(1, 'char-1');

    await emitEnded(bus, 2, 'clear');
    expect(fixture.player.chaosActive).toBe(false);
    expect(calls[1]?.mapKey).toBe('home');
  });

  it('过期事件（阶不符）被忽略', async () => {
    const fixture = unlockedFixture();
    giveInventory(fixture, { key: 'keystone.t02', count: 1 }, 0);
    const { service, calls, bus } = makeService(fixture);
    await service.setSequence(1, 'char-1', ['keystone.t02']);
    await service.start(1, 'char-1');
    await emitEnded(bus, 9, 'clear');
    expect(calls).toHaveLength(1);
    expect(fixture.player.chaosActive).toBe(true);
  });

  it('stop：清运行态并回普通地图', async () => {
    const fixture = unlockedFixture();
    giveInventory(fixture, { key: 'keystone.t02', count: 1 }, 0);
    const { service, calls } = makeService(fixture);
    await service.setSequence(1, 'char-1', ['keystone.t02']);
    await service.start(1, 'char-1');
    const state = await expectOk(await service.stop(1, 'char-1'));
    expect(state.active).toBe(false);
    expect(calls[1]?.mapKey).toBe('home');
  });

  it('已在运行中再次 start → CHAOS_ALREADY_ACTIVE', async () => {
    const fixture = unlockedFixture();
    giveInventory(fixture, { key: 'keystone.t02', count: 2 }, 0);
    const { service } = makeService(fixture);
    await service.setSequence(1, 'char-1', ['keystone.t02']);
    await service.start(1, 'char-1');
    const again = await service.start(1, 'char-1');
    expect(again.success).toBe(false);
    if (!again.success) expect(again.data.code).toBe('CHAOS_ALREADY_ACTIVE');
  });

  it('空序列 start → INVALID_PARAM', async () => {
    const fixture = unlockedFixture();
    const { service } = makeService(fixture);
    const started = await service.start(1, 'char-1');
    expect(started.success).toBe(false);
    if (!started.success) expect(started.data.code).toBe('INVALID_PARAM');
  });

  it('角色不存在 → PLAYER_NOT_FOUND', async () => {
    const fixture = unlockedFixture();
    const { service } = makeService(fixture);
    const contexts = makeFakeContexts(fixture);
    (contexts as unknown as { load: () => Promise<null> }).load = async () => null;
    const target = new ChaosLogicService(contexts, makeBattle().battle, new InProcessEventBus());
    const result = await target.state(1, 'char-1');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('PLAYER_NOT_FOUND');
    void service;
  });
});

describe('ChaosLogicService · 参数校验与地图列表', () => {
  it('setSequence：非法 key / 超长拒绝；可重复合法', async () => {
    const fixture = unlockedFixture();
    const { service } = makeService(fixture);
    const bad = await service.setSequence(1, 'char-1', ['keystone.t99']);
    expect(bad.success).toBe(false);
    const tooLong = Array.from({ length: 17 }, () => 'keystone.t01');
    expect((await service.setSequence(1, 'char-1', tooLong)).success).toBe(false);
    const okSeq = await expectOk(
      await service.setSequence(1, 'char-1', ['keystone.t01', 'keystone.t01']),
    );
    expect(okSeq.sequence).toEqual(['keystone.t01', 'keystone.t01']);
  });

  it('setFailMode：非法值拒绝', async () => {
    const fixture = unlockedFixture();
    const { service } = makeService(fixture);
    const bad = await service.setFailMode(1, 'char-1', 'nope');
    expect(bad.success).toBe(false);
    const good = await expectOk(await service.setFailMode(1, 'char-1', 'continue'));
    expect(good.failMode).toBe('continue');
  });

  it('普通地图列表不包含任何 chaos.tNN', () => {
    const fixture = unlockedFixture();
    const list = mapListDtoOf(fixture.tables, fixture.player, 'home');
    expect(list.some((map) => map.key.startsWith('chaos.'))).toBe(false);
    expect(list.length).toBeGreaterThan(0);
  });
});
