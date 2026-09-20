/**
 * 混沌仪离线推进单测（W6）—— 用内存 DB + 可变时间源，不占真实时间。
 *
 * 覆盖：
 * 1. 预算内的 `clear` 让序列前进到下一位阶并消耗下一把钥石；
 * 2. run 未结算（预算耗尽）→ **停在当前钥石**，`extrapolatedMs = 0`（不做速率外推）；
 * 3. 缺下一把钥石 → 干净停止回普通地图。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createDefaultTables, worldBossMapKeys } from '@idle-dark/game-core';
import { PlayerContextService } from '../../../src/modules/logic/shared/player-context.service.js';
import { IdleService } from '../../../src/modules/logic/idle/idle-logic.service.js';
import { FakeDatabase } from '../../helpers/fake-database.js';

const tables = createDefaultTables();
const HOUR = 3600_000;

/** 在背包指定下标写入物品。 */
function give(
  player: { inventory: Array<{ fromJSON: (json: unknown) => unknown }> },
  index: number,
  key: string,
  count: number,
): void {
  player.inventory[index]!.fromJSON({ key, count });
}

describe('IdleService · 混沌仪离线推进', () => {
  let db: FakeDatabase;
  let context: PlayerContextService;
  let now: number;

  beforeEach(async () => {
    db = new FakeDatabase();
    db.seedAccount(1);
    db.seedCharacter({ id: 'c1', user_id: 1, role: 'Eyer', career: 'warrior' });
    now = 1_700_000_000_000;
    context = new PlayerContextService(db.asService(), () => now, tables);
  });

  /** 造一个已解锁、运行中、位于混沌 T1 的角色。 */
  async function seedChaosRun(options: {
    sequence: string[];
    keystones: Array<{ index: number; key: string; count: number }>;
    map?: string;
    failMode?: 'normal' | 'continue';
  }): Promise<void> {
    const player = await context.create(1, 'c1', 'Eyer', 'warrior');
    for (const key of worldBossMapKeys(tables.maps)) player.markWorldBossKilled(key);
    for (const entry of options.keystones) give(player, entry.index, entry.key, entry.count);
    player.chaosSequence = options.sequence;
    player.chaosIndex = 0;
    player.chaosRetry = 0;
    player.chaosActive = true;
    player.chaosFailMode = options.failMode ?? 'normal';
    const extras = await context.extrasOf(1);
    extras.worldMaps['c1'] = { map: options.map ?? 'chaos.t01' };
    context.markAccountDirty(1);
    player.timestamp = now;
    context.markDirty(1, 'c1');
    await context.flush(1, 'c1');
  }

  it('预算耗尽（run 未结算）→ 停在当前钥石，且不外推', async () => {
    await seedChaosRun({
      sequence: ['keystone.t01'],
      keystones: [{ index: 0, key: 'keystone.t01', count: 1 }],
    });
    now += 1; // 1ms：连怪都还没刷出来，run 必然未结算
    const service = new IdleService(context, () => now, tables);
    const result = await service.report(1, 'c1');
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.extrapolatedMs).toBe(0);
    expect(result.data.simulatedMs).toBeLessThanOrEqual(1);
    const player = context.peek(1, 'c1')!;
    expect(player.chaosActive).toBe(true);
    expect(player.chaosIndex).toBe(0);
    expect(player.countGood('keystone.t01')).toBe(1); // 只在进入时消耗一次
    const extras = await context.extrasOf(1);
    expect(extras.worldMaps['c1']?.map).toBe('chaos.t01');
  });

  it('clear 推进序列：消耗下一把钥石、进入下一位阶，再次未结算时停住', async () => {
    await seedChaosRun({
      sequence: ['keystone.t01', 'keystone.t02'],
      keystones: [
        { index: 0, key: 'keystone.t01', count: 1 },
        { index: 1, key: 'keystone.t02', count: 1 },
      ],
      failMode: 'continue',
    });
    now += 10 * HOUR;
    const service = new IdleService(context, () => now, tables);

    // 脚本化内核：第一次 clear（T1），第二次未结算（预算耗尽）。
    const maps: string[] = [];
    let run = 0;
    const stub = (params: { map: string }): unknown => {
      maps.push(params.map);
      run += 1;
      if (run === 1) {
        return {
          simulatedMs: 1000,
          gainedExp: 5,
          gainedGold: 1,
          kills: 2,
          loots: [],
          materials: [],
          chaosOutcome: 'clear',
        };
      }
      return {
        simulatedMs: 2000,
        gainedExp: 0,
        gainedGold: 0,
        kills: 0,
        loots: [],
        materials: [],
        chaosOutcome: null,
      };
    };
    (service as unknown as { simulateOnMap: typeof stub }).simulateOnMap = stub;

    const result = await service.report(1, 'c1');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(maps).toEqual(['chaos.t01', 'chaos.t02']);
    expect(result.data.simulatedMs).toBe(3000);
    expect(result.data.extrapolatedMs).toBe(0);

    const player = context.peek(1, 'c1')!;
    expect(player.chaosActive).toBe(true);
    expect(player.chaosIndex).toBe(1);
    // 离线只消耗「下一把」：当前把（t01）是线上 start 时已投的，本轮不再扣。
    expect(player.countGood('keystone.t01')).toBe(1);
    expect(player.countGood('keystone.t02')).toBe(0);
    const extras = await context.extrasOf(1);
    expect(extras.worldMaps['c1']?.map).toBe('chaos.t02');
  });

  it('clear 后缺下一把钥石 → 干净停止并回普通地图', async () => {
    await seedChaosRun({
      sequence: ['keystone.t01', 'keystone.t02'],
      keystones: [{ index: 0, key: 'keystone.t01', count: 2 }],
    });
    now += 10 * HOUR;
    const service = new IdleService(context, () => now, tables);
    const stub = (): unknown => ({
      simulatedMs: 1000,
      gainedExp: 1,
      gainedGold: 0,
      kills: 1,
      loots: [],
      materials: [],
      chaosOutcome: 'clear',
    });
    (service as unknown as { simulateOnMap: typeof stub }).simulateOnMap = stub;

    const result = await service.report(1, 'c1');
    expect(result.success).toBe(true);
    const player = context.peek(1, 'c1')!;
    expect(player.chaosActive).toBe(false);
    const extras = await context.extrasOf(1);
    expect(extras.worldMaps['c1']?.map).toBe('home');
  });

  it('death × normal → 离线中断并回普通地图', async () => {
    await seedChaosRun({
      sequence: ['keystone.t01'],
      keystones: [{ index: 0, key: 'keystone.t01', count: 2 }],
      failMode: 'normal',
    });
    now += 10 * HOUR;
    const service = new IdleService(context, () => now, tables);
    const stub = (): unknown => ({
      simulatedMs: 500,
      gainedExp: 0,
      gainedGold: 0,
      kills: 0,
      loots: [],
      materials: [],
      chaosOutcome: 'death',
    });
    (service as unknown as { simulateOnMap: typeof stub }).simulateOnMap = stub;

    await service.report(1, 'c1');
    const player = context.peek(1, 'c1')!;
    expect(player.chaosActive).toBe(false);
    const extras = await context.extrasOf(1);
    expect(extras.worldMaps['c1']?.map).toBe('home');
  });
});
