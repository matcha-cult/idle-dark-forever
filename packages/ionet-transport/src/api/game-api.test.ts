/**
 * typed Action API 单测：路由来自 `@idle-dark/protocol` 的 `*_CMD`（**不手工镜像**），
 * 业务失败不抛（预期分支），传输层错误照抛。
 */
import { describe, expect, it } from 'vitest';
import { CMD_SEGMENTS, type ActionResult } from '@idle-dark/protocol';
import { TransportError } from '../client/errors.js';
import { businessFail, businessOk } from '../testing/memory-ionet-server.js';
import {
  GameApi,
  type GameApiRequestOptions,
  type GameApiTransport,
} from './game-api.js';

interface Call {
  cmd: number;
  subCmd: number;
  data: unknown;
  options: GameApiRequestOptions | undefined;
}

function recordingTransport(
  reply: (cmd: number, subCmd: number) => ActionResult<unknown> = () => businessOk(null),
): { calls: Call[]; transport: GameApiTransport } {
  const calls: Call[] = [];
  return {
    calls,
    transport: {
      async request<TData>(cmd: number, subCmd: number, data?: unknown, options?: GameApiRequestOptions) {
        calls.push({ cmd, subCmd, data, options });
        return reply(cmd, subCmd) as ActionResult<TData>;
      },
    },
  };
}

describe('GameApi —— 13 个 cmd 段全覆盖（路由常量直接来自 protocol）', () => {
  it('每个段的方法都打到对应的 CMD_SEGMENTS 段', async () => {
    const { calls, transport } = recordingTransport();
    const api = new GameApi(transport);

    await api.system.version();
    await api.auth.me();
    await api.player.list();
    await api.world.snapshot();
    await api.map.list();
    await api.battle.focus({ targetId: null });
    await api.inventory.list();
    await api.bank.list();
    await api.lootrule.get();
    await api.career.list();
    await api.produce.medicineState();
    await api.shop.state();
    await api.idle.report();

    expect(calls.map((c) => c.cmd)).toEqual([
      CMD_SEGMENTS.system,
      CMD_SEGMENTS.auth,
      CMD_SEGMENTS.player,
      CMD_SEGMENTS.world,
      CMD_SEGMENTS.map,
      CMD_SEGMENTS.battle,
      CMD_SEGMENTS.inventory,
      CMD_SEGMENTS.bank,
      CMD_SEGMENTS.lootrule,
      CMD_SEGMENTS.career,
      CMD_SEGMENTS.produce,
      CMD_SEGMENTS.shop,
      CMD_SEGMENTS.idle,
    ]);
  });

  it('聚合入口暴露全部 13 个子 API', () => {
    const { transport } = recordingTransport();
    const api = new GameApi(transport);
    expect(Object.keys(api).filter((key) => key !== 'transport').sort()).toEqual(
      [
        'auth',
        'bank',
        'battle',
        'career',
        'idle',
        'inventory',
        'lootrule',
        'map',
        'player',
        'produce',
        'shop',
        'system',
        'world',
      ].sort(),
    );
    expect(api.transport).toBe(transport);
  });

  it('subCmd 与参数原样透传（不在 api 层做业务处理）', async () => {
    const { calls, transport } = recordingTransport();
    const api = new GameApi(transport);
    await api.player.select({ key: 'p1' });
    expect(calls[0]?.subCmd).toBe(6);
    expect(calls[0]?.data).toEqual({ key: 'p1' });
  });

  it('**强制** allowBusinessFailure=true（业务失败是预期分支，不抛）', async () => {
    const { calls, transport } = recordingTransport((cmd) =>
      cmd === CMD_SEGMENTS.produce
        ? businessFail('NOT_ENOUGH_MATERIAL', '材料不足')
        : businessOk(null),
    );
    const api = new GameApi(transport);

    const result = await api.produce.enchant({ id: 'i1' });
    expect(calls[0]?.options?.allowBusinessFailure).toBe(true);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.data.code).toBe('NOT_ENOUGH_MATERIAL');
      expect(result.message).toBe('材料不足');
    }
  });

  it('调用方传入的 options 被保留（allowBusinessFailure 仍被强制为 true）', async () => {
    const { calls, transport } = recordingTransport();
    const api = new GameApi(transport);
    await api.player.select(
      { key: 'p1' },
      { traceId: 'trace-1', timeoutMs: 123, allowBusinessFailure: false, headers: { 'x-tag': 'gray' } },
    );
    expect(calls[0]?.data).toEqual({ key: 'p1' });
    expect(calls[0]?.options?.traceId).toBe('trace-1');
    expect(calls[0]?.options?.timeoutMs).toBe(123);
    expect(calls[0]?.options?.headers).toEqual({ 'x-tag': 'gray' });
    expect(calls[0]?.options?.allowBusinessFailure).toBe(true);
  });

  it('传输层错误照抛（不被 api 层吞掉）', async () => {
    const transport: GameApiTransport = {
      async request() {
        throw new TransportError(404, 'route missing');
      },
    };
    const api = new GameApi(transport);
    await expect(api.world.snapshot()).rejects.toBeInstanceOf(TransportError);
  });

  it('业务失败默认也会被 api 层返回而不是抛（透传 transport 的返回）', async () => {
    const transport: GameApiTransport = {
      async request<TData>() {
        return businessFail('RATE_LIMITED') as ActionResult<TData>;
      },
    };
    const api = new GameApi(transport);
    const result = await api.shop.buyPlayerSlot();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('RATE_LIMITED');
  });
});
