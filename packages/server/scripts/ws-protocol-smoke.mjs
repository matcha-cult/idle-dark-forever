/**
 * 端到端冒烟：验证 ionet-ts 线协议在真实 NestJS 服务端上可用。
 *
 * 覆盖 PROTOCOL.md：
 *  §1 连接 /ws    §3 请求信封    §4/§4.1 响应信封与 reqId 配对
 *  §6 握手鉴权（无 token → 401；?token=<jwt> → 升级成功）   §8 错误语义   §12.1 旧协议兼容
 *
 * 运行：cd packages/server && node tmp/ws-smoke.mjs <port> <jwtSecret>
 */
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';

const port = Number(process.argv[2] ?? 3999);
const secret = process.argv[3] ?? process.env.JWT_SECRET ?? 'dev-secret-change-me';
const url = `ws://127.0.0.1:${port}/ws`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —— ${detail}` : ''}`);
}

/** 期望握手被拒（HTTP 401）。 */
function openExpect401(query = '') {
  return new Promise((resolve) => {
    const ws = new WebSocket(url + query);
    ws.on('open', () => {
      ws.close();
      resolve({ rejected: false });
    });
    ws.on('error', (err) => resolve({ rejected: true, message: err.message }));
  });
}

function open(query = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url + query);
    const timer = setTimeout(() => reject(new Error('连接超时')), 5000);
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

function send(ws, frame) {
  ws.send(JSON.stringify(frame));
}

function waitFrame(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('等待帧超时'));
    }, timeoutMs);
    const onMessage = (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!predicate(frame)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(frame);
    };
    ws.on('message', onMessage);
  });
}

// ---------- §6 握手鉴权 ----------
const noToken = await openExpect401();
check('§6 无 token 的握手被 HTTP 401 拒绝', noToken.rejected, noToken.message);

const wrongToken = jwt.sign({ id: 42, username: 'smoke' }, 'wrong-secret');
const wrongSig = await openExpect401(`?token=${encodeURIComponent(wrongToken)}`);
check('§6 错签名的 token 同样被 401 拒绝', wrongSig.rejected, wrongSig.message);

const token = jwt.sign({ id: 42, username: 'smoke' }, secret, { expiresIn: 60 });
const ws = await open(`?token=${encodeURIComponent(token)}`);
check('§6 ?token=<jwt> 握手成功（升级未被拒）', true);

// ---------- §3/§4/§4.1 ----------
const p1 = waitFrame(ws, (f) => f.reqId === 'r-1');
send(ws, { cmd: 1, subCmd: 1, reqId: 'r-1' });
const res1 = await p1;
check(
  '§4.1 reqId 精确配对：响应回显 reqId 且 kind=response',
  res1.reqId === 'r-1' && res1.kind === 'response',
  JSON.stringify(res1),
);
check('§4 响应不回显 cmd/subCmd', res1.cmd === undefined && res1.subCmd === undefined);
check(
  '§8 成功响应 errorCode 缺失或为 0',
  res1.errorCode === undefined || res1.errorCode === 0,
  `errorCode=${res1.errorCode}`,
);

// ---------- §8 错误语义 ----------
const p2 = waitFrame(ws, (f) => f.reqId === 'r-2');
send(ws, { cmd: 999, subCmd: 9, reqId: 'r-2' });
const res2 = await p2;
check('§8 未注册 Action → errorCode=404', res2.errorCode === 404, JSON.stringify(res2));

const p3 = waitFrame(ws, (f) => f.errorCode === 400);
ws.send('这不是 JSON');
const res3 = await p3;
check('§8 坏帧 → errorCode=400', res3.errorCode === 400);

// ---------- §12.1 旧协议兼容红线 ----------
const p4 = waitFrame(ws, (f) => f.data !== undefined && f.reqId === undefined && f.errorCode === undefined);
send(ws, { cmd: 1, subCmd: 1 });
const res4 = await p4;
check('§12.1 旧协议响应不注入 reqId/kind', res4.reqId === undefined && res4.kind === undefined, JSON.stringify(res4));

// ---------- §4.1 并发在途 ----------
const pa = waitFrame(ws, (f) => f.reqId === 'r-a');
const pb = waitFrame(ws, (f) => f.reqId === 'r-b');
send(ws, { cmd: 999, subCmd: 1, reqId: 'r-a' });
send(ws, { cmd: 1, subCmd: 1, reqId: 'r-b' });
const [ra, rb] = await Promise.all([pa, pb]);
check('§4.1 并发在途请求各自精确配对', ra.errorCode === 404 && (rb.errorCode === undefined || rb.errorCode === 0));

// ---------- 业务约定：ActionResult + 两级错误判定（本工程硬契约） ----------
// system.ping 必须遵循 `ActionResult<T>`：信封 data = { success:true, data:{...} }
check(
  '约定 ActionResult：system.ping 的 data 为 { success:true, data:{...} }',
  res1.data !== undefined &&
    res1.data.success === true &&
    typeof res1.data.data === 'object' &&
    res1.data.data !== null,
  JSON.stringify(res1.data),
);
check(
  '约定 serverTime：时钟对齐字段名固定为 serverTime（extractServerTime 只认它）',
  typeof res1.data?.data?.serverTime === 'number',
  `serverTime=${res1.data?.data?.serverTime}`,
);

// system.version 同样遵循 ActionResult，且带 protocolVersion
const pv = waitFrame(ws, (f) => f.reqId === 'r-ver');
send(ws, { cmd: 1, subCmd: 2, reqId: 'r-ver' });
const resVer = await pv;
check(
  '约定 ActionResult：system.version 含 protocolVersion / serverTime / wsPath',
  resVer.data?.success === true &&
    typeof resVer.data?.data?.protocolVersion === 'number' &&
    typeof resVer.data?.data?.serverTime === 'number' &&
    resVer.data?.data?.wsPath === '/ws',
  JSON.stringify(resVer.data),
);

// ---------- 鉴权已生效 + 业务失败走 data.success=false（而非裸 500） ----------
const p6 = waitFrame(ws, (f) => f.reqId === 'r-me');
send(ws, { cmd: 10, subCmd: 3, reqId: 'r-me' });
const res6 = await p6;
check(
  '鉴权链路：带 token 时 auth.me 已进入业务层（非 401/404）',
  res6.errorCode !== 401 && res6.errorCode !== 404,
  JSON.stringify(res6),
);
check(
  '两级错误判定：业务失败为 errorCode=0 + data.success=false + data.data.code',
  res6.errorCode === undefined &&
    res6.data?.success === false &&
    typeof res6.data?.data?.code === 'string',
  JSON.stringify(res6.data),
);

ws.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
process.exit(0);
