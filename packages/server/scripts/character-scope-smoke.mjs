/**
 * 角色归属 / 推送范围 冒烟：**同账号两条连接不再串号**
 *
 * 复现并锁死这个缺陷（真实 REST + WS + DB）：
 * - 旧行为：`player.select` 只 start 新角色、不停旧会话 → 两个角色的世界同时 tick，
 *   而框架的定向推送按 `userId` 扇出到该账号**全部**连接 →
 *   两条连接互相收到/推进对方的角色，`world.snapshot` 还会解析到「另一个角色」。
 * - 新行为：一个账号同一时刻只有一个活跃角色会话；显式 key 必须等于当前角色（fail-closed）。
 *
 * 运行：cd packages/server && node scripts/character-scope-smoke.mjs <port>
 * ⚠️ 会创建临时账号并把它的角色栏扩到 3（只动该账号自己的 account_state）。
 */
import WebSocket from 'ws';
import pg from 'pg';
import { readFileSync } from 'node:fs';

const port = Number(process.argv[2] ?? 3000);
const base = `http://127.0.0.1:${port}/api`;
const DATABASE_URL =
  process.env.DATABASE_URL ??
  (/^postgresql:\/\//.test(readEnv('DATABASE_URL')) ? readEnv('DATABASE_URL') : '');
function readEnv(key) {
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`));
    return line === undefined ? '' : line.slice(key.length + 1).trim();
  } catch {
    return '';
  }
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  —— ${detail}`}`);
};

const rest = async (m, p, b) =>
  (await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, ...(b ? { body: JSON.stringify(b) } : {}) })).json();

function connect(token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  let seq = 0;
  const pending = new Map();
  const ticks = [];
  ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString());
    if (f.kind === 'notification') {
      if (f.cmd === 30 && f.subCmd === 5) ticks.push(f.data);
      return;
    }
    const e = pending.get(f.reqId);
    if (e) { pending.delete(f.reqId); e(f); }
  });
  const call = (cmd, subCmd, data, timeout = 8000) =>
    new Promise((res, rej) => {
      const reqId = `cs-${++seq}`;
      const t = setTimeout(() => { pending.delete(reqId); rej(new Error(`timeout ${cmd},${subCmd}`)); }, timeout);
      pending.set(reqId, (f) => { clearTimeout(t); res(f); });
      ws.send(JSON.stringify({ cmd, subCmd, reqId, ...(data ? { data } : {}) }));
    });
  return { ws, call, ticks, open: () => new Promise((r) => ws.on('open', r)) };
}

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const username = `scope_${suffix}`;
const password = 'smoke-pass-123';
const reg = await rest('POST', '/auth/register', { username, password });
const login = await rest('POST', '/auth/login', { username, password });
const token = login?.data?.token;
const userId = Number(login?.data?.userId);
check('注册/登录成功', reg?.success === true && typeof token === 'string');

// player_slot_count 默认 1：扩到 3 才能建两个角色（只动本临时账号）
const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
await db.query('update account_state set player_slot_count = 3 where user_id = $1', [userId]);

const A = connect(token);
const B = connect(token);
await Promise.all([A.open(), B.open()]);
check('同账号建立两条 WS 连接', true);

const x = await A.call(20, 2, { name: `甲_${suffix.slice(-4)}`, role: 'Eyer', career: 'warrior' });
const keyX = x.data?.data?.key;
const y = await B.call(20, 2, { name: `乙_${suffix.slice(-4)}`, role: 'Eyer', career: 'warrior' });
const keyY = y.data?.data?.key;
check('两个角色创建成功', typeof keyX === 'string' && typeof keyY === 'string');

await A.call(20, 6, { key: keyX });
await B.call(20, 6, { key: keyY });
await new Promise((r) => setTimeout(r, 1200));

// 1) 显式 key 必须等于当前角色：A 再点名 X → 拒绝（fail-closed）
const stale = await A.call(30, 1, { key: keyX });
check(
  '显式指定「非当前角色」→ 拒绝（不再串号）',
  stale.data?.success === false && stale.data?.data?.code === 'PLAYER_NOT_FOUND',
  JSON.stringify(stale.data).slice(0, 160),
);

// 2) 不带 key 回退到当前角色（= B 刚选的 Y）
const snap = await A.call(30, 1, {});
const playerKey = (snap.data?.data?.units ?? []).find((u) => u.kind === 'player')?.typeKey;
check('不带 key 回退到「当前角色」（账号级唯一真相）', playerKey === keyY, `解析到 ${playerKey}`);

// 3) 关键：tick 帧里**只会出现当前角色**，不会再混入已停会话的旧角色
A.ticks.length = 0;
B.ticks.length = 0;
await new Promise((r) => setTimeout(r, 2500));
const playerKeys = new Set();
for (const t of [...A.ticks, ...B.ticks]) {
  for (const u of t.units ?? []) if (u.kind === 'player') playerKeys.add(u.typeKey);
}
check(
  '推送只属于当前角色（帧里只有 Y，没有旧角色 X）',
  playerKeys.size > 0 && [...playerKeys].every((k) => k === keyY),
  `出现的角色=${[...playerKeys].join(',')}`,
);
check(
  '同一批 tick 只 enqueue 一帧（账号级单会话 → 不再双份世界）',
  A.ticks.length > 0 && Math.abs(A.ticks.length - B.ticks.length) <= 1,
  `A=${A.ticks.length} B=${B.ticks.length}（2.5s）`,
);

// 4) 刷新页面场景：**新连接（未选角）不应再收到战斗推送**
//    —— 旧实现里旧会话还在跑、isOnline 又是账号级判据，于是选角页会一直收到 (world, tick)。
const C = connect(token);
await C.open();
check('刷新后新连接建立', true);
await new Promise((r) => setTimeout(r, 3000));
check(
  '新连接（停在选角页、未 select）**收不到** (world, tick) 战斗推送',
  C.ticks.length === 0,
  `收到 ${C.ticks.length} 帧`,
);
const staleSnap = await C.call(30, 1, {});
check(
  '新连接调 world.snapshot → 视为未选角色',
  staleSnap.data?.success === false && staleSnap.data?.data?.code === 'NOT_IN_MAP',
  JSON.stringify(staleSnap.data).slice(0, 140),
);

A.ws.close();
B.ws.close();
C.ws.close();
await db.end();
const failed = results.filter((r) => r.ok === false);
console.log(`\n角色归属冒烟：${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
