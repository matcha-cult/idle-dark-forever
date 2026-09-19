/**
 * 指标冒烟（07 T-A1）
 *
 * 断言：
 * 1. `GET /api/metrics` = 200，字段齐全且**全部为有限数**（无 null / NaN / Infinity）；
 * 2. 空闲（无会话）时 `world_time_ratio == 1`（无样本定义）；
 * 3. `world_truncated_ms_total == 0`（I2/I3：正常不得截断）；
 * 4. 连续两次采样，累计计数**单调不回退**。
 *
 * 运行：cd packages/server && node scripts/metrics-smoke.mjs [port]
 * 需要服务端已启动（先 `pnpm run build`）。
 */
const port = Number(process.argv[2] ?? 3100);
const base = `http://127.0.0.1:${port}`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  —— ${detail}`}`);
}

const REQUIRED = [
  'world_tick_round_duration_ms',
  'world_tick_round_chars_processed',
  'world_online_characters',
  'world_sessions_total',
  'world_time_ratio',
  'world_time_ratio_min',
  'world_time_ratio_p50',
  'world_callback_used_per_round',
  'world_callback_budget',
  'world_rounds_total',
  'world_rounds_cut_off_total',
  'world_truncated_ms_total',
  'session_reaped_total',
  'context_loaded',
];

async function sample() {
  const res = await fetch(`${base}/api/metrics`);
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

const first = await sample();
check('GET /api/metrics 返回 200', first.status === 200, `status=${first.status}`);
check('响应含 service=idle-dark-forever', first.json.service === 'idle-dark-forever', first.json.service);

const metrics = first.json.metrics ?? {};
const missing = REQUIRED.filter((key) => typeof metrics[key] !== 'number');
check('指标字段齐全且为 number', missing.length === 0, missing.length ? `缺失/非数字: ${missing.join(',')}` : `${Object.keys(metrics).length} 项`);

const nonFinite = Object.entries(metrics).filter(([, value]) => !Number.isFinite(value));
check('全部指标为有限数（无 NaN/Infinity）', nonFinite.length === 0, nonFinite.map(([k]) => k).join(',') || 'ok');

check('JSON 中不含 null（NaN 序列化为 null 的陷阱）', !first.text.includes('null'));

check('空闲时 world_time_ratio == 1', metrics.world_time_ratio === 1, `ratio=${metrics.world_time_ratio}`);
check('world_truncated_ms_total == 0（不静默截断）', metrics.world_truncated_ms_total === 0, `truncated=${metrics.world_truncated_ms_total}`);
check('world_callback_budget > 0', metrics.world_callback_budget > 0, `budget=${metrics.world_callback_budget}`);

await new Promise((resolve) => setTimeout(resolve, 1500));
const second = await sample();
const later = second.json.metrics ?? {};
const regressed = Object.keys(later).filter(
  (key) => key.includes('_total') && typeof metrics[key] === 'number' && later[key] < metrics[key],
);
check('累计计数单调不回退（*_total）', regressed.length === 0, regressed.join(',') || 'ok');

const passed = results.filter((r) => r.ok).length;
console.log(`\n指标冒烟：${passed}/${results.length} 通过`);
process.exit(passed === results.length ? 0 : 1);
