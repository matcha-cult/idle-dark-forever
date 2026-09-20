/**
 * 路由探针：确认 Wave 2 的各域 Action **已注册且可达**（不是 404）。
 *
 * 不依赖数据库：DB 不可达时这些 Action 会返回业务失败（INTERNAL）或传输错误，
 * 而**未注册**才返回 404 —— 探针只判定「是否 404」。
 *
 * 运行：cd packages/server && node tmp/route-probe.mjs <port> <jwtSecret>
 */
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';

const port = Number(process.argv[2] ?? 3000);
const secret = process.argv[3] ?? 'dev-secret-change-me';

const ROUTES = [
  [1, 1, 'system.ping'],
  [1, 2, 'system.version'],
  [10, 3, 'auth.me'],
  [20, 1, 'player.list'],
  [20, 6, 'player.select'],
  [20, 5, 'player.exportSave'],
  [30, 1, 'world.snapshot'],
  [30, 2, 'world.enterMap'],
  [30, 3, 'world.leave'],
  [30, 4, 'world.skipOffline'],
  [40, 3, 'battle.focus'],
  [50, 1, 'inventory.list'],
  [50, 6, 'inventory.sort'],
  [60, 1, 'bank.list'],
  [70, 1, 'lootrule.get'],
  [80, 1, 'career.list'],
  [90, 1, 'produce.enchantCosts'],
  [110, 1, 'shop.state'],
  [120, 1, 'idle.report'],
  [130, 1, 'map.list'],
  [130, 2, 'map.snapshot'],
  [130, 3, 'map.enter'],
  [130, 4, 'map.leave'],
  [140, 1, 'dungeon.queueGet'],
  [140, 2, 'dungeon.queueSet'],
  [140, 3, 'dungeon.queueAdd'],
  [140, 4, 'dungeon.queueRemove'],
  [140, 5, 'dungeon.queueClear'],
  [140, 6, 'dungeon.enter'],
  [140, 7, 'dungeon.leave'],
  [140, 8, 'dungeon.reset'],
];

const token = jwt.sign({ id: 42, username: 'route-probe' }, secret, { expiresIn: 60 });
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);

const results = [];
await new Promise((resolve, reject) => {
  ws.on('error', reject);
  ws.on('open', () => {
    let index = 0;
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.kind === 'notification') return;
      const [cmd, subCmd, name] = ROUTES[index];
      const registered = frame.errorCode !== 404;
      const outcome =
        frame.errorCode !== undefined && frame.errorCode !== 0
          ? `transport:${frame.errorCode}`
          : frame.data?.success === false
            ? `business:${frame.data?.data?.code}`
            : 'ok';
      results.push({ name, route: `(${cmd},${subCmd})`, registered, outcome });
      index += 1;
      if (index < ROUTES.length) {
        const next = ROUTES[index];
        ws.send(JSON.stringify({ cmd: next[0], subCmd: next[1], reqId: `p-${index}` }));
      } else {
        resolve();
      }
    });
    ws.send(JSON.stringify({ cmd: ROUTES[0][0], subCmd: ROUTES[0][1], reqId: 'p-0' }));
  });
});
ws.close();

let missing = 0;
for (const r of results) {
  if (!r.registered) missing += 1;
  console.log(`${r.registered ? 'OK  ' : '404 '} ${r.name.padEnd(24)} ${r.route.padEnd(9)} → ${r.outcome}`);
}
console.log(`\n已注册 ${results.length - missing}/${results.length}`);
process.exit(missing > 0 ? 1 : 0);
