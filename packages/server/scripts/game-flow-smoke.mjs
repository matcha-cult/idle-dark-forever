/**
 * Wave 2 端到端验收：真实 REST + WS + 数据库 的完整游戏流程。
 *
 * 覆盖 `ai-docs/02-wave2-任务书.md` 附录 A 的载荷契约与验收门禁：
 *   注册 → 登录 → REST /auth/me → WS 连接 → player.list/create/select
 *   → world.snapshot/enterMap → 收到 world.tick 推送 → inventory.list
 *   → player.exportSave / importSave 往返 → 业务失败的两级判定
 *
 * ⚠️ **需要真实数据库**（users / account_state / characters 表）。
 * 沙箱内没有 PostgreSQL 服务端（见 AGENTS.md §7.7），因此本脚本在 CI 跑：
 * `.github/workflows/ci.yml` 已声明 `services: postgres` 并执行 `db:init` 后再调用本脚本。
 *
 * 运行：cd packages/server && node scripts/game-flow-smoke.mjs <port> [baseUrl]
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
function skip(name, why) {
  results.push({ name, ok: true, skipped: true, detail: why });
  console.log(`SKIP  ${name}  —— ${why}`);
}

// ────────────────────────────── REST ──────────────────────────────

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

// ────────────────────────────── WS ──────────────────────────────

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

/** 发一个 Action 请求，返回响应信封（含 reqId/kind）。 */
function callEnvelope(ws, cmd, subCmd, data, timeoutMs = 8000) {
  const reqId = `g-${++reqSeq}`;
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

/**
 * 调 Action 并断言**两级错误判定**：返回 `{ ok, action, envelope }`。
 * `action` 是响应信封 `data` 里的 `ActionResult`。
 */
async function call(ws, cmd, subCmd, data, timeoutMs) {
  const envelope = await callEnvelope(ws, cmd, subCmd, data, timeoutMs);
  if (envelope.errorCode !== undefined && envelope.errorCode !== 0) {
    return { ok: false, transport: true, errorCode: envelope.errorCode, errorMessage: envelope.errorMessage, envelope };
  }
  const action = envelope.data;
  const ok = action !== null && typeof action === 'object' && action.success === true;
  return { ok, action, envelope, transport: false };
}

function waitPush(predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const found = pushed.find(predicate);
    if (found !== undefined) {
      resolve(found);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      const hit = pushed.find(predicate);
      if (hit !== undefined) {
        clearInterval(timer);
        resolve(hit);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('等待推送超时'));
      }
    }, 50);
  });
}

// ────────────────────────────── 主流程 ──────────────────────────────

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const username = `smoke_${suffix}`;
const password = 'smoke-pass-123';

let ws;
try {
  // 0) 健康检查（有库时应为 200）
  const health = await rest('GET', '/health');
  check('GET /api/health 返回 200（数据库可用）', health.status === 200, `status=${health.status} body=${JSON.stringify(health.body).slice(0, 160)}`);

  // 1) 注册 + 登录（REST）
  const reg = await rest('POST', '/auth/register', { username, password });
  const regAction = reg.body;
  const registered = regAction?.success === true || regAction?.data?.code === 'PLAYER_NAME_TAKEN';
  check('POST /api/auth/register 返回 ActionResult', regAction?.success === true || regAction?.success === false, `success=${regAction?.success} code=${regAction?.data?.code ?? '-'}`);

  const login = await rest('POST', '/auth/login', { username, password });
  const loginAction = login.body;
  check('POST /api/auth/login 返回 ActionResult<LoginResponseDto>', loginAction?.success === true && typeof loginAction?.data?.token === 'string', `success=${loginAction?.success} code=${loginAction?.data?.code ?? '-'}`);
  const token = loginAction?.data?.token;
  if (typeof token !== 'string' || token === '') {
    check('登录拿到 token（后续用例的前置）', false, '没有 token，后续无法继续');
    throw new Error('no token');
  }
  check('登录返回 expiresAt / userId / displayName', typeof loginAction.data.expiresAt === 'number' && loginAction.data.userId !== undefined && typeof loginAction.data.displayName === 'string', JSON.stringify({ expiresAt: loginAction.data.expiresAt, userId: loginAction.data.userId }));

  // 2) REST /auth/me
  const me = await rest('GET', '/auth/me', undefined, token);
  check('GET /api/auth/me 用 Bearer token 返回 ActionResult<MeDto>', me.body?.success === true && me.body?.data?.userId !== undefined, `status=${me.status} success=${me.body?.success}`);

  // 3) WS 连接
  ws = await openWs(token);
  attach(ws);
  check('WS ?token=<jwt> 连接成功', true);

  // 4) 拒绝无 token 的 WS（回归）
  const anonRejected = await new Promise((resolve) => {
    const bad = new WebSocket(wsUrl);
    bad.on('open', () => {
      bad.close();
      resolve(false);
    });
    bad.on('error', () => resolve(true));
  });
  check('无 token 的 WS 握手仍被 401 拒绝', anonRejected);

  // 5) player.list（空数组契约）
  const before = await call(ws, 20, 1, {});
  check('player.list 返回 ActionResult<PlayerMetaDto[]>（数组）', before.ok && Array.isArray(before.action.data), JSON.stringify(before.action?.data).slice(0, 160));

  // 6) player.create（单个对象契约）
  const created = await call(ws, 20, 2, { name: `永夜_${suffix.slice(-6)}`, role: 'Eyer', career: 'warrior' });
  const meta = created.action?.data;
  check('player.create 返回 ActionResult<PlayerMetaDto>（单对象，非 {player}）', created.ok && meta !== null && typeof meta === 'object' && typeof meta.key === 'string' && !Array.isArray(meta), JSON.stringify(meta).slice(0, 200));

  const characterKey = meta?.key;
  if (typeof characterKey !== 'string') {
    skip('player.select / world / inventory（无 characterKey）', 'player.create 未返回 key');
  } else {
    // 7) player.select（PlayerStateDto）
    const selected = await call(ws, 20, 6, { key: characterKey });
    const state = selected.action?.data;
    check('player.select 返回 ActionResult<PlayerStateDto>', selected.ok && state !== null && typeof state === 'object' && Array.isArray(state.inventory) && typeof state.gold === 'number', JSON.stringify({ gold: state?.gold, inv: state?.inventory?.length, map: state?.map }));

    // 8) world.snapshot / enterMap
    const snap = await call(ws, 30, 1, {});
    check('world.snapshot 返回 ActionResult<WorldSnapshotDto>', snap.ok && snap.action?.data !== undefined, JSON.stringify(snap.action?.data).slice(0, 160));

    const enter = await call(ws, 30, 2, { map: state?.map ?? 'home' });
    check('world.enterMap 返回 ActionResult<WorldSnapshotDto>', enter.ok && enter.action?.data !== undefined, JSON.stringify(enter.action).slice(0, 200));

    // 9) world.tick 推送（**核心验收**）
    try {
      const tick = await waitPush((f) => f.cmd === 30 && f.subCmd === 5, 12_000);
      const tickData = tick.data;
      check('收到 world.tick 推送（cmd=30, subCmd=5）且含 units/events/serverTime', Array.isArray(tickData?.units) && Array.isArray(tickData?.events) && typeof tickData?.serverTime === 'number', JSON.stringify({ units: tickData?.units?.length, events: tickData?.events?.length, serverTime: tickData?.serverTime }));
      check('推送帧带 kind=notification', tick.kind === 'notification');
    } catch (error) {
      check('收到 world.tick 推送（cmd=30, subCmd=5）', false, error.message);
    }

    // 10) inventory.list（扁平数组契约）
    const inv = await call(ws, 50, 1, {});
    check('inventory.list 返回 ActionResult<InventorySlotDto[]>（扁平数组）', inv.ok && Array.isArray(inv.action?.data), JSON.stringify(inv.action).slice(0, 200));

    // 11) career.list（CareerPanelDto）
    const career = await call(ws, 80, 1, {});
    const panel = career.action?.data;
    check('career.list 返回 ActionResult<CareerPanelDto>（含 maxSkillCount/maxEnhanceCount）', career.ok && Array.isArray(panel?.careers) && typeof panel?.maxSkillCount === 'number', JSON.stringify({ careers: panel?.careers?.length, maxSkill: panel?.maxSkillCount }).slice(0, 160));

    // 12) 存档导出 / 导入往返
    const exported = await call(ws, 20, 5, { key: characterKey });
    const saveText = exported.action?.data?.save ?? exported.action?.data;
    check('player.exportSave 返回可下载存档', exported.ok && typeof saveText === 'string' && saveText.length > 0, typeof saveText === 'string' ? `len=${saveText.length} head=${saveText.slice(0, 8)}` : JSON.stringify(exported.action).slice(0, 160));

    if (typeof saveText === 'string' && saveText.length > 0) {
      const imported = await call(ws, 20, 4, { save: saveText, name: `导入_${suffix.slice(-6)}`, opId: `imp-${suffix}` });
      check('player.importSave 能导入自己导出的存档', imported.ok, JSON.stringify(imported.action).slice(0, 200));

      // 幂等：同 opId 重复提交必须被拒或回放（不得重复创建）
      const dup = await call(ws, 20, 4, { save: saveText, name: `导入2_${suffix.slice(-6)}`, opId: `imp-${suffix}` });
      const dupCode = dup.action?.data?.code;
      check('player.importSave 同 opId 重复提交被去重（DUPLICATE_OPERATION 或回放同一结果）', dup.ok || dupCode === 'DUPLICATE_OPERATION', `success=${dup.action?.success} code=${dupCode ?? '-'}`);
    }

    // 13) 业务失败的两级判定：不存在的角色
    const missing = await call(ws, 20, 6, { key: 'not-a-real-character-key' });
    check('业务失败为 errorCode=0 + data.success=false + data.data.code', missing.transport === false && missing.action?.success === false && typeof missing.action?.data?.code === 'string', JSON.stringify(missing.action).slice(0, 160));
  }

  // 14) 参数校验边界
  const badParam = await call(ws, 20, 2, { name: '' });
  check('player.create 空角色名返回业务失败（INVALID_PARAM）', badParam.action?.success === false && badParam.action?.data?.code === 'INVALID_PARAM', JSON.stringify(badParam.action).slice(0, 160));
} catch (error) {
  check('主流程未抛未捕获异常', false, error instanceof Error ? error.message : String(error));
} finally {
  if (ws !== undefined) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
}

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped === true);
console.log(`\n${results.length - failed.length - skipped.length}/${results.length - skipped.length} 通过（跳过 ${skipped.length}）`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}  ${f.detail ?? ''}`);
  process.exit(1);
}
process.exit(0);
