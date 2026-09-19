/**
 * 进图自动触发剧情 端到端冒烟：**真实 REST + WS + 数据库**
 *
 * 背景（原版 `MapPanel.checkStories()`）：进入满足条件的地图时，
 * - 纯剧情脚本**弹窗播放**；
 * - 击杀 / 购买任务**静默登记**（否则击杀不计进度，主线卡死）。
 *
 * 本脚本走一遍艾尔主线的前四段，断言服务端确实：
 *   选角 → 推 `eyer-stories-1`（autoPlay=true）
 *   → play/finish 1 → 进 town.street → 推 `eyer-stories-2`（autoPlay=true）
 *   → play/finish 2 → 推 `eyer-stories-3`（taskType=kill，autoPlay=false）且已登记剩余 10 只
 *
 * ⚠️ 需要真实数据库。运行：cd packages/server && node scripts/story-entry-smoke.mjs <port>
 */
import WebSocket from 'ws';

const port = Number(process.argv[2] ?? 3000);
const base = process.argv[3] ?? `http://127.0.0.1:${port}/api`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
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
  let parsed;
  try {
    parsed = text === '' ? {} : JSON.parse(text);
  } catch {
    parsed = { errorCode: response.status, errorMessage: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
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
const pushed = [];

function attach(ws) {
  ws.on('message', (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (frame.kind === 'notification') {
      pushed.push(frame);
      return;
    }
    const entry = frame.reqId !== undefined ? pending.get(frame.reqId) : undefined;
    if (entry !== undefined) {
      pending.delete(frame.reqId);
      entry(frame);
    }
  });
}

function callEnvelope(ws, cmd, subCmd, data, timeoutMs = 8000) {
  const reqId = `st-${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`Action 超时 (${cmd},${subCmd})`));
    }, timeoutMs);
    pending.set(reqId, (frame) => {
      clearTimeout(timer);
      resolve(frame);
    });
    ws.send(JSON.stringify({ cmd, subCmd, reqId, ...(data !== undefined ? { data } : {}) }));
  });
}

/** 两级错误判定（见 AGENTS.md §5.1）。 */
async function call(ws, cmd, subCmd, data, timeoutMs) {
  const envelope = await callEnvelope(ws, cmd, subCmd, data, timeoutMs);
  if (envelope.errorCode !== undefined && envelope.errorCode !== 0) {
    return { ok: false, transport: true, errorCode: envelope.errorCode, errorMessage: envelope.errorMessage, envelope };
  }
  const action = envelope.data;
  const ok = action !== null && typeof action === 'object' && action.success === true;
  return { ok, action, envelope, transport: false };
}

const CMD = { player: 20, world: 30, story: 100 };
const SUB = {
  player: { create: 2, select: 6 },
  world: { enterMap: 2 },
  story: { list: 1, play: 2, finish: 3, unlock: 4 },
};

/** 取（并可选清空）`(story, unlock)` 推送载荷。 */
function storyUnlocks(clear = false) {
  const out = pushed
    .filter((frame) => frame.cmd === CMD.story && frame.subCmd === SUB.story.unlock)
    .map((frame) => frame.data);
  if (clear) {
    for (let i = pushed.length - 1; i >= 0; i -= 1) {
      if (pushed[i].cmd === CMD.story && pushed[i].subCmd === SUB.story.unlock) pushed.splice(i, 1);
    }
  }
  return out;
}

/** 等到出现某个 key 的解锁推送（避免与 tick 线程的异步推送竞争）。 */
async function waitUnlock(key, timeoutMs = 8000) {
  const started = Date.now();
  for (;;) {
    const hit = storyUnlocks().find((item) => item?.key === key);
    if (hit !== undefined) return hit;
    if (Date.now() - started > timeoutMs) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const username = `story_${suffix}`;
const password = 'smoke-pass-123';

let ws;
try {
  const health = await rest('GET', '/health');
  check('GET /api/health 返回 200（数据库可用）', health.status === 200, `status=${health.status}`);

  const reg = await rest('POST', '/auth/register', { username, password });
  check('注册新账号', reg.body?.success === true);
  const login = await rest('POST', '/auth/login', { username, password });
  const token = login.body?.data?.token;
  if (typeof token !== 'string' || token === '') throw new Error('no token');
  ws = await openWs(token);
  attach(ws);
  check('登录 + WS 连接成功', true);

  const created = await call(ws, CMD.player, SUB.player.create, {
    name: `剧情_${suffix.slice(-6)}`,
    role: 'Eyer',
    career: 'warrior',
  });
  const key = created.action?.data?.key;
  check('player.create 成功', created.ok && typeof key === 'string');
  if (typeof key !== 'string') throw new Error('no character');

  const selected = await call(ws, CMD.player, SUB.player.select, { key });
  check('player.select 成功', selected.ok);
  // 会话落地在 home：story.play 会顺带触发一次推进
  await call(ws, CMD.story, SUB.story.play, { key: 'eyer-stories-1', characterId: key });
  await call(ws, CMD.story, SUB.story.finish, { key: 'eyer-stories-1', characterId: key });

  // 1) 完成剧情 1 后进 town.street → 剧情 2 自动播放
  storyUnlocks(true);
  const enter = await call(ws, CMD.world, SUB.world.enterMap, { map: 'town.street', characterId: key });
  check('world.enterMap town.street 成功', enter.ok, JSON.stringify(enter.action).slice(0, 160));
  const s2 = await waitUnlock('eyer-stories-2');
  check(
    '进 town.street 收到 eyer-stories-2 推送',
    s2 !== undefined,
    JSON.stringify(s2).slice(0, 200),
  );
  check('剧情 2 是纯剧情脚本且 autoPlay=true', s2?.taskType === 'script' && s2?.autoPlay === true);

  // 2) 完成剧情 2 → 剧情 3（击杀任务）被静默登记
  storyUnlocks(true);
  const play2 = await call(ws, CMD.story, SUB.story.play, { key: 'eyer-stories-2', characterId: key });
  check('story.play eyer-stories-2 成功', play2.ok && (play2.action?.data?.nodes?.length ?? 0) > 0);
  const finish2 = await call(ws, CMD.story, SUB.story.finish, { key: 'eyer-stories-2', characterId: key });
  check('story.finish eyer-stories-2 成功', finish2.ok, JSON.stringify(finish2.action).slice(0, 200));
  const s3 = await waitUnlock('eyer-stories-3');
  check('完成剧情 2 后收到 eyer-stories-3 推送', s3 !== undefined, JSON.stringify(s3).slice(0, 200));
  check(
    '剧情 3 是击杀任务且 autoPlay=false（等玩家去打，不弹窗）',
    s3?.taskType === 'kill' && s3?.autoPlay === false,
  );

  // 3) 服务端状态：剧情 3 已登记为 task，剩余 10 只
  const list = await call(ws, CMD.story, SUB.story.list, { characterId: key });
  const rows = list.action?.data ?? [];
  const s3Dto = Array.isArray(rows) ? rows.find((row) => row.key === 'eyer-stories-3') : undefined;
  check(
    'story.list：剧情 3 = 进行中 + 剩余 10 只小史莱姆（已自动登记，无需玩家手动接）',
    s3Dto?.status === 'task' && s3Dto?.taskType === 'kill' && s3Dto?.remaining === 10,
    JSON.stringify(s3Dto).slice(0, 240),
  );
  const s2Dto = Array.isArray(rows) ? rows.find((row) => row.key === 'eyer-stories-2') : undefined;
  check('story.list：剧情 2 = 已完成', s2Dto?.status === 'done');
} catch (error) {
  check('冒烟脚本未抛异常', false, error instanceof Error ? error.message : String(error));
} finally {
  if (ws !== undefined) ws.close();
}

const failed = results.filter((entry) => entry.ok === false);
console.log(`\n进图剧情冒烟：${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
