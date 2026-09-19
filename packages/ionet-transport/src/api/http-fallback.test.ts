/**
 * HTTP fallback（PROTOCOL §9）单测。
 *
 * 硬要求覆盖：
 * - 路由 `POST {base}/{cmd}/{subCmd}`；
 * - body **必须** `{data:...}` 包装（框架裸 object DTO 偏差）；
 * - HTTP 通道**不产生** `reqId`/`kind`；
 * - 两级错误判定（状态码 / errorCode / data.success）。
 */
import { describe, expect, it } from 'vitest';
import { CMD_SEGMENTS } from '@idle-dark/protocol';
import { BusinessError, ProtocolError, TransportError } from '../client/errors.js';
import { businessFail, businessOk } from '../testing/memory-ionet-server.js';
import { GameApi } from './game-api.js';
import { HttpFallback, httpActionPath, wrapHttpBody, type FetchLike } from './http-fallback.js';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function mockFetch(
  reply: (call: FetchCall) => { status?: number; body?: string } | Promise<{ status?: number; body?: string }>,
): { calls: FetchCall[]; impl: FetchLike } {
  const calls: FetchCall[] = [];
  const impl: FetchLike = async (url, init) => {
    const call: FetchCall = { url, init: init ?? {} };
    calls.push(call);
    const { status = 200, body = '' } = await reply(call);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    } as Response;
  };
  return { calls, impl };
}

const envelope = (payload: Record<string, unknown>): string => JSON.stringify(payload);

function parseBody(init: RequestInit): unknown {
  return JSON.parse(String(init.body));
}

describe('纯函数', () => {
  it('httpActionPath：归一化尾部斜杠与缺省前缀', () => {
    expect(httpActionPath('/ionet', 30, 1)).toBe('/ionet/30/1');
    expect(httpActionPath('/ionet/', 30, 1)).toBe('/ionet/30/1');
    expect(httpActionPath('http://h:3000/api/', 1, 1)).toBe('http://h:3000/api/1/1');
  });

  it('wrapHttpBody：一律 {data:...} 包装，undefined → {}', () => {
    expect(JSON.parse(wrapHttpBody({ map: 'a' }))).toEqual({ data: { map: 'a' } });
    expect(JSON.parse(wrapHttpBody(undefined))).toEqual({ data: {} });
    expect(JSON.parse(wrapHttpBody(5))).toEqual({ data: 5 });
    expect(JSON.parse(wrapHttpBody([1, 2]))).toEqual({ data: [1, 2] });
    expect(JSON.parse(wrapHttpBody(null))).toEqual({ data: null });
    // 裸 object 绝不会直接作为 body 出现：
    expect(JSON.parse(wrapHttpBody({ success: true }))).toEqual({ data: { success: true } });
  });
});

describe('HttpFallback —— 路由与 body 包装', () => {
  it('POST {base}/{cmd}/{subCmd}，body 为 {data:params}', async () => {
    const { calls, impl } = mockFetch(() => ({
      body: envelope({ errorCode: 0, data: businessOk({ ok: true }) }),
    }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    const result = await http.request(CMD_SEGMENTS.world, 1, { map: 'cave' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/ionet/30/1');
    expect(calls[0]?.init.method).toBe('POST');
    expect(parseBody(calls[0]!.init)).toEqual({ data: { map: 'cave' } });
    expect(result.success).toBe(true);
  });

  it('无参数 → {data:{}}（仍带包装）', async () => {
    const { calls, impl } = mockFetch(() => ({ body: envelope({ errorCode: 0, data: businessOk(null) }) }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    await http.request(CMD_SEGMENTS.system, 2);
    expect(parseBody(calls[0]!.init)).toEqual({ data: {} });
  });

  it('标量/数组参数同样包装（数组不会被当信封）', async () => {
    const { calls, impl } = mockFetch(() => ({ body: envelope({ errorCode: 0, data: businessOk(null) }) }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    await http.request(1, 1, [1, 2, 3]);
    expect(parseBody(calls[0]!.init)).toEqual({ data: [1, 2, 3] });
  });

  it('请求体不含 reqId/kind（HTTP 通道不产生配对语义）', async () => {
    const { calls, impl } = mockFetch(() => ({ body: envelope({ errorCode: 0, data: businessOk(null) }) }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    const raw = await http.requestEnvelope(1, 1, { a: 1 });
    const body = parseBody(calls[0]!.init) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['data']);
    expect(body['reqId']).toBeUndefined();
    expect(body['kind']).toBeUndefined();
    // 响应侧同样不含 reqId/kind：
    expect(raw.reqId).toBeUndefined();
    expect(raw.kind).toBeUndefined();
  });

  it('tokenProvider → Authorization: Bearer；缺失则无该头', async () => {
    const { calls, impl } = mockFetch(() => ({ body: envelope({ errorCode: 0, data: businessOk(null) }) }));
    const withToken = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl, tokenProvider: () => 'jwt-1' });
    await withToken.request(1, 1, {});
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-1');

    const noToken = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl, tokenProvider: () => undefined });
    await noToken.request(1, 1, {});
    expect((calls[1]!.init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });
});

describe('HttpFallback —— 错误判定', () => {
  it('HTTP 状态非 2xx → TransportError(status)', async () => {
    const { impl } = mockFetch(() => ({ status: 503, body: envelope({ errorCode: 503, errorMessage: '未就绪' }) }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    const error = await http.request(1, 1, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).errorCode).toBe(503);
    expect((error as TransportError).message).toBe('未就绪');
  });

  it('HTTP 200 + errorCode !== 0 → TransportError（传输层）', async () => {
    const { impl } = mockFetch(() => ({ body: envelope({ errorCode: 500, errorMessage: '内部异常' }) }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    await expect(http.request(1, 1, {})).rejects.toBeInstanceOf(TransportError);
  });

  it('HTTP 200 + errorCode 0 + data.success === false → 默认抛 BusinessError', async () => {
    const { impl } = mockFetch(() => ({ body: envelope({ errorCode: 0, data: businessFail('ITEM_LOCKED', '物品已锁定') }) }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    const error = await http.request(1, 1, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BusinessError);
    expect((error as BusinessError).code).toBe('ITEM_LOCKED');
  });

  it('allowBusinessFailure: true → 业务失败作为值返回（typed API 语义）', async () => {
    const { impl } = mockFetch(() => ({ body: envelope({ errorCode: 0, data: businessFail('INVENTORY_FULL') }) }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    const result = await http.request(1, 1, {}, { allowBusinessFailure: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('INVENTORY_FULL');
  });

  it('allowBusinessFailure: true 时传输层错误仍抛', async () => {
    const { impl } = mockFetch(() => ({ body: envelope({ errorCode: 500 }) }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    await expect(
      http.request(1, 1, {}, { allowBusinessFailure: true }),
    ).rejects.toBeInstanceOf(TransportError);
  });

  it('错误码缺失 + 业务码缺失 → UNKNOWN', async () => {
    const { impl } = mockFetch(() => ({ body: envelope({ data: { success: false } }) }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    const error = await http.request(1, 1, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BusinessError);
    expect((error as BusinessError).code).toBe('UNKNOWN');
  });

  it('网络异常 → TransportError(0)', async () => {
    const impl: FetchLike = async () => {
      throw new Error('dns failure');
    };
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    const error = await http.request(1, 1, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).errorCode).toBe(0);
  });

  it('非法 JSON / 非对象 / 空响应体 → ProtocolError', async () => {
    const bad = new HttpFallback({
      baseUrl: '/ionet',
      fetchImpl: mockFetch(() => ({ body: '<html>' })).impl,
    });
    await expect(bad.request(1, 1, {})).rejects.toBeInstanceOf(ProtocolError);

    const scalar = new HttpFallback({
      baseUrl: '/ionet',
      fetchImpl: mockFetch(() => ({ body: '42' })).impl,
    });
    await expect(scalar.request(1, 1, {})).rejects.toBeInstanceOf(ProtocolError);

    const empty = new HttpFallback({
      baseUrl: '/ionet',
      fetchImpl: mockFetch(() => ({ body: '' })).impl,
    });
    await expect(empty.request(1, 1, {})).rejects.toBeInstanceOf(ProtocolError);
  });

  it('非法路由 → ProtocolError，且不发请求', async () => {
    const { calls, impl } = mockFetch(() => ({ body: envelope({ errorCode: 0 }) }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    await expect(http.request(-1, 0, {})).rejects.toBeInstanceOf(ProtocolError);
    await expect(http.request(1.5, 0, {})).rejects.toBeInstanceOf(ProtocolError);
    expect(calls).toHaveLength(0);
  });

  it('无 fetch 环境且未注入 → 构造抛错', () => {
    const original = (globalThis as { fetch?: unknown }).fetch;
    try {
      delete (globalThis as { fetch?: unknown }).fetch;
      expect(() => new HttpFallback({ baseUrl: '/ionet' })).toThrow(/fetch/);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

describe('HttpFallback 作为 GameApi 传输面', () => {
  it('GameApi 走 HTTP fallback 时业务失败不抛', async () => {
    const { calls, impl } = mockFetch(() => ({
      body: envelope({ errorCode: 0, data: businessFail('PLAYER_SLOT_FULL', '角色栏位已满') }),
    }));
    const http = new HttpFallback({ baseUrl: '/ionet', fetchImpl: impl });
    const api = new GameApi(http);
    const result = await api.player.create({ name: 'x', role: 'warrior' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('PLAYER_SLOT_FULL');
    expect(calls[0]?.url).toBe('/ionet/20/2');
    expect(parseBody(calls[0]!.init)).toEqual({ data: { name: 'x', role: 'warrior' } });
  });
});
