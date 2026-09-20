/**
 * R5-b：离线「队列顺序模拟」单测（RD3/RD5/RD7）
 *
 * 覆盖：
 * - 当前位置是秘境：离线扣票**恰好一次**、跑相位、通关后清 run 档并转 `outside`、不外推；
 * - 当前位置是安全区 + 队列 = [秘境, 开放世界]：按顺序先打秘境再进开放图，队列被消费；
 * - RD5：秘境条目无票 → 跳过并继续（不中断队列）；
 * - 幂等：重复 `report` 不二次扣票 / 不二次推进。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultTables, type DataTables } from '@idle-dark/game-core';
import { PlayerContextService } from '../../../src/modules/logic/shared/player-context.service.js';
import {
  IdleService,
  offlineExtrapolationMs,
} from '../../../src/modules/logic/idle/idle-logic.service.js';
import { FakeDatabase } from '../../helpers/fake-database.js';

const tables: DataTables = createDefaultTables();
const HOUR = 3600_000;
const DUNGEON = 'town.cave2'; // 1 个相位，outside 见数据表
const OPEN = 'town.valley'; // 开放世界战斗图

describe('IdleService · R5-b 离线队列顺序模拟', () => {
  let db: FakeDatabase;
  let context: PlayerContextService;
  let service: IdleService;
  let now: number;

  beforeEach(async () => {
    db = new FakeDatabase();
    db.seedAccount(1);
    db.seedCharacter({ id: 'c1', user_id: 1, role: 'Eyer', career: 'warrior' });
    now = 1_700_000_000_000;
    context = new PlayerContextService(db.asService(), () => now, tables);
    service = new IdleService(context, () => now, tables);
    await context.create(1, 'c1', 'Eyer', 'warrior');
  });

  interface Setup {
    map?: string;
    queue?: Array<{ key: string; endlessLevel: number }>;
    tickets?: number;
  }

  async function setup(options: Setup = {}): Promise<void> {
    const extras = await context.extrasOf(1);
    if (options.queue !== undefined) extras.challengeQueue['c1'] = options.queue;
    if (options.tickets !== undefined) {
      const player = await context.load(1, 'c1');
      player?.dungeonTickets.set(DUNGEON, options.tickets);
    }
    extras.worldMaps['c1'] = { map: options.map ?? 'home', endlessLevel: 0 };
    context.markAccountDirty(1);
    const player = await context.load(1, 'c1');
    if (player) player.timestamp = now;
    context.markDirty(1, 'c1');
    await context.flush(1, 'c1');
  }

  it('当前位置是秘境：离线扣票恰好一次、通关后清 run 档并转 outside、不外推（RD7）', async () => {
    await setup({ map: DUNGEON, tickets: 2 });
    now += 2 * HOUR;

    const result = await service.report(1, 'c1');
    expect(result.success).toBe(true);
    if (!result.success) return;

    const player = context.peek(1, 'c1');
    expect(player?.countTicket(DUNGEON)).toBe(1); // 扣票恰好一次（RC2）
    expect(result.data.simulatedMs).toBeGreaterThan(0);
    // 通关后落在 outside（可能是战斗图）→ 剩余时长允许外推，但不得超过剩余时长
    expect(result.data.extrapolatedMs).toBeGreaterThanOrEqual(0);
    expect(result.data.extrapolatedMs).toBeLessThanOrEqual(
      Math.max(0, result.data.cappedMs - result.data.simulatedMs),
    );

    const extras = await context.extrasOf(1);
    // 通关后离开秘境（outside / 持久化位置），run 档不再存在
    expect(extras.worldMaps['c1']?.map).not.toBe(DUNGEON);
    expect(extras.dungeonRuns['c1']).toBeUndefined();
  });

  it('RD3：队列耗尽后仍有余量 → 在最终非秘境战斗图（outside）继续模拟', async () => {
    await setup({ map: DUNGEON, tickets: 2 });
    now += 2 * HOUR;

    const result = await service.report(1, 'c1');
    expect(result.success).toBe(true);
    if (!result.success) return;

    const extras = await context.extrasOf(1);
    // town.cave2.outside = town.cave（非秘境战斗图）→ 秘境打完继续在那里打
    expect(extras.worldMaps['c1']?.map).toBe('town.cave');
    // 共享预算被用满（秘境清完 + outside 续跑）
    expect(result.data.simulatedMs).toBe(30 * 60 * 1000);
  });

  it('安全区 + 队列 [秘境, 开放世界]：按顺序打完秘境再进开放图，队列被消费', async () => {
    await setup({ map: 'home', tickets: 1, queue: [{ key: DUNGEON, endlessLevel: 0 }, { key: OPEN, endlessLevel: 0 }] });
    now += 3 * HOUR;

    const result = await service.report(1, 'c1');
    expect(result.success).toBe(true);

    const player = context.peek(1, 'c1');
    expect(player?.countTicket(DUNGEON)).toBe(0); // 秘境条目扣票一次
    const extras = await context.extrasOf(1);
    expect(extras.challengeQueue['c1']).toEqual([]); // 两条都被消费
    expect(extras.worldMaps['c1']?.map).toBe(OPEN); // 最终落在开放图
  });

  it('RD5：秘境条目无票 → 跳过并继续，队列其余条目仍被推进', async () => {
    await setup({ map: 'home', tickets: 0, queue: [{ key: DUNGEON, endlessLevel: 0 }, { key: OPEN, endlessLevel: 0 }] });
    now += 3 * HOUR;

    const result = await service.report(1, 'c1');
    expect(result.success).toBe(true);

    const extras = await context.extrasOf(1);
    expect(extras.challengeQueue['c1']).toEqual([]); // 无票条目被跳过并消费
    expect(extras.worldMaps['c1']?.map).toBe(OPEN); // 继续推进到下一条
    expect(context.peek(1, 'c1')?.countTicket(DUNGEON)).toBe(0);
  });

  it('幂等：重复 report 命中缓存 → 不二次扣票、不二次推进', async () => {
    await setup({ map: 'home', tickets: 1, queue: [{ key: DUNGEON, endlessLevel: 0 }] });
    now += 3 * HOUR;

    await service.report(1, 'c1');
    const afterFirst = context.peek(1, 'c1')?.countTicket(DUNGEON);
    const queueAfterFirst = (await context.extrasOf(1)).challengeQueue['c1'];

    const second = await service.report(1, 'c1');
    expect(second.success).toBe(true);
    expect(context.peek(1, 'c1')?.countTicket(DUNGEON)).toBe(afterFirst);
    expect((await context.extrasOf(1)).challengeQueue['c1']).toEqual(queueAfterFirst);
  });
});

describe('offlineExtrapolationMs（RD7 纯函数）', () => {
  const monsters = [{ key: 'dummy' }] as never;

  it('秘境 / 安全区 / 未知地图 → 一律 0（不外推）', () => {
    expect(offlineExtrapolationMs({ isDungeon: true, monsters }, 7_200_000, 1_800_000)).toBe(0);
    expect(offlineExtrapolationMs({ monsters: [] }, 7_200_000, 1_800_000)).toBe(0);
    expect(offlineExtrapolationMs({}, 7_200_000, 1_800_000)).toBe(0);
    expect(offlineExtrapolationMs(undefined, 7_200_000, 1_800_000)).toBe(0);
    expect(offlineExtrapolationMs(null, 7_200_000, 1_800_000)).toBe(0);
    expect(offlineExtrapolationMs({ monsters: {} as never }, 7_200_000, 1_800_000)).toBe(0);
  });

  it('非秘境战斗图 → capped - simulated（夹取到 0，非法输入 → 0）', () => {
    expect(offlineExtrapolationMs({ monsters }, 7_200_000, 1_800_000)).toBe(5_400_000);
    expect(offlineExtrapolationMs({ monsters }, 1_000_000, 1_800_000)).toBe(0);
    expect(offlineExtrapolationMs({ monsters }, Number.NaN, 1_800_000)).toBe(0);
    expect(offlineExtrapolationMs({ monsters }, 7_200_000, Number.POSITIVE_INFINITY)).toBe(0);
    expect(offlineExtrapolationMs({ monsters }, -100, -100)).toBe(0);
  });
});
