/**
 * IonetClient 单测（连接状态机 / 并发关联 / 推送分流 / 超时 / 退避 / 心跳 / 生命周期）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationMessage } from '@nbb-ionet/client-protocol';
import {
  computeBackoffDelay,
  IonetClient,
  withToken,
  type IonetClientOptions,
} from '../client/ionet-client.js';
import {
  BusinessError,
  ConnectionError,
  HandshakeError,
  RequestTimeoutError,
  TransportError,
} from '../client/errors.js';
import { ManualLifecycleAdapter } from '../client/lifecycle.js';
import { FakeSocketAdapterFactory } from '../testing/fake-socket-adapter.js';
import { businessFail, businessOk, createFakePair } from '../testing/memory-ionet-server.js';

afterEach(() => {
  vi.useRealTimers();
});

function makeClient(
  factory: FakeSocketAdapterFactory,
  overrides: Partial<IonetClientOptions> = {},
): IonetClient {
  return new IonetClient({
    url: 'ws://test/ws',
    adapterFactory: factory.create,
    heartbeat: false,
    reconnect: { enabled: false },
    ...overrides,
  });
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('握手 URL', () => {
  it('withToken：无 query / 有 query / 空 token / 需要转义', () => {
    expect(withToken('ws://h/ws', undefined)).toBe('ws://h/ws');
    expect(withToken('ws://h/ws', '')).toBe('ws://h/ws');
    expect(withToken('ws://h/ws', 'abc')).toBe('ws://h/ws?token=abc');
    expect(withToken('ws://h/ws?x=1', 'abc')).toBe('ws://h/ws?x=1&token=abc');
    expect(withToken('ws://h/ws', 'a b&c')).toBe('ws://h/ws?token=a%20b%26c');
  });
});

describe('reqId 并发配对', () => {
  it('并发请求 + 乱序响应各归其主', async () => {
    const { factory, server } = createFakePair();
    server.on(1, 2, (request) => {
      const n = (request.data as { n: number }).n;
      return { data: businessOk({ n }), delayMs: n === 1 ? 40 : 5 };
    });
    const client = makeClient(factory);
    await client.connect();

    const first = client.request<{ n: number }>(1, 2, { n: 1 });
    const second = client.request<{ n: number }>(1, 2, { n: 2 });
    await tick();
    expect(client.inFlight).toBe(2);

    const secondResult = await second;
    expect(secondResult.success).toBe(true);
    if (secondResult.success) expect(secondResult.data).toEqual({ n: 2 });

    const firstResult = await first;
    expect(firstResult.success).toBe(true);
    if (firstResult.success) expect(firstResult.data).toEqual({ n: 1 });

    const reqIds = server.requests.map((r) => r.reqId);
    expect(reqIds).toHaveLength(2);
    expect(new Set(reqIds).size).toBe(2);
    expect(client.inFlight).toBe(0);
  });

  it('serial 策略：请求不带 reqId，服务端也不回显（旧协议 §12.1），响应按 FIFO 归属', async () => {
    const { factory, server } = createFakePair({ echoReqId: false });
    server.on(3, 1, () => ({ data: businessOk('a') }));
    server.on(3, 2, () => ({ data: businessOk('b') }));
    const client = makeClient(factory, { correlation: 'serial' });
    await client.connect();

    const a = await client.request<string>(3, 1, {});
    expect(a.success && a.data).toBe('a');
    const sent = factory.latest?.sentFrames() ?? [];
    expect(sent.every((frame) => frame['reqId'] === undefined)).toBe(true);
    expect(server.requests.every((r) => r.reqId === undefined)).toBe(true);

    const b = await client.request<string>(3, 2, {});
    expect(b.success && b.data).toBe('b');
  });
});

describe('推送分流（绝不被当作响应）', () => {
  it('携带同 reqId 的 notification 仍走通知总线，不 settle 在途请求', async () => {
    const { factory, server } = createFakePair();
    server.on(7, 1, () => ({ data: businessOk({ real: true }), delayMs: 30 }));
    const viaOption: NotificationMessage[] = [];
    const client = makeClient(factory, { onNotification: (n) => viaOption.push(n) });
    const seen: NotificationMessage[] = [];
    client.notifications.subscribe((n) => seen.push(n));
    const byRoute: NotificationMessage[] = [];
    client.notifications.subscribeRoute(7, 1, (n) => byRoute.push(n));
    await client.connect();
    const pending = client.request<{ real: boolean }>(7, 1, {});
    await tick();
    const reqId = server.requests[0]?.reqId;
    expect(reqId).toBeDefined();

    // 故意回显在途请求的 reqId —— 分流只认 kind（PROTOCOL §5）。
    server.push({ reqId, cmd: 7, subCmd: 1, data: { fake: true } });
    await tick();
    expect(seen).toHaveLength(1);
    expect(byRoute).toHaveLength(1);
    expect(viaOption).toHaveLength(1);
    expect(seen[0]?.data).toEqual({ fake: true });

    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await tick();
    expect(settled).toBe(false);

    const result = await pending;
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ real: true });
    expect(seen).toHaveLength(1);
  });

  it('订阅者抛错不影响其他订阅者，也不影响连接', async () => {
    const { factory, server } = createFakePair();
    const client = makeClient(factory);
    const received: string[] = [];
    client.notifications.subscribe(() => {
      throw new Error('boom');
    });
    const errors: unknown[] = [];
    client.notifications.setErrorHandler((error) => errors.push(error));
    client.notifications.subscribeType('room.tick', () => received.push('type'));
    client.notifications.subscribe((n) => received.push(`all:${String(n.type)}`));
    await client.connect();

    server.push({ type: 'room.tick', data: 1 });
    // 全量订阅先于 type 订阅被调用（Set 插入序），两者都必须收到。
    expect(received).toEqual(['all:room.tick', 'type']);
    expect(errors).toHaveLength(1);
    expect(client.state).toBe('online');
  });
});

describe('请求超时与连接失败', () => {
  it('无响应 → RequestTimeoutError，在途清零', async () => {
    const { factory } = createFakePair();
    const client = makeClient(factory);
    await client.connect();
    await expect(client.request(9, 9, {}, { timeoutMs: 25 })).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
    expect(client.inFlight).toBe(0);
  });

  it('连接断开 → fail 所有在途请求（ConnectionError）', async () => {
    const { factory, server } = createFakePair();
    server.on(5, 5, () => ({ data: businessOk(1), delayMs: 50 }));
    const client = makeClient(factory);
    await client.connect();
    const pending = client.request(5, 5, {});
    await tick();
    factory.latest?.serverClose(1006, 'drop');
    await expect(pending).rejects.toBeInstanceOf(ConnectionError);
    expect(client.inFlight).toBe(0);
  });

  it('未 connect（idle）时请求立即报 ConnectionError', async () => {
    const { factory } = createFakePair();
    const client = makeClient(factory);
    await expect(client.request(1, 1, {})).rejects.toBeInstanceOf(ConnectionError);
  });
});

describe('两级错误判定（client 层）', () => {
  it('errorCode !== 0 → TransportError', async () => {
    const { factory, server } = createFakePair();
    server.on(4, 1, () => ({ errorCode: 500, errorMessage: '内部异常' }));
    const client = makeClient(factory);
    await client.connect();
    const error = await client.request(4, 1, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).errorCode).toBe(500);
  });

  it('errorCode === 0 + data.success === false → BusinessError（默认抛）', async () => {
    const { factory, server } = createFakePair();
    server.on(4, 2, () => ({ data: businessFail('NOT_ENOUGH_GOLD', '金币不足') }));
    const businessErrors: BusinessError[] = [];
    const client = makeClient(factory, { onBusinessError: (e) => businessErrors.push(e) });
    await client.connect();
    const error = await client.request(4, 2, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BusinessError);
    expect((error as BusinessError).code).toBe('NOT_ENOUGH_GOLD');
    expect(businessErrors).toHaveLength(1);
  });

  it('allowBusinessFailure: true → 业务失败作为预期分支返回（typed API 语义）', async () => {
    const { factory, server } = createFakePair();
    server.on(4, 3, () => ({ data: businessFail('INVENTORY_FULL') }));
    const client = makeClient(factory);
    await client.connect();
    const result = await client.request(4, 3, {}, { allowBusinessFailure: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.data.code).toBe('INVENTORY_FULL');
  });

  it('allowBusinessFailure: true 时传输层错误仍然抛', async () => {
    const { factory, server } = createFakePair();
    server.on(4, 4, () => ({ errorCode: 404, errorMessage: 'route missing' }));
    const client = makeClient(factory);
    await client.connect();
    await expect(
      client.request(4, 4, {}, { allowBusinessFailure: true }),
    ).rejects.toBeInstanceOf(TransportError);
  });

  it('坏帧不崩溃，且计数（badFrames）', async () => {
    const { factory } = createFakePair();
    const client = makeClient(factory);
    await client.connect();
    factory.latest?.emitRaw('{ not json');
    factory.latest?.emitRaw('[1,2,3]');
    expect(client.badFrames).toBe(2);
    expect(client.state).toBe('online');
  });
});

describe('退避重连', () => {
  it('computeBackoffDelay：指数增长 + 封顶', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0 };
    const random = (): number => 0.5; // 抖动系数 = 1
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => computeBackoffDelay(n, options, random))).toEqual([
      100, 200, 400, 800, 1000, 1000, 1000,
    ]);
  });

  it('computeBackoffDelay：抖动下界/上界', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 10_000, jitterRatio: 0.2 };
    expect(computeBackoffDelay(1, options, () => 0)).toBe(80);
    expect(computeBackoffDelay(1, options, () => 1)).toBe(120);
  });

  it('断开 → 退避重连成功（第 1 次 100ms），成功后计数归零', async () => {
    vi.useFakeTimers();
    const factory = new FakeSocketAdapterFactory();
    const client = makeClient(factory, {
      reconnect: { enabled: true, baseDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0 },
      random: () => 0.5,
    });
    const states: string[] = [];
    client.subscribeState((state) => states.push(state));
    await client.connect();
    expect(client.state).toBe('online');

    factory.latest?.serverClose(1006);
    expect(client.state).toBe('reconnecting');
    expect(client.getStateDetail()).toContain('100ms');
    expect(client.reconnectAttempts).toBe(1);
    expect(factory.count).toBe(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(factory.count).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(factory.count).toBe(2);
    expect(client.state).toBe('online');
    expect(client.reconnectAttempts).toBe(0); // 成功 open 后归零

    expect(states).toEqual(['connecting', 'online', 'reconnecting', 'connecting', 'online']);
    client.close();
  });

  it('连续失败时退避指数递增：100 → 200 → 400', async () => {
    vi.useFakeTimers();
    let created = 0;
    const factory = new FakeSocketAdapterFactory(() => {
      created += 1;
      // 首次握手成功；后续每次重连都握手失败（模拟临时故障）。
      return created === 1 ? {} : { closeOnConnect: { code: 1006, reason: 'flaky' } };
    });
    const client = makeClient(factory, {
      reconnect: {
        enabled: true,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitterRatio: 0,
        reconnectOnHandshakeFailure: true,
      },
      random: () => 0.5,
    });
    await client.connect();
    expect(client.state).toBe('online');

    factory.latest?.serverClose(1006);
    expect(client.getStateDetail()).toContain('100ms');

    await vi.advanceTimersByTimeAsync(100);
    expect(factory.count).toBe(2);
    expect(client.getStateDetail()).toContain('200ms');

    await vi.advanceTimersByTimeAsync(200);
    expect(factory.count).toBe(3);
    expect(client.getStateDetail()).toContain('400ms');

    await vi.advanceTimersByTimeAsync(400);
    expect(factory.count).toBe(4);
    expect(client.getStateDetail()).toContain('800ms');
    client.close();
  });

  it('握手失败（未 open 即 close，401 语义）默认**不重连**', async () => {
    vi.useFakeTimers();
    const factory = new FakeSocketAdapterFactory({
      closeOnConnect: { code: 1006, reason: 'unauthorized' },
    });
    const rejected: HandshakeError[] = [];
    const client = makeClient(factory, {
      reconnect: { enabled: true, baseDelayMs: 50, jitterRatio: 0 },
      onHandshakeRejected: (error) => rejected.push(error),
    });
    await expect(client.connect()).rejects.toBeInstanceOf(HandshakeError);
    expect(client.state).toBe('failed');
    expect(rejected).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(factory.count).toBe(1); // 未重连，避免 401 死循环
  });

  it('reconnectOnHandshakeFailure: true 时才按 maxAttempts 重试直至 failed', async () => {
    vi.useFakeTimers();
    const factory = new FakeSocketAdapterFactory({
      closeOnConnect: { code: 1006, reason: 'unauthorized' },
    });
    const client = makeClient(factory, {
      reconnect: {
        enabled: true,
        baseDelayMs: 10,
        maxDelayMs: 10,
        jitterRatio: 0,
        maxAttempts: 2,
        reconnectOnHandshakeFailure: true,
      },
    });
    await client.connect().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);
    expect(client.state).toBe('failed');
    expect(client.getStateDetail()).toContain('上限');
    expect(factory.count).toBe(3);
  });

  it('reconnect.enabled=false 时断开即 failed', async () => {
    vi.useFakeTimers();
    const factory = new FakeSocketAdapterFactory();
    const client = makeClient(factory, { reconnect: { enabled: false } });
    await client.connect();
    factory.latest?.serverClose(1006);
    expect(client.state).toBe('failed');
  });
});

describe('应用层心跳', () => {
  it('15s 默认路由（HEARTBEAT_ROUTE）发出；未回则在 timeout 后强制重连', async () => {
    vi.useFakeTimers();
    const { factory, server } = createFakePair();
    let pings = 0;
    server.on(1, 1, () => {
      pings += 1;
      return pings === 1 ? { data: { success: true, data: { serverTime: 123 } } } : null;
    });
    const client = makeClient(factory, {
      heartbeat: { intervalMs: 1000, timeoutMs: 500 },
      reconnect: { enabled: true, baseDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 },
    });
    await client.connect();

    await vi.advanceTimersByTimeAsync(999);
    expect(pings).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(pings).toBe(1);
    expect(client.heartbeatAcks).toBe(1);
    expect(client.state).toBe('online'); // 有应答则不判死

    const pingFrame = factory.latest?.sentFrames().find((f) => f['cmd'] === 1 && f['subCmd'] === 1);
    expect(pingFrame).toBeDefined();
    expect(pingFrame?.['reqId']).toBeDefined();
    expect(pingFrame?.['data']).toEqual({});

    // 第二发不回 → 500ms 后强制重连。
    await vi.advanceTimersByTimeAsync(1000);
    expect(pings).toBe(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(client.state).toBe('online');
    await vi.advanceTimersByTimeAsync(1);
    expect(client.state).toBe('reconnecting');
    expect(client.getStateDetail()).toContain('心跳超时');
    client.close();
  });

  it('heartbeat: false 时无心跳帧', async () => {
    vi.useFakeTimers();
    const { factory, server } = createFakePair();
    let pings = 0;
    server.on(1, 1, () => {
      pings += 1;
      return { data: { success: true, data: {} } };
    });
    const client = makeClient(factory, { heartbeat: false });
    await client.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pings).toBe(0);
    client.close();
  });
});

describe('生命周期（visibilitychange / online / offline）', () => {
  it('切后台主动断开（offline），回前台自动重连', async () => {
    vi.useFakeTimers();
    const lifecycle = new ManualLifecycleAdapter();
    const factory = new FakeSocketAdapterFactory();
    const client = makeClient(factory, { lifecycle });
    await client.connect();
    expect(client.state).toBe('online');

    lifecycle.setHidden(true);
    expect(client.state).toBe('offline');
    expect(factory.latest?.readyState).toBe('closed');

    lifecycle.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(factory.count).toBe(2);
    expect(client.state).toBe('online');

    // navigator offline → 暂停；online → 恢复。
    lifecycle.emitOffline();
    expect(client.state).toBe('offline');
    lifecycle.emitOnline();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.state).toBe('online');
    client.close();
  });

  it('close() 后状态为 closed 且不再重连', async () => {
    vi.useFakeTimers();
    const factory = new FakeSocketAdapterFactory();
    const client = makeClient(factory, {
      reconnect: { enabled: true, baseDelayMs: 10, jitterRatio: 0 },
    });
    await client.connect();
    client.close();
    expect(client.state).toBe('closed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(factory.count).toBe(1);
  });
});

describe('setToken', () => {
  it('setToken 后在线连接以新凭据重连；authHandler 优先', async () => {
    vi.useFakeTimers();
    const factory = new FakeSocketAdapterFactory();
    const client = makeClient(factory, {
      reconnect: { enabled: true, baseDelayMs: 10, maxDelayMs: 10, jitterRatio: 0 },
    });
    client.setToken('t1', { reconnect: false });
    await client.connect();
    expect(factory.latest?.url).toBe('ws://test/ws?token=t1');

    client.setToken('t2');
    expect(client.state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(10);
    expect(factory.count).toBe(2);
    expect(factory.latest?.url).toBe('ws://test/ws?token=t2');
    client.close();
  });

  it('authHandler 优先于 setToken', async () => {
    const factory = new FakeSocketAdapterFactory();
    const client = makeClient(factory, { authHandler: () => 'from-handler' });
    client.setToken('from-set-token', { reconnect: false });
    await client.connect();
    expect(factory.latest?.url).toBe('ws://test/ws?token=from-handler');
  });

  it('authHandler 抛错时降级为无 token（不阻断连接）', async () => {
    const factory = new FakeSocketAdapterFactory();
    const client = makeClient(factory, {
      authHandler: () => {
        throw new Error('no token');
      },
    });
    await client.connect();
    expect(factory.latest?.url).toBe('ws://test/ws');
  });
});
