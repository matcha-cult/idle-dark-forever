/**
 * `CharacterService` 单测：真实存档落地 + 展示名 + 槽位 / 重名 / 删除边界
 *
 * 用内存 DB 替身验证（沙箱无 PostgreSQL，见 `AGENTS.md` §7.7）。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createDefaultTables } from '@idle-dark/game-core';
import type { DatabaseService } from '../src/modules/database/database.service.js';
import { CharacterService } from '../src/modules/character/character.service.js';
import { PlayerContextService } from '../src/modules/logic/shared/player-context.service.js';
import type { WorldService } from '../src/modules/logic/world/world.service.js';
import { FakeDatabase } from './helpers/fake-database.js';

const tables = createDefaultTables();
const NOW = 1_700_000_000_000;

describe('CharacterService（Wave 2：真实存档）', () => {
  let db: FakeDatabase;
  let service: CharacterService;
  let inBattleIds: Set<string>;

  beforeEach(() => {
    db = new FakeDatabase();
    db.seedAccount(1, { player_slot_count: 3 });
    const context = new PlayerContextService(db.asService(), () => NOW, tables);
    inBattleIds = new Set();
    const worldStub = {
      isInBattle: (_userId: number, characterId: string) => inBattleIds.has(characterId),
    } as unknown as WorldService;
    service = new CharacterService(
      db.asService() as unknown as DatabaseService,
      context,
      worldStub,
      tables,
    );
  });

  it('create 写入真实 state（非 {} 占位）并使用真实展示名', async () => {
    const result = await service.create(1, { name: '夜行者' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.role).toBe('Eyer');
    expect(result.data.roleName).toBe(tables.roles['Eyer']?.name);
    expect(result.data.currentCareerName).toBe(tables.careers['warrior']?.name);

    const row = db.characters.get(result.data.key);
    expect(row?.state).toBeTruthy();
    const state = row?.state as Record<string, unknown>;
    expect(state['role']).toBe('Eyer');
    expect(Object.keys(state).length).toBeGreaterThan(0);
  });

  it('list 返回数组并反映 inBattle', async () => {
    const created = await service.create(1, { name: 'A' });
    if (!created.success) throw new Error('create failed');
    inBattleIds.add(created.data.key);
    const list = await service.list(1);
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(Array.isArray(list.data)).toBe(true);
    expect(list.data[0]?.inBattle).toBe(true);
  });

  it('重名 → PLAYER_NAME_TAKEN；空名 / 超长名 → INVALID_PARAM', async () => {
    await service.create(1, { name: '同名' });
    const dup = await service.create(1, { name: '同名' });
    expect(dup.success).toBe(false);
    if (!dup.success) expect(dup.data.code).toBe('PLAYER_NAME_TAKEN');

    for (const name of ['', '   ', 'x'.repeat(25)]) {
      const bad = await service.create(1, { name });
      expect(bad.success).toBe(false);
      if (!bad.success) expect(bad.data.code).toBe('INVALID_PARAM');
    }
  });

  it('槽位已满 → PLAYER_SLOT_FULL', async () => {
    db.seedAccount(1, { player_slot_count: 1 });
    await service.create(1, { name: '唯一' });
    const second = await service.create(1, { name: '第二' });
    expect(second.success).toBe(false);
    if (!second.success) expect(second.data.code).toBe('PLAYER_SLOT_FULL');
  });

  it('未知 role/career 回退到默认值', async () => {
    const result = await service.create(1, { name: 'x', role: '不存在', career: '不存在' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.role).toBe('Eyer');
    expect(result.data.currentCareer).toBe('warrior');
  });

  it('createFromSave 导入存档并以存档内容为准', async () => {
    const state = {
      role: 'Aleanor',
      currentCareer: 'sorceress',
      gold: 4321,
      careers: { sorceress: { type: 'sorceress', level: 12, exp: 5 } },
      inventory: [],
    };
    const result = await service.createFromSave(1, { name: '导入者', role: 'Eyer', state });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.role).toBe('Aleanor');
    expect(result.data.currentCareer).toBe('sorceress');
    expect(result.data.level).toBe(12);
  });

  it('remove 幂等：首次成功，再次 PLAYER_NOT_FOUND', async () => {
    const created = await service.create(1, { name: '待删' });
    if (!created.success) throw new Error('create failed');
    const first = await service.remove(1, created.data.key);
    expect(first.success).toBe(true);
    const second = await service.remove(1, created.data.key);
    expect(second.success).toBe(false);
    if (!second.success) expect(second.data.code).toBe('PLAYER_NOT_FOUND');
  });

  it('remove 不能删除他人角色', async () => {
    const created = await service.create(1, { name: '我的' });
    if (!created.success) throw new Error('create failed');
    const other = await service.remove(2, created.data.key);
    expect(other.success).toBe(false);
  });
});
