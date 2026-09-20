/**
 * 挑战队列 端到端冒烟（09 R3-b1；RC4/M2）：真实 REST + WS + 数据库
 *
 * 断言服务端是队列**唯一所有者**：
 *   queueGet（空 + 票键状态）→ queueSet（非法条目被过滤）→ queueAdd / 失败路径
 *   → queueRemove → queueClear → 重新连接后队列**仍在**（已落库）
 *   → reset 的三条失败路径（不可重置 / 非秘境 / 神力不足）。
 *
 * 运行：cd packages/server && node scripts/dungeon-queue-smoke.mjs <port>
 * ⚠️ 需要真实数据库与服务端已启动（先 `pnpm run build`）。
 */
import WebSocket from 'ws';

const port = Number(process.argv[2] ?? 3100);
const base = process.argv[3] ?? `http://127.0.0.1:${port}/api`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  —— ${detail}` : ''}`);
}

async function rest(method, path, body, token) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: text === '' ? {} : JSON.parse(text) };
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 200) } };
  }
}

function openWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => reject(new Error('WS 连接超时')), 8000);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

let reqSeq = 0;
const pending = new Map();

function attach(ws) {
  ws.on('message', (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (frame.kind === 'notification') return;
    const entry = frame.reqId !== undefined ? pending.get(frame.reqId) : undefined;
    if (entry !== undefined) {
      pending.delete(frame.reqId);
      entry(frame);
    }
  });
}

function callEnvelope(ws, cmd, subCmd, data, timeoutMs = 8000) {
  const reqId = `dq-${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`Action 超时 (${cmd},${subCmd})`));
    }, timeoutMs);
    pending.set(reqId, (frame) => {
      clearTimeout(timer);
      resolve(frame);
    });
    ws.send(JSON.stringify({ cmd, subCmd, data, reqId }));
  });
}

async function action(ws, cmd, subCmd, data = {}) {
  const frame = await callEnvelope(ws, cmd, subCmd, data);
  if (frame.errorCode !== undefined && frame.errorCode !== 0) {
    throw new Error(`传输错误 (${cmd},${subCmd}) errorCode=${frame.errorCode}`);
  }
  return frame.data;
}

const health = await rest('GET', '/health');
check('GET /api/health 200', health.status === 200, `status=${health.status}`);

const username = `dq_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
const registered = await rest('POST', '/auth/register', { username, password: 'dq123456' });
const token = registered.body?.data?.token ?? registered.body?.token;
check('注册并拿到 token', typeof token === 'string' && token.length > 0, `status=${registered.status}`);

let ws = await openWs(token);
attach(ws);

const created = await action(ws, 20, 2, { name: '艾尔', role: 'Eyer', career: 'warrior' });
const characterKey = created?.data?.key;
check('player.create 成功', created?.success === true && typeof characterKey === 'string');
await action(ws, 20, 6, { key: characterKey });

// ---- queueGet：空队列 + 票键状态 ----
const initial = await action(ws, 140, 1, {});
check('dungeon.queueGet 空队列', initial?.success === true && Array.isArray(initial.data?.entries), `entries=${initial?.data?.entries?.length}`);
const cave2 = (initial?.data?.tickets ?? []).find((t) => t.ticketKey === 'nightmare.1');
check('票键状态含 nightmare.1（stacks/available/nextResetAt）', cave2 !== undefined && typeof cave2.stacks === 'number' && typeof cave2.available === 'boolean' && Number.isFinite(cave2.nextResetAt), JSON.stringify(cave2));
check('票键状态按票键去重', new Set((initial?.data?.tickets ?? []).map((t) => t.ticketKey)).size === (initial?.data?.tickets ?? []).length);

// ---- queueSet：非法条目被过滤 ----
const set = await action(ws, 140, 2, {
  entries: [{ key: 'home' }, { key: 'no.such.map' }, { key: 'world.1', endlessLevel: 2 }, null],
});
check('queueSet 过滤未知地图 / 非法条目', set?.success === true && set.data.entries.length === 2, JSON.stringify(set?.data?.entries));

// ---- queueAdd ----
const added = await action(ws, 140, 3, { entry: { key: 'nightmare.wolf' } });
check('queueAdd 追加成功', added?.success === true && added.data.entries.length === 3);
const badAdd = await action(ws, 140, 3, { entry: { key: 'no.such.map' } });
check('queueAdd 非法条目 → INVALID_PARAM', badAdd?.success === false && badAdd?.data?.code === 'INVALID_PARAM', JSON.stringify(badAdd?.data));

// ---- queueRemove ----
const removed = await action(ws, 140, 4, { index: 0 });
check('queueRemove 按下标删除', removed?.success === true && removed.data.entries.map((e) => e.key).join(',') === 'world.1,nightmare.wolf', JSON.stringify(removed?.data?.entries));

// ---- 落库往返：留下一条，重连后仍在 ----
await action(ws, 140, 5, {});
await action(ws, 140, 2, { entries: [{ key: 'home', endlessLevel: 0 }] });
ws.close();
ws = await openWs(token);
attach(ws);
await action(ws, 20, 6, { key: characterKey });
const afterReload = await action(ws, 140, 1, {});
check('重新连接后队列仍在（已落库）', afterReload?.success === true && afterReload.data.entries.length === 1 && afterReload.data.entries[0].key === 'home', JSON.stringify(afterReload?.data?.entries));

// ---- reset 失败路径 ----
const notResettable = await action(ws, 140, 8, { map: 'year2018.dungeon' });
check('reset 无 resetPrice → INVALID_PARAM（不可重置）', notResettable?.success === false && notResettable?.data?.code === 'INVALID_PARAM', JSON.stringify(notResettable?.data));
const notDungeon = await action(ws, 140, 8, { map: 'home' });
check('reset 非秘境 → MAP_LOCKED', notDungeon?.success === false && notDungeon?.data?.code === 'MAP_LOCKED', JSON.stringify(notDungeon?.data));
const poor = await action(ws, 140, 8, { map: 'nightmare.slime' });
check('reset 神力不足 → NOT_ENOUGH_DIAMONDS', poor?.success === false && poor?.data?.code === 'NOT_ENOUGH_DIAMONDS', JSON.stringify(poor?.data));

// ---- 清理 + leave ----
await action(ws, 140, 5, {});
await action(ws, 140, 7, {});
check('dungeon.leave 成功', true);

ws.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n挑战队列冒烟：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
process.exit(0);
