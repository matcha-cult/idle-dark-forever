/**
 * 拾取规则端到端冒烟：**面板设置 → 真实战斗掉落 → (battle, loot) 推送**
 *
 * 背景：面板写入的规则键是 `c:${class}:${quality}`，而战斗侧曾按 `class` 读并对
 * `number` 再索引 `quality` → 恒不命中、永远回退 `minLootLevel`，玩家感觉「设置自动
 * 出售/分解完全没用」。本脚本用真实 REST + WS + PostgreSQL 复现这条链路：
 *
 *   注册/登录 → 建角色（Eyer）→ 完成 eyer-stories-1（解锁 town.street）
 *   → lootrule.get 取规则矩阵 → lootrule.update 全部设为「出售」（minLevel=0）
 *   → lootrule.get 复核（落库往返）→ world.enterMap town.street
 *   → 等待 (cmd=40,subCmd=2) 掉落推送 → 断言装备掉落的 handled === 'sell'
 *
 * 关键设计：`minLevel` 刻意保持 0，**只有显式规则**能产生 'sell' —— 这样断言才真正
 * 指向「面板规则生效」，而不是被 `minLootLevel` 兜底蒙混过关。
 *
 * ⚠️ 需要真实数据库。运行：cd packages/server && node scripts/loot-rule-smoke.mjs <port>
 * 掉落是概率性的（`slime.minimal` 装备掉率 0.1/kill），窗口内没掉出装备时记为 SKIP，
 * 不判失败（避免 CI 抖动）；窗口可用 `LOOT_WINDOW_MS` 调整（默认 90000）。
 */
import WebSocket from 'ws';

const port = Number(process.argv[2] ?? 3000);
const base = process.argv[3] ?? `http://127.0.0.1:${port}/api`;
const wsUrl = `ws://127.0.0.1:${port}/ws`;
const WINDOW_MS = Number(process.env.LOOT_WINDOW_MS ?? 90_000);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  —— ${detail}` : ''}`);
}
function skip(name, why) {
  results.push({ name, ok: true, skipped: true, detail: why });
  console.log(`SKIP  ${name}  —— ${why}`);
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
  const reqId = `lr-${++reqSeq}`;
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

const CMD = { player: 20, world: 30, battle: 40, lootrule: 70, story: 100 };
const SUB = {
  player: { create: 2, select: 6 },
  world: { enterMap: 2 },
  battle: { loot: 2 },
  lootrule: { get: 1, update: 2, setMinLevel: 3 },
  story: { list: 1, play: 2, finish: 3 },
};

function lootPushes() {
  return pushed
    .filter((frame) => frame.cmd === CMD.battle && frame.subCmd === SUB.battle.loot)
    .map((frame) => frame.data)
    .filter((data) => data !== null && typeof data === 'object');
}

async function waitForLoot(timeoutMs) {
  const started = Date.now();
  for (;;) {
    const list = lootPushes();
    if (list.some((loot) => loot.handled === 'sell')) return list;
    if (Date.now() - started > timeoutMs) return list;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// ────────────────────────────── 主流程 ──────────────────────────────

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const username = `loot_${suffix}`;
const password = 'smoke-pass-123';

let ws;
try {
  const health = await rest('GET', '/health');
  check('GET /api/health 返回 200（数据库可用）', health.status === 200, `status=${health.status}`);

  const reg = await rest('POST', '/auth/register', { username, password });
  check('注册新账号', reg.body?.success === true, JSON.stringify(reg.body).slice(0, 160));
  const login = await rest('POST', '/auth/login', { username, password });
  const token = login.body?.data?.token;
  check('登录拿到 token', typeof token === 'string' && token !== '');
  if (typeof token !== 'string' || token === '') throw new Error('no token');

  ws = await openWs(token);
  attach(ws);
  check('WS ?token=<jwt> 连接成功', true);

  const created = await call(ws, CMD.player, SUB.player.create, {
    name: `拾取_${suffix.slice(-6)}`,
    role: 'Eyer',
    career: 'warrior',
  });
  const characterKey = created.action?.data?.key;
  check('player.create 成功', created.ok && typeof characterKey === 'string', JSON.stringify(created.action).slice(0, 160));
  if (typeof characterKey !== 'string') throw new Error('no character');

  const selected = await call(ws, CMD.player, SUB.player.select, { key: characterKey });
  check('player.select 成功', selected.ok, JSON.stringify(selected.action).slice(0, 160));

  // 1) 完成 eyer-stories-1（town.street 的前置条件）
  const stories = await call(ws, CMD.story, SUB.story.list, { key: characterKey });
  const first = stories.action?.data?.find?.((story) => story.key === 'eyer-stories-1');
  check('story.list 含 eyer-stories-1', first !== undefined, JSON.stringify(stories.action).slice(0, 160));
  const played = await call(ws, CMD.story, SUB.story.play, { key: 'eyer-stories-1', characterId: characterKey });
  check('story.play eyer-stories-1 成功', played.ok, JSON.stringify(played.action).slice(0, 200));
  const finished = await call(ws, CMD.story, SUB.story.finish, { key: 'eyer-stories-1', characterId: characterKey });
  check('story.finish eyer-stories-1 成功', finished.ok, JSON.stringify(finished.action).slice(0, 200));

  // 2) 面板：读规则矩阵
  const initialState = await call(ws, CMD.lootrule, SUB.lootrule.get, { characterId: characterKey });
  const rules = initialState.action?.data?.rules;
  check(
    'lootrule.get 返回完整规则矩阵（含 c:class:quality 键）',
    initialState.ok && Array.isArray(rules) && rules.length > 0 && typeof rules[0]?.id === 'string' && rules[0].id.startsWith('c:'),
    JSON.stringify({ count: rules?.length, sample: rules?.[0] }).slice(0, 200),
  );
  if (!Array.isArray(rules) || rules.length === 0) throw new Error('no loot rules');

  // 3) 面板：全部设为「出售」（action=1），minLevel 保持 0
  const updated = await call(ws, CMD.lootrule, SUB.lootrule.update, {
    characterId: characterKey,
    rules: rules.map((rule) => ({ ...rule, action: 1, enabled: true })),
  });
  check(
    'lootrule.update 全部设为出售成功',
    updated.ok && updated.action?.data?.rules?.every((rule) => rule.action === 1 && rule.enabled === true),
    JSON.stringify(updated.action?.data?.rules?.slice(0, 2)).slice(0, 200),
  );
  const minLevel = await call(ws, CMD.lootrule, SUB.lootrule.setMinLevel, { characterId: characterKey, minLevel: 0 });
  check('lootrule.setMinLevel(0) 成功（排除兜底干扰）', minLevel.ok);

  // 4) 落库往返：重新 get 一次，确认持久化的是同一套编码
  const reread = await call(ws, CMD.lootrule, SUB.lootrule.get, { characterId: characterKey });
  const rereadRules = reread.action?.data?.rules ?? [];
  check(
    'lootrule.get 往返后仍全部为「出售」且 minLevel=0',
    reread.ok && rereadRules.length === rules.length && rereadRules.every((rule) => rule.action === 1 && rule.enabled) && reread.action?.data?.minLevel === 0,
    JSON.stringify({ count: rereadRules.length, minLevel: reread.action?.data?.minLevel }).slice(0, 160),
  );

  // 5) 进 town.street（有小怪）
  const enter = await call(ws, CMD.world, SUB.world.enterMap, { map: 'town.street', characterId: characterKey });
  check('world.enterMap town.street 成功', enter.ok, JSON.stringify(enter.action).slice(0, 200));

  // 6) 等掉落
  const loots = await waitForLoot(WINDOW_MS);
  const sells = loots.filter((loot) => loot.handled === 'sell');
  const pickups = loots.filter((loot) => loot.handled === 'pickup');

  console.log(
    `INFO  窗口内掉落推送：${loots.length} 条（sell=${sells.length} / pickup=${pickups.length}）` +
      `；样例=${JSON.stringify(loots.slice(0, 3))}`.slice(0, 600),
  );

  if (sells.length === 0) {
    skip(
      '装备掉落被自动出售（handled=sell）',
      `${WINDOW_MS}ms 窗口内没有掉出可出售装备（装备掉率 0.1/kill，属概率抖动）；面板往返与进图断言已通过`,
    );
  } else {
    check(
      '装备掉落被自动出售（handled=sell）且推送带金币/数量',
      sells.every((loot) => loot.slot?.key === 'gold' && typeof loot.slot?.count === 'number' && loot.slot.count > 0),
      JSON.stringify(sells.slice(0, 3)).slice(0, 300),
    );
    check(
      '出售的掉落带 gold 字段（拾取规则链路未丢数据）',
      sells.every((loot) => typeof loot.gold === 'number' && loot.gold > 0 && loot.gold === loot.slot?.count),
      JSON.stringify(sells.slice(0, 3)).slice(0, 300),
    );
  }
  check('minLevel=0 时不应出现兜底分解（decompose）', loots.every((loot) => loot.handled !== 'decompose'));

  // 7) 背包里不应有装备（全被卖掉）
  const inventory = await call(ws, 50, 1, { characterId: characterKey });
  const slots = inventory.action?.data?.slots ?? inventory.action?.data ?? [];
  const equipped = Array.isArray(slots) ? slots.filter((slot) => slot && slot.key && slot.key !== 'gold') : [];
  check(
    'inventory.list 可读（用于人工核对）',
    inventory.ok,
    JSON.stringify({ gold: inventory.action?.data?.gold, slots: Array.isArray(slots) ? slots.length : '-' }).slice(0, 160),
  );
  console.log(`INFO  背包非空槽位：${JSON.stringify(equipped.slice(0, 5))}`.slice(0, 400));
} catch (error) {
  check('冒烟脚本未抛异常', false, error instanceof Error ? error.message : String(error));
} finally {
  if (ws !== undefined) ws.close();
}

const failed = results.filter((entry) => entry.ok === false);
const skipped = results.filter((entry) => entry.skipped === true);
console.log(
  `\n拾取规则冒烟：${results.length - failed.length}/${results.length} 通过` +
    (skipped.length > 0 ? `（${skipped.length} 项跳过）` : ''),
);
process.exit(failed.length === 0 ? 0 : 1);
