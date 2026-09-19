/**
 * 跨服事件层边界单测（R1-a2）
 *
 * 覆盖：
 * - 总线：无订阅者 emit 不抛；订阅/取消；重复取消幂等；单订阅者抛错不影响其它订阅者；
 * - `currentMapOf`：缺失 / 空串 / 非字符串 / 正常值；
 * - `PlayerContextService.peekExtras`：未加载返回 null、加载后返回同一引用。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultTables, type DataTables } from '@idle-dark/game-core';
import { InProcessEventBus } from '../../../src/modules/logic/shared/event-bus.js';
import type { DomainEvent } from '../../../src/modules/logic/shared/events.js';
import { PlayerContextService } from '../../../src/modules/logic/shared/player-context.service.js';
import { createAccountExtras } from '../../../src/modules/logic/shared/player-dto.js';
import { currentMapOf } from '../../../src/modules/logic/story/story.logic.service.js';
import { FakeDatabase } from '../../helpers/fake-database.js';

const tables: DataTables = createDefaultTables();

describe('InProcessEventBus', () => {
  it('无订阅者时 emit 不抛错', () => {
    const bus = new InProcessEventBus();
    expect(() => bus.emit({ type: 'MapEntered', userId: 1, characterId: 'c1', map: 'home' })).not.toThrow();
    expect(bus.handlerCountOf('MapEntered')).toBe(0);
  });

  it('订阅后按名收到事件，取消后不再收到；重复取消是 no-op', () => {
    const bus = new InProcessEventBus();
    const seen: DomainEvent[] = [];
    const off = bus.on('EnemyKilled', (event) => seen.push(event));
    bus.emit({ type: 'EnemyKilled', userId: 1, characterId: 'c1', enemyType: 'slime', count: 2 });
    expect(seen).toHaveLength(1);
    off();
    off();
    bus.emit({ type: 'EnemyKilled', userId: 1, characterId: 'c1', enemyType: 'slime', count: 2 });
    expect(seen).toHaveLength(1);
    expect(bus.handlerCountOf('EnemyKilled')).toBe(0);
  });

  it('单订阅者抛错不影响其它订阅者与发布方（显式记录而非静默）', () => {
    const bus = new InProcessEventBus();
    let secondCalled = false;
    bus.on('CombatHooksDirty', () => {
      throw new Error('boom');
    });
    bus.on('CombatHooksDirty', () => {
      secondCalled = true;
    });
    expect(() =>
      bus.emit({ type: 'CombatHooksDirty', userId: 1, characterId: 'c1' }),
    ).not.toThrow();
    expect(secondCalled).toBe(true);
    expect(bus.handlerCountOf('CombatHooksDirty')).toBe(2);
  });

  it('订阅方在回调里取消订阅不会影响本次派发的其余订阅者', () => {
    const bus = new InProcessEventBus();
    const order: string[] = [];
    const offA = bus.on('MapEntered', () => {
      order.push('a');
      offA();
    });
    bus.on('MapEntered', () => order.push('b'));
    bus.emit({ type: 'MapEntered', userId: 1, characterId: 'c1', map: 'home' });
    expect(order).toEqual(['a', 'b']);
    expect(bus.handlerCountOf('MapEntered')).toBe(1);
  });
});

describe('currentMapOf（剧情地图条件的唯一权威读法）', () => {
  it('缺失条目 / 空串 / 非字符串 → null', () => {
    const extras = createAccountExtras();
    expect(currentMapOf(extras, 'c1')).toBeNull();
    extras.worldMaps['c1'] = { map: '', endlessLevel: 0 };
    expect(currentMapOf(extras, 'c1')).toBeNull();
    extras.worldMaps['c1'] = { map: 123 as unknown as string, endlessLevel: 0 };
    expect(currentMapOf(extras, 'c1')).toBeNull();
  });

  it('正常值原样返回', () => {
    const extras = createAccountExtras();
    extras.worldMaps['c1'] = { map: 'town.street', endlessLevel: 0 };
    expect(currentMapOf(extras, 'c1')).toBe('town.street');
  });
});

describe('PlayerContextService.peekExtras（同步、无 IO）', () => {
  let db: FakeDatabase;
  let context: PlayerContextService;

  beforeEach(() => {
    db = new FakeDatabase();
    db.seedAccount(7);
    db.seedCharacter({ id: 'c1', user_id: 7, role: 'Eyer' });
    context = new PlayerContextService(db.asService(), () => 1_700_000_000_000, tables);
  });

  it('未加载 → null，不触发 DB 查询', () => {
    expect(context.peekExtras(7)).toBeNull();
    expect(context.peekExtras(Number.NaN)).toBeNull();
    expect(context.peekExtras(-1)).toBeNull();
  });

  it('加载后返回同一引用', async () => {
    const loaded = await context.extrasOf(7);
    expect(context.peekExtras(7)).toBe(loaded);
  });
});
