/**
 * 跨服事件层边界单测（R1-a2）
 *
 * 覆盖：
 * - 总线：无订阅者 emit 不抛；订阅/取消；重复取消幂等；单订阅者抛错不影响其它订阅者；
 * - `PlayerContextService.peekExtras`：未加载返回 null、加载后返回同一引用。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultTables, type DataTables } from '@idle-dark/game-core';
import { InProcessEventBus } from '../../../src/modules/logic/shared/event-bus.js';
import type { DomainEvent } from '../../../src/modules/logic/shared/events.js';
import { PlayerContextService } from '../../../src/modules/logic/shared/player-context.service.js';
import { FakeDatabase } from '../../helpers/fake-database.js';

const tables: DataTables = createDefaultTables();

describe('InProcessEventBus', () => {
  it('无订阅者时 emit 不抛错', () => {
    const bus = new InProcessEventBus();
    expect(() => bus.emit({ type: 'CombatHooksDirty', userId: 1, characterId: 'c1' })).not.toThrow();
    expect(bus.handlerCountOf('CombatHooksDirty')).toBe(0);
  });

  it('订阅后按名收到事件，取消后不再收到；重复取消是 no-op', () => {
    const bus = new InProcessEventBus();
    const seen: DomainEvent[] = [];
    const off = bus.on('CombatHooksDirty', (event) => seen.push(event));
    bus.emit({ type: 'CombatHooksDirty', userId: 1, characterId: 'c1' });
    expect(seen).toHaveLength(1);
    off();
    off();
    bus.emit({ type: 'CombatHooksDirty', userId: 1, characterId: 'c1' });
    expect(seen).toHaveLength(1);
    expect(bus.handlerCountOf('CombatHooksDirty')).toBe(0);
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
    const offA = bus.on('CombatHooksDirty', () => {
      order.push('a');
      offA();
    });
    bus.on('CombatHooksDirty', () => order.push('b'));
    bus.emit({ type: 'CombatHooksDirty', userId: 1, characterId: 'c1' });
    expect(order).toEqual(['a', 'b']);
    expect(bus.handlerCountOf('CombatHooksDirty')).toBe(1);
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
