/** 从 live 服务器取一个 WorldSnapshotDto，量 units 的 JSON 字节数（tick 帧的主要成本） */
import WebSocket from 'ws';
const base = 'http://127.0.0.1:3100/api';
const u = `fs_${Date.now().toString(36)}`, pw = 'smoke-pass-123';
const reg = await (await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) })).json();
if (reg?.success !== true) { console.log('register failed', JSON.stringify(reg).slice(0,100)); process.exit(1); }
const login = await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: pw }) })).json();
const token = login?.data?.token;
const ws = new WebSocket(`ws://127.0.0.1:3100/ws?token=${encodeURIComponent(token)}`);
let seq = 0; const pending = new Map(); const tickSizes = [];
ws.on('message', (raw) => {
  const text = raw.toString();
  let f; try { f = JSON.parse(text); } catch { return; }
  if (f.kind === 'notification' && f.cmd === 30 && f.subCmd === 5) { tickSizes.push(text.length); return; }
  const e = pending.get(f.reqId); if (e) { pending.delete(f.reqId); e(f); }
});
const call = (cmd, subCmd, data) => new Promise((res) => { const reqId = `f-${++seq}`; pending.set(reqId, res); ws.send(JSON.stringify({ cmd, subCmd, reqId, ...(data?{data}:{}) })); });
await new Promise((r) => ws.on('open', r));
const created = await call(20, 2, { name: `帧_${u.slice(-4)}`, role: 'Eyer', career: 'warrior' });
const key = created?.data?.data?.key;
await call(20, 6, { key });
await call(100, 2, { key: 'eyer-stories-1', characterId: key });
await call(100, 3, { key: 'eyer-stories-1', characterId: key });
const enter = await call(30, 2, { map: 'town.street', characterId: key });
const snapUnits = enter?.data?.data?.units ?? [];
await new Promise((r) => setTimeout(r, 12000));
const unitsBytes = JSON.stringify(snapUnits).length;
const n = tickSizes.length;
const avgTick = n > 0 ? Math.round(tickSizes.reduce((a, b) => a + b, 0) / n) : 0;
console.log(JSON.stringify({
  units: snapUnits.length, unitsBytes,
  ticksSeen: n, avgTickBytes: avgTick, maxTickBytes: n > 0 ? Math.max(...tickSizes) : 0,
  perPlayerKBps: +((avgTick * 5) / 1024).toFixed(1),
  for5000_MBps: +((avgTick * 5 * 5000) / 1048576).toFixed(1),
}, null, 0));
ws.close(); process.exit(0);
