/**
 * 战斗推送报文抓取（只读，跑在**全新一次性账号**上，不碰任何现有角色）
 *
 * 流程：注册 → 登录 → WS → 建角 → 选角 → 进 world.1 → 抓 N 秒 (world, tick) 推送。
 *
 * 输出：tmp/capture-<ts>.json —— 含
 *   - 进入地图的 REST/WS 快照响应（敌方单位的**全量**下发形态）；
 *   - 每一个「帧形状」的首个原始样帧（shape = 非空分区 + patch op 类型 + 日志类型）；
 *   - `chg` 的字段集合分布；日志 kind 分布；字节分布；
 *   - 抓取前后的 /api/metrics。
 *
 * 运行：cd packages/server && node scripts/capture-tick.mjs [seconds] [port] [gapMs]
 *
 * 输出落在 packages/server/tmp/（gitignore）：报文是**可复现的证据**，不入库；
 * 结论文档在 ai-docs/25-战斗推送报文梳理.md。
 */
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const seconds = Number(process.argv[2] ?? 30);
const port = Number(process.argv[3] ?? 3100);
/**
 * 首次拉快照**之前**等待的毫秒数。
 *
 * 为什么需要：`snapshotOf()` 会把客户端基线设成全量快照并清掉 `needsReset` ——
 * 紧接着拉快照就**永远看不到 `reset` 帧**。真实世界里 `player.select` 之后
 * 200ms 窗口先到、客户端快照请求后到，那一帧就是 `reset`；这里用 sleep 复现该竞态。
 */
const gapMs = Number(process.argv[4] ?? 0);
const base = `http://127.0.0.1:${port}/api`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;

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
    return text === '' ? {} : JSON.parse(text);
  } catch {
    return { errorCode: response.status, errorMessage: text.slice(0, 200) };
  }
}

const CMD = { system: 1, player: 20, world: 30, battle: 40 };
const SUB = {
  ping: 1,
  playerList: 1,
  playerCreate: 2,
  playerSelect: 6,
  worldSnapshot: 1,
  worldEnterMap: 2,
  worldLeave: 3,
  tick: 5,
  focus: 1,
};

// ── 1. 一次性账号 ──
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const username = `capture_${stamp}`;
const password = 'capture-pass-123';
const reg = await rest('POST', '/auth/register', { username, password });
if (reg?.success !== true) throw new Error(`注册失败: ${JSON.stringify(reg).slice(0, 300)}`);
const login = await rest('POST', '/auth/login', { username, password });
const token = login?.data?.token;
if (typeof token !== 'string') throw new Error(`登录失败: ${JSON.stringify(login).slice(0, 300)}`);
console.log(`# 一次性账号 ${username} (userId=${login?.data?.userId})`);

// ── 2. WS ──
const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
const pending = new Map();
const frames = [];
let seq = 0;

ws.on('message', (raw) => {
  let frame;
  try {
    frame = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (frame.kind === 'notification') {
    frames.push({ at: Date.now(), bytes: Buffer.byteLength(raw.toString(), 'utf8'), frame });
    return;
  }
  const entry = pending.get(frame.reqId);
  if (entry) {
    pending.delete(frame.reqId);
    entry(frame);
  }
});

function call(cmd, subCmd, data, timeoutMs = 8000) {
  const reqId = `c-${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`超时 (${cmd},${subCmd})`));
    }, timeoutMs);
    pending.set(reqId, (frame) => {
      clearTimeout(timer);
      resolve(frame);
    });
    ws.send(JSON.stringify({ cmd, subCmd, reqId, ...(data !== undefined ? { data } : {}) }));
  });
}

await new Promise((resolve, reject) => {
  ws.on('open', resolve);
  ws.on('error', reject);
});

const metricsBefore = await rest('GET', '/metrics');

// ── 3. 建角 → 选角 ──
const created = await call(CMD.player, SUB.playerCreate, { name: '抓包侠', role: 'Eyer' });
const key = created?.data?.data?.key ?? created?.data?.data?.player?.key;
if (typeof key !== 'string') throw new Error(`建角失败: ${JSON.stringify(created).slice(0, 300)}`);
const selected = await call(CMD.player, SUB.playerSelect, { key });
console.log(`# 选角 level=${selected?.data?.data?.level} map=${selected?.data?.data?.map}`);
if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));

// home 快照（未进图时的全量单位）
const homeSnapshot = await call(CMD.world, SUB.worldSnapshot);

// 进图响应 = **全量快照**（敌方单位的第一种下发形态）
const enter = await call(CMD.world, SUB.worldEnterMap, { map: 'world.1' });

// ── 4. 抓帧 ──
const t0 = Date.now();
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const metricsAfter = await rest('GET', '/metrics');

// ── 5. 分类 ──
const ticks = frames.filter((f) => f.frame.cmd === CMD.world && f.frame.subCmd === SUB.tick);
const other = frames.filter((f) => !(f.frame.cmd === CMD.world && f.frame.subCmd === SUB.tick));

const shapeOf = (data) => {
  const parts = [];
  const patch = data?.patch ?? [];
  if (patch.length > 0) parts.push(`patch:${patch.map((op) => op.op).join('+')}`);
  if ((data?.log ?? []).length > 0) parts.push(`log:${[...new Set(data.log.map((e) => e.kind))].sort().join('+')}`);
  if ((data?.loot ?? []).length > 0) parts.push(`loot:${[...new Set(data.loot.map((l) => l.handled))].sort().join('+')}`);
  if (data?.gainedExp) parts.push('exp');
  if (data?.gainedGold) parts.push('gold');
  if (data?.wave !== undefined) parts.push(`wave:${data.wave}`);
  parts.push(`bossPending:${data?.bossPending}`);
  return parts.join(' | ');
};

const shapes = new Map();
const chgFields = new Map();
const logKinds = new Map();
const opCounts = { reset: 0, add: 0, chg: 0, del: 0 };
const byteSizes = [];

for (const item of ticks) {
  const data = item.frame.data ?? {};
  byteSizes.push(item.bytes);
  const shape = shapeOf(data);
  const entry = shapes.get(shape) ?? { count: 0, sample: null, sampleRaw: null, minBytes: Infinity, maxBytes: 0 };
  entry.count += 1;
  entry.minBytes = Math.min(entry.minBytes, item.bytes);
  entry.maxBytes = Math.max(entry.maxBytes, item.bytes);
  if (entry.sample === null) {
    entry.sample = data;
    entry.sampleRaw = item.frame;
  }
  shapes.set(shape, entry);

  for (const op of data.patch ?? []) {
    opCounts[op.op] = (opCounts[op.op] ?? 0) + 1;
    if (op.op === 'chg') {
      const fields = Object.keys(op.fields ?? {}).sort();
      const k = fields.join(',');
      const prev = chgFields.get(k) ?? { count: 0, sample: null };
      prev.count += 1;
      if (prev.sample === null) prev.sample = op;
      chgFields.set(k, prev);
    }
  }
  for (const event of data.log ?? []) {
    const prev = logKinds.get(event.kind) ?? { count: 0, sample: null };
    prev.count += 1;
    if (prev.sample === null) prev.sample = event;
    logKinds.set(event.kind, prev);
  }
}

const out = {
  capturedAt: new Date().toISOString(),
  account: { username, userId: login?.data?.userId },
  character: { key, name: '抓包侠' },
  windowSeconds: seconds,
  homeSnapshot: homeSnapshot?.data ?? null,
  enterMapWorld1: enter?.data ?? null,
  tickCount: ticks.length,
  otherNotifications: other.map((f) => ({ cmd: f.frame.cmd, subCmd: f.frame.subCmd, type: f.frame.type })),
  metricsBefore: metricsBefore?.metrics ?? null,
  metricsAfter: metricsAfter?.metrics ?? null,
  opCounts,
  byteSizes: {
    min: Math.min(...byteSizes),
    max: Math.max(...byteSizes),
    avg: Math.round(byteSizes.reduce((a, b) => a + b, 0) / Math.max(1, byteSizes.length)),
    all: byteSizes,
  },
  shapes: [...shapes.entries()].map(([shape, v]) => ({
    shape,
    count: v.count,
    minBytes: v.minBytes,
    maxBytes: v.maxBytes,
    sample: v.sample,
    sampleEnvelope: v.sampleRaw,
  })),
  chgFieldSets: [...chgFields.entries()].map(([fields, v]) => ({ fields, count: v.count, sample: v.sample })),
  logKinds: [...logKinds.entries()].map(([kind, v]) => ({ kind, count: v.count, sample: v.sample })),
};

// 输出到 `packages/server/tmp/`（gitignore）—— 报文是证据，不入库。
const path = new URL(`../tmp/capture-${stamp}.json`, import.meta.url).pathname;
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`# 抓帧 ${ticks.length} 条 / ${seconds}s；其他推送 ${other.length} 条`);
console.log(`# 帧形状 ${shapes.size} 种；chg 字段集合 ${chgFields.size} 种；日志 kind ${logKinds.size} 种`);
console.log(`# 字节 min=${out.byteSizes.min} avg=${out.byteSizes.avg} max=${out.byteSizes.max}`);
console.log(`# 写入 ${path}`);
ws.close();
process.exit(0);
