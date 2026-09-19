/**
 * 地图控制器端到端冒烟（09 R2）：真实 REST + WS + 数据库
 *
 * 断言新的 `map.*`(130) 段确实可用（不只是路由注册）：
 *   map.list 返回目录 + 解锁状态 → map.snapshot → map.enter(home) 成功且落图
 *   → 同 opId 重放幂等 → 前置未满足的图返回 MAP_LOCKED → map.leave 关会话。
 *
 * 运行：cd packages/server && node scripts/map-controller-smoke.mjs <port>
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
  const reqId = `m-${++reqSeq}`;
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

/** Action 调用：errorCode 非 0 抛错；返回 `data`（ActionResult 信封）。 */
async function action(ws, cmd, subCmd, data = {}) {
  const frame = await callEnvelope(ws, cmd, subCmd, data);
  if (frame.errorCode !== undefined && frame.errorCode !== 0) {
    throw new Error(`传输错误 (${cmd},${subCmd}) errorCode=${frame.errorCode}`);
  }
  return frame.data;
}

const health = await rest('GET', '/health');
check('GET /api/health 200', health.status === 200, `status=${health.status}`);

const username = `map_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
const password = 'map123456';
const registered = await rest('POST', '/auth/register', { username, password });
check('注册新账号', registered.status === 201 || registered.body?.success === true, `status=${registered.status}`);
const token = registered.body?.data?.token ?? registered.body?.token;
check('拿到 token', typeof token === 'string' && token.length > 0);

const ws = await openWs(token);
attach(ws);
check('WS ?token=<jwt> 连接成功', true);

const created = await action(ws, 20, 2, { name: '艾尔', role: 'Eyer', career: 'warrior' });
const characterKey = created?.data?.key;
check('player.create 成功', created?.success === true && typeof characterKey === 'string', characterKey);

const selected = await action(ws, 20, 6, { key: characterKey });
check('player.select 成功', selected?.success === true);

// ---- map.list ----
const listed = await action(ws, 130, 1, {});
check('map.list 返回目录数组', listed?.success === true && Array.isArray(listed.data) && listed.data.length > 0, `count=${listed?.data?.length}`);
const homes = (listed?.data ?? []).filter((m) => m.key === 'home');
check('map.list 含 home 且已解锁', homes.length === 1 && homes[0].unlocked === true, JSON.stringify(homes[0] ?? null));
check('map.list 锁定项带 lockedReason', (listed?.data ?? []).every((m) => m.unlocked === true || typeof m.lockedReason === 'string'));

// ---- map.snapshot ----
const snap = await action(ws, 130, 2, {});
check('map.snapshot 返回世界快照', snap?.success === true && typeof snap.data?.map === 'string', snap?.data?.map);

// ---- map.enter(home) ----
const entered = await action(ws, 130, 3, { map: 'home', opId: `op-map-${Date.now()}` });
check('map.enter(home) 成功且落图', entered?.success === true && entered.data?.map === 'home', JSON.stringify(entered?.data?.map ?? entered));

// ---- 幂等：同 opId 重放 ----
const opId = `op-idem-${Date.now()}`;
const first = await action(ws, 130, 3, { map: 'home', opId });
const second = await action(ws, 130, 3, { map: 'home', opId });
check('map.enter 同 opId 重放仍成功（幂等）', first?.success === true && second?.success === true);

// ---- 前置未满足 → MAP_LOCKED（town.street 需要前置剧情） ----
const locked = await action(ws, 130, 3, { map: 'town.street' });
check('map.enter 条件未满足 → MAP_LOCKED', locked?.success === false && locked?.data?.code === 'MAP_LOCKED', JSON.stringify(locked?.data ?? locked));

// ---- 未知地图 → MAP_LOCKED ----
const unknown = await action(ws, 130, 3, { map: 'no.such.map' });
check('map.enter 未知地图 → MAP_LOCKED', unknown?.success === false && unknown?.data?.code === 'MAP_LOCKED', JSON.stringify(unknown?.data ?? unknown));

// ---- map.leave ----
const left = await action(ws, 130, 4, {});
check('map.leave 成功', left?.success === true);

ws.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n地图控制器冒烟：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
process.exit(0);
