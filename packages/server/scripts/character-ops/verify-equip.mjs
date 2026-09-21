/** 端到端校验：真实服务器上，1 级角色能否装备这柄测试武器（含对照组）。 */
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';

const port = process.argv[2] ?? '3100';
const secret = process.argv[3];
const userId = Number(process.argv[4] ?? 7);
const characterKey = process.argv[5] ?? '3504fecf-a635-436b-ae19-ecbd81f1c5e4';

const token = jwt.sign({ id: userId, username: 'nbb01' }, secret, { expiresIn: 120 });
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });

let seq = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const f = JSON.parse(raw.toString());
  const e = f.reqId !== undefined ? pending.get(f.reqId) : undefined;
  if (e) { pending.delete(f.reqId); e(f); }
});
const call = (cmd, subCmd, data) => {
  const reqId = `e-${++seq}`;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(reqId); reject(new Error(`超时 ${cmd}/${subCmd}`)); }, 8000);
    pending.set(reqId, (f) => { clearTimeout(t); resolve(f.data); });
    ws.send(JSON.stringify({ cmd, subCmd, reqId, ...(data === undefined ? {} : { data }) }));
  });
};
const keysOf = (action) => (Array.isArray(action?.data) ? action.data.filter((s) => s?.key).map((s) => s.key) : []);
const idOf = (action, key) => (Array.isArray(action?.data) ? action.data.find((s) => s?.key === key)?.id : undefined);

const state = await call(20, 6, { key: characterKey });
const inv = state?.data?.inventory ?? [];
console.log('角色等级                :', state?.data?.level);
console.log('背包中的 1 级测试武器   :', inv.find((s) => s?.key === 'copperSword')?.id ?? '(缺失)');
console.log('背包中的 100 级测试武器 :', inv.find((s) => s?.key === 'mithrilCopperSword')?.id ?? '(缺失)');
const bagKeys = (action) => '背包=' + JSON.stringify(keysOf(action));

// 1) 1 级武器：应当成功（成功后原本的细木剑应回到背包 = 真的换上了）
const eq1 = await call(50, 2, { id: inv.find((s) => s?.key === 'copperSword')?.id });
console.log('\n[装备 铜剑 Lv.1 ]        success =', eq1?.success, '|', bagKeys(eq1), eq1?.success ? '' : JSON.stringify(eq1?.data));

// 2) 对照组：100 级武器应当被「等级不足」挡住
const lv100Id = inv.find((s) => s?.key === 'mithrilCopperSword')?.id;
const eq2 = await call(50, 2, { id: lv100Id });
console.log('[装备 秘银青铜剑 Lv.100]  success =', eq2?.success, '| 错误 =', eq2?.success ? '-' : JSON.stringify(eq2?.data));

// 3) 还原：装回细木剑（铜剑应回到背包）
const eq3 = await call(50, 2, { id: idOf(eq1, 'stickSword') });
console.log('[还原 细木剑]            success =', eq3?.success, '|', bagKeys(eq3));

const finalList = await call(50, 1, {});
console.log('\n最终背包（有物品的格）  :', JSON.stringify(keysOf(finalList)));
ws.close();
await new Promise((r) => setTimeout(r, 300));
process.exit(0);
