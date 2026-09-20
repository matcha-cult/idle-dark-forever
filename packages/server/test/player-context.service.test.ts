/**
 * `PlayerContextService` 单测（DB ↔ game-core 胶水层）
 *
 * 覆盖：缓存命中、脏标记与落库节流、账号级共享、切人 evict、旧占位行迁移、
 * 以及 userId / characterId 的非法边界。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createDefaultTables } from '@idle-dark/game-core';
import { PlayerContextService } from '../src/modules/logic/shared/player-context.service.js';
import { createAccountExtras } from '../src/modules/logic/shared/player-dto.js';
import { FakeDatabase } from './helpers/fake-database.js';

describe('PlayerContextService', () => {
  let db: FakeDatabase;
  let ctx: PlayerContextService;
  const NOW = 1_700_000_000_000;
  const tables = createDefaultTables();

  beforeEach(() => {
    db = new FakeDatabase();
    db.seedAccount(1);
    // `PlayerContextService.create` 记录的前提是角色行已存在（由 CharacterService 先 INSERT）。
    db.seedCharacter({ id: 'c1', user_id: 1 });
    db.seedCharacter({ id: 'c2', user_id: 1 });
    ctx = new PlayerContextService(db.asService(), () => NOW, tables);
  });

  it('create 生成真实存档并立即落库', async () => {
    const player = await ctx.create(1, 'c1', 'Eyer', 'warrior');
    expect(player.key).toBe('c1');
    expect(player.role).toBe('Eyer');
    expect(player.currentCareer).toBe('warrior');
    expect(player.level).toBeGreaterThanOrEqual(1);

    const row = db.characters.get('c1');
    expect(row).toBeDefined();
    expect(row?.state).toMatchObject({ role: 'Eyer', currentCareer: 'warrior' });
    expect(db.writes).toBeGreaterThan(0);
  });

  it('缓存命中返回同一实例；reset 后从 DB 重建且存档一致', async () => {
    const created = await ctx.create(1, 'c1', 'Eyer', 'warrior');
    created.gold = 1234;
    ctx.markDirty(1, 'c1');
    await ctx.flush(1, 'c1');

    expect(ctx.peek(1, 'c1')).toBe(created);

    ctx.reset();
    expect(ctx.peek(1, 'c1')).toBeNull();

    const reloaded = await ctx.load(1, 'c1');
    expect(reloaded).not.toBeNull();
    expect(reloaded?.gold).toBe(1234);
    expect(reloaded?.role).toBe('Eyer');
  });

  it('markDirty 后 flush 返回 true；未变脏时 flush 返回 false（节流）', async () => {
    await ctx.create(1, 'c1', 'Eyer', 'warrior');
    expect(await ctx.flush(1, 'c1')).toBe(false);
    ctx.markDirty(1, 'c1');
    expect(await ctx.flush(1, 'c1')).toBe(true);
    expect(await ctx.flush(1, 'c1')).toBe(false);
  });

  it('同账号多角色共享同一个 PlayerAccountState 对象引用', async () => {
    const a = await ctx.create(1, 'c1', 'Eyer', 'warrior');
    const b = await ctx.create(1, 'c2', 'Aleanor', 'sorceress');
    expect(a.account).toBe(b.account);
    a.account.diamonds = 77;
    expect(b.account.diamonds).toBe(77);
  });

  it('账号级神力落库后重载可见', async () => {
    const a = await ctx.create(1, 'c1', 'Eyer', 'warrior');
    a.account.diamonds = 999;
    a.account.highestEndlessLevel = 5;
    ctx.markAccountDirty(1);
    await ctx.flushAccount(1);

    ctx.reset();
    const reloaded = await ctx.load(1, 'c1');
    expect(reloaded?.account.diamonds).toBe(999);
    expect(reloaded?.account.highestEndlessLevel).toBe(5);
  });

  it('账号侧车（世界种子 / 地图）落库后重载一致', async () => {
    await ctx.create(1, 'c1', 'Eyer', 'warrior');
    const extras = await ctx.extrasOf(1);
    extras.worldSeeds['c1'] = 424242;
    extras.worldMaps['c1'] = { map: 'home', endlessLevel: 3 };
    ctx.markAccountDirty(1);
    await ctx.flushAccount(1);

    ctx.reset();
    const reloaded = await ctx.extrasOf(1);
    expect(reloaded.worldSeeds['c1']).toBe(424242);
    expect(reloaded.worldMaps['c1']).toEqual({ map: 'home', endlessLevel: 3 });
  });

  it('账号侧车（挑战队列 / 秘境冷却）落库后重载一致', async () => {
    await ctx.create(1, 'c1', 'Eyer', 'warrior');
    const extras = await ctx.extrasOf(1);
    extras.challengeQueue['c1'] = [
      { key: 'home', endlessLevel: 0 },
      { key: 'world.1', endlessLevel: 2 },
    ];
    extras.dungeonCooldowns['c1'] = {
      'nightmare.slime': { stacks: 1, lastResetAt: 1_700_000_000_000, lastUsedAt: 1_699_999_000_000 },
    };
    extras.dungeonRuns['c1'] = {
      runId: 'run-1',
      mapKey: 'nightmare.slime',
      endlessLevel: 0,
      enemyBorn: { currentPhase: 2, ticketPaid: true },
    };
    ctx.markAccountDirty(1);
    await ctx.flushAccount(1);

    ctx.reset();
    const reloaded = await ctx.extrasOf(1);
    expect(reloaded.challengeQueue['c1']).toEqual([
      { key: 'home', endlessLevel: 0 },
      { key: 'world.1', endlessLevel: 2 },
    ]);
    expect(reloaded.dungeonCooldowns['c1']?.['nightmare.slime']).toEqual({
      stacks: 1,
      lastResetAt: 1_700_000_000_000,
      lastUsedAt: 1_699_999_000_000,
    });
    expect(reloaded.dungeonRuns['c1']).toEqual({
      runId: 'run-1',
      mapKey: 'nightmare.slime',
      endlessLevel: 0,
      enemyBorn: { currentPhase: 2, ticketPaid: true },
    });
  });

  it('存档脏数据：未知地图条目被丢弃、超长截断、非法冷却值夹取（不清空整条队列）', async () => {
    await ctx.create(1, 'c1', 'Eyer', 'warrior');
    // 直接改内存库，模拟外部/旧版本写坏的数据
    const row = db.accounts.get(1);
    expect(row).toBeDefined();
    if (row) {
      row.data = {
        challengeQueue: {
          c1: [{ key: 'home' }, { key: 'no.such.map' }, { key: '' }, null, 'x'],
        },
        dungeonCooldowns: {
          c1: { 'nightmare.slime': { stacks: Number.NaN, lastResetAt: 'bad', lastUsedAt: -1 } },
        },
      };
    }
    ctx.reset();
    const extras = await ctx.extrasOf(1);
    expect(extras.challengeQueue['c1']).toEqual([{ key: 'home', endlessLevel: 0 }]);
    const cd = extras.dungeonCooldowns['c1']?.['nightmare.slime'];
    expect(cd?.stacks).toBe(0);
    expect(cd?.lastResetAt).toBe(0);
    expect(Number.isFinite(cd?.lastUsedAt)).toBe(true);
  });

  it('旧占位行（state = {}）在 load 时按列 role/career 补齐并落库', async () => {
    db.seedCharacter({ id: 'legacy', user_id: 1, role: 'Aleanor', career: 'sorceress', state: {} });
    const player = await ctx.load(1, 'legacy');
    expect(player).not.toBeNull();
    expect(player?.role).toBe('Aleanor');
    expect(player?.currentCareer).toBe('sorceress');
    expect(db.characters.get('legacy')?.state).not.toEqual({});
  });

  it('不存在的角色返回 null（不抛错）', async () => {
    expect(await ctx.load(1, 'missing')).toBeNull();
  });

  it('非法 userId / characterId 边界', async () => {
    expect(await ctx.load(0, 'c1')).toBeNull();
    expect(await ctx.load(-1, 'c1')).toBeNull();
    expect(await ctx.load(Number.NaN, 'c1')).toBeNull();
    expect(await ctx.load(1, '')).toBeNull();
    expect(await ctx.load(1, '   ')).toBeNull();
  });

  it('未知 role / career 回退到数据表第一项，不会生成坏角色', async () => {
    const player = await ctx.create(1, 'c1', '不存在的角色', '不存在的职业');
    expect(Object.keys(tables.roles)).toContain(player.role);
    expect(Object.keys(tables.careers)).toContain(player.currentCareer);
  });

  it('evict 先落库再移出缓存', async () => {
    const player = await ctx.create(1, 'c1', 'Eyer', 'warrior');
    player.gold = 55;
    ctx.markDirty(1, 'c1');
    await ctx.evict(1, 'c1');
    expect(ctx.has(1, 'c1')).toBe(false);
    expect(db.characters.get('c1')?.state).toMatchObject({ gold: 55 });
  });

  it('invalid date / 非法存档值不影响重建（NaN gold → 0）', async () => {
    db.seedCharacter({ id: 'c1', user_id: 1, state: { role: 'Eyer', gold: 'not-a-number' } });
    const player = await ctx.load(1, 'c1');
    expect(Number.isFinite(player?.gold ?? Number.NaN)).toBe(true);
  });

  it('stats 反映已加载 / 脏 / 账号数', async () => {
    await ctx.create(1, 'c1', 'Eyer', 'warrior');
    expect(ctx.stats.loaded).toBe(1);
    expect(ctx.stats.accounts).toBe(1);
  });

  it('createAccountExtras 返回彼此独立的默认对象', () => {
    const a = createAccountExtras();
    const b = createAccountExtras();
    a.worldSeeds['x'] = 1;
    expect(b.worldSeeds['x']).toBeUndefined();
  });
});
