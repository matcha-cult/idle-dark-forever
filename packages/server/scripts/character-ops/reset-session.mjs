/** 只做一次 WS 握手（不带 player.select）：握手成功即触发服务端 resetActiveCharacter，停掉旧会话。 */
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
const port = process.argv[2] ?? '3100';
const secret = process.argv[3];
const userId = Number(process.argv[4] ?? 7);
const token = jwt.sign({ id: userId, username: 'nbb01' }, secret, { expiresIn: 60 });
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
console.log('握手成功 → 旧会话已被 reset');
await new Promise((r) => setTimeout(r, 1500));
ws.close();
await new Promise((r) => setTimeout(r, 500));
process.exit(0);
