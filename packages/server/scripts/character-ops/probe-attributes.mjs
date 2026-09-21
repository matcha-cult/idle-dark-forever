/**
 * 实时探针：角色属性面板（`UnitStateDto.attributes` / `exp` / `maxExp`）真的下发了吗？
 *
 * 只读 + 一次 `player.select`（会停掉该账号已有会话，故运行前先看 `world_online_characters`）。
 * 用 `JWT_SECRET` 自签 token（不必知道用户口令）。
 *
 * 运行：cd packages/server && node scripts/character-ops/probe-attributes.mjs <userId> [port]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const userId = Number(process.argv[2] ?? 7);
const port = Number(process.argv[3] ?? 3100);
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && line.trim().startsWith('#') === false)
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);
const token = jwt.sign({ id: userId, username: `probe-${userId}` }, env.JWT_SECRET, { expiresIn: '10m' });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  —— ${detail}`}`);
};

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
const pending = new Map();
const pushed = [];
let seq = 0;

ws.on('message', (raw) => {
  const frame = JSON.parse(raw.toString());
  if (frame.kind === 'notification') {
    pushed.push(frame);
    return;
  }
  const entry = pending.get(frame.reqId);
  if (entry) {
    pending.delete(frame.reqId);
    entry(frame);
  }
});

function call(cmd, subCmd, data, timeoutMs = 8000) {
  const reqId = `p-${++seq}`;
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

const CMD = { player: 20, world: 30 };
const SUB = { playerList: 1, playerSelect: 6, worldSnapshot: 1, worldTick: 5 };

const open = new Promise((resolve, reject) => {
  ws.on('open', resolve);
  ws.on('error', reject);
});
await open;

// 1) 角色列表 → 取第一个角色的 key
const listFrame = await call(CMD.player, SUB.playerList);
const characters = listFrame.data?.data ?? [];
check('player.list 返回角色', Array.isArray(characters) && characters.length > 0, `count=${characters.length}`);
const key = characters[0]?.key;
console.log(`    角色：${characters[0]?.name} key=${key} Lv.${characters[0]?.level}`);

// 2) 选角（= 进入世界，会启动会话）
const selectFrame = await call(CMD.player, SUB.playerSelect, { key });
const state = selectFrame.data?.data;
check('player.select 成功', state !== undefined, `level=${state?.level}`);

// 3) 快照 → 玩家单位的 attributes
const snapFrame = await call(CMD.world, SUB.worldSnapshot);
const snapshot = snapFrame.data?.data;
const units = snapshot?.units ?? [];
const playerUnit = units.find((unit) => unit.kind === 'player');
check('world.snapshot 里有玩家单位', playerUnit !== undefined, `units=${units.length}`);
const attr = playerUnit?.attributes;
check('玩家单位带 attributes', attr !== undefined);
check('敌方单位不带 attributes', units.filter((u) => u.kind !== 'player').every((u) => u.attributes === undefined));
check('exp / maxExp 已下发', Number.isFinite(playerUnit?.exp) && Number.isFinite(playerUnit?.maxExp),
  `exp=${playerUnit?.exp} maxExp=${playerUnit?.maxExp}`);

if (attr !== undefined) {
  console.log('\n  ── 面板实际收到的属性（服务端已换算 + 已取整）──');
  console.log(`  ${playerUnit.name} 等级${playerUnit.level} ${attr.careerName}（等级上限：${attr.maxLevel}）`);
  console.log(`  生命 ${playerUnit.hp}/${playerUnit.maxHp}   怒气 ${playerUnit.rp}/${playerUnit.maxRp}`);
  const rows = Object.entries(attr);
  for (let i = 0; i < rows.length; i += 4) {
    console.log('  ' + rows.slice(i, i + 4).map(([k, v]) => `${k}=${v}`).join('   '));
  }
  console.log('');

  const numbers = Object.entries(attr).filter(([, v]) => typeof v === 'number');
  check('全部数值字段有限（无 NaN / Infinity）', numbers.every(([, v]) => Number.isFinite(v)));
  check('职业名非空', typeof attr.careerName === 'string' && attr.careerName.length > 0, attr.careerName);
  check('等级上限 > 0', attr.maxLevel > 0, String(attr.maxLevel));
  check('攻击力 > 0', attr.atk > 0, String(attr.atk));
  // 「×100 换算」的关键证据：暴击几率是「百分数本身」，应落在 0..100 而不是 0..1。
  check('critRatePct 是百分数本身（0..100，不是 0..1）', attr.critRatePct >= 0 && attr.critRatePct <= 100, String(attr.critRatePct));
  check('暴击伤害是百分数本身（>=100 量级）', attr.critBonusPct >= 100, String(attr.critBonusPct));
  check('全部字段都是 1 位小数或整数（取整在服务端）',
    numbers.every(([, v]) => Number.isInteger(v) || Math.abs(v * 10 - Math.round(v * 10)) < 1e-9));
}

// 4) 等一帧 tick：确认属性走的是同一套 200ms 差分通道
const before = pushed.length;
await new Promise((resolve) => setTimeout(resolve, 3000));
const ticks = pushed.filter((f) => f.cmd === CMD.world && f.subCmd === SUB.worldTick);
check('收到 (world, tick) 推送（属性走同一通道）', ticks.length > 0, `frames=${ticks.length} (等待前 ${before})`);
const withAttr = ticks.filter((f) => (f.data?.patch ?? []).some((op) => op.unit?.attributes !== undefined || op.fields?.attributes !== undefined));
const withLevel = ticks.filter((f) => (f.data?.patch ?? []).some((op) => op.unit?.level !== undefined));
console.log(`    含 attributes 的 add/reset 帧：${withAttr.length}；含 level 的帧：${withLevel.length}`);

const failed = results.filter((r) => r.ok !== true);
console.log(`\n${failed.length === 0 ? 'ALL PASS' : `FAILED ${failed.length}`}  (${results.length} checks)`);
ws.close();
process.exit(failed.length === 0 ? 0 : 1);
