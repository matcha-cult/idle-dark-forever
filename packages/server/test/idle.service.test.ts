/**
 * `IdleService` 离线结算单测（验收要求：0 / 负数 / 1 分钟 / 超 72h 各一条断言）
 *
 * 用内存 DB + 可变注入时间源；C1 快进模拟在 `VirtualClock` 里跑，不占真实时间。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createDefaultTables } from '@idle-dark/game-core';
import type { OfflineReportDto } from '@idle-dark/protocol';
import { PlayerContextService } from '../src/modules/logic/shared/player-context.service.js';
import {
  IdleService,
  MAX_OFFLINE_MS,
  PAUSE_AFTER_MS,
  SIM_BUDGET_MS,
} from '../src/modules/logic/idle/idle-logic.service.js';
import { FakeDatabase } from './helpers/fake-database.js';

const tables = createDefaultTables();
const HOUR = 3600_000;

describe('IdleService 离线结算', () => {
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

    const player = await context.create(1, 'c1', 'Eyer', 'warrior');
    const extras = await context.extrasOf(1);
    extras.worldMaps['c1'] = { map: 'world.1', endlessLevel: 0 };
    context.markAccountDirty(1);
    player.timestamp = now;
    context.markDirty(1, 'c1');
    await context.flush(1, 'c1');
  });

  async function settle(): Promise<OfflineReportDto> {
    const result = await service.report(1, 'c1');
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unreachable');
    return result.data;
  }

  it('离线时长 0 → 零收益、无暂停标记', async () => {
    const report = await settle();
    expect(report.offlineMs).toBe(0);
    expect(report.cappedMs).toBe(0);
    expect(report.simulatedMs).toBe(0);
    expect(report.extrapolatedMs).toBe(0);
    expect(report.gainedExp).toBe(0);
    expect(report.kills).toBe(0);
    expect(report.pausedByMaxOffline).toBe(false);
  });

  it('离线时长为负（时间源回拨）→ 按 0 处理，不产生负收益', async () => {
    now -= 10 * HOUR;
    const report = await settle();
    expect(report.offlineMs).toBe(0);
    expect(report.gainedExp).toBeGreaterThanOrEqual(0);
    expect(report.gainedGold).toBeGreaterThanOrEqual(0);
  });

  it('离线 1 分钟 → 全部落在 C1 快进区间（不外推）', async () => {
    now += 60_000;
    const report = await settle();
    expect(report.offlineMs).toBe(60_000);
    expect(report.cappedMs).toBe(60_000);
    expect(report.simulatedMs).toBeLessThanOrEqual(60_000);
    expect(report.extrapolatedMs).toBe(60_000 - report.simulatedMs);
    expect(report.pausedByMaxOffline).toBe(false);
  });

  it('离线超 72h → cappedMs 截到 72h、simulatedMs 截到 30 分钟、标记 pausedByMaxOffline', async () => {
    now += 80 * HOUR;
    const report = await settle();
    expect(report.offlineMs).toBe(80 * HOUR);
    expect(report.cappedMs).toBe(MAX_OFFLINE_MS);
    expect(report.simulatedMs).toBeLessThanOrEqual(SIM_BUDGET_MS);
    expect(report.extrapolatedMs).toBe(MAX_OFFLINE_MS - report.simulatedMs);
    expect(report.pausedByMaxOffline).toBe(true);
  });

  it('离线恰好等于 24h 阈值 → 不暂停', async () => {
    now += PAUSE_AFTER_MS;
    expect((await settle()).pausedByMaxOffline).toBe(false);
  });

  it('离线超过 24h 阈值 → 暂停标记', async () => {
    now += PAUSE_AFTER_MS + 1;
    expect((await settle()).pausedByMaxOffline).toBe(true);
  });

  it('claim 领取后缓存清空，再次 report 归零', async () => {
    now += 5 * 60_000;
    const first = await service.claim(1, 'c1');
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(first.data.simulatedMs + first.data.extrapolatedMs).toBe(first.data.cappedMs);

    const second = await service.report(1, 'c1');
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.data.offlineMs).toBe(0);
  });

  it('角色不存在 → PLAYER_NOT_FOUND（不抛错）', async () => {
    const result = await service.report(1, 'missing');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('PLAYER_NOT_FOUND');
  });

  it('报告字段自洽：simulated + extrapolated = capped，收益非负', async () => {
    now += 10 * HOUR;
    const report = await settle();
    expect(report.simulatedMs + report.extrapolatedMs).toBe(report.cappedMs);
    expect(report.gainedExp).toBeGreaterThanOrEqual(0);
    expect(report.gainedGold).toBeGreaterThanOrEqual(0);
    expect(report.kills).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.loots)).toBe(true);
    expect(Array.isArray(report.materials)).toBe(true);
  });
});

describe('IdleService · R5 离线结算编排（RD1/RD2/RD7 + 幂等）', () => {
  let db: FakeDatabase;
  let context: PlayerContextService;
  let now: number;

  beforeEach(async () => {
    db = new FakeDatabase();
    db.seedAccount(1);
    db.seedCharacter({ id: 'c1', user_id: 1, role: 'Eyer', career: 'warrior' });
    now = 1_700_000_000_000;
    context = new PlayerContextService(db.asService(), () => now, tables);
    await context.create(1, 'c1', 'Eyer', 'warrior');
  });

  async function setPosition(map: string): Promise<void> {
    const extras = await context.extrasOf(1);
    extras.worldMaps['c1'] = { map, endlessLevel: 0 };
    context.markAccountDirty(1);
    const player = await context.load(1, 'c1');
    if (player) player.timestamp = now;
    context.markDirty(1, 'c1');
    await context.flush(1, 'c1');
  }

  it('RD1：安全区（home，无怪）离线 → 零收益，且时间锚点照常推进', async () => {
    await setPosition('home');
    now += 10 * HOUR;
    const service = new IdleService(context, () => now, tables);
    const result = await service.report(1, 'c1');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.simulatedMs).toBe(0);
    expect(result.data.extrapolatedMs).toBe(0);
    expect(result.data.gainedExp).toBe(0);
    expect(result.data.kills).toBe(0);
    expect(context.peek(1, 'c1')?.timestamp).toBe(now);
  });

  it('RD7：秘境离线**不做速率外推**（cappedMs 仍按 72h 上限，extrapolatedMs=0）', async () => {
    await setPosition('nightmare.slime');
    now += 100 * HOUR;
    const service = new IdleService(context, () => now, tables);
    const result = await service.report(1, 'c1');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cappedMs).toBe(MAX_OFFLINE_MS);
    expect(result.data.extrapolatedMs).toBe(0);
    expect(result.data.pausedByMaxOffline).toBe(true);
  });
});
