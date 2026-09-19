/**
 * 开发模式启动器
 *
 * 为什么不用 tsx / esbuild 做开发期执行：
 *   esbuild（tsx 的底层）**不产出 `design:paramtypes` 装饰器元数据**，
 *   而 NestJS 的按类型构造注入、ionet 的「首参是否 FlowContext」判定都依赖它。
 *   实测 tsx 下 `Reflect.getMetadata('design:paramtypes', JwtAuthGuard) === undefined`，
 *   导致 Guard / Action 注入为 undefined。因此开发模式必须走 **tsc 产物**。
 *
 * 行为：先全量编译一次，再并行启动
 *   - `tsc -p tsconfig.json --watch` （增量写 dist）
 *   - `node --watch dist/main.js`    （dist 变化即重启）
 *
 * `.env` 由 `src/main.ts` 的 `import 'dotenv/config'` 加载（dotenv 先于业务模块，
 * 见 main.ts 启动顺序说明），因此本脚本不再重复加载。
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');

const initial = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], {
  cwd: pkgRoot,
  stdio: 'inherit',
  env: process.env,
});
if (initial.status !== 0) {
  process.exit(initial.status ?? 1);
}

const children = [];

function start(label, command, args) {
  const child = spawn(command, args, { cwd: pkgRoot, stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (signal) return;
    console.error(`[${label}] exited with code ${code}`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 300).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('tsc', 'pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput']);
start('server', process.execPath, ['--watch', 'dist/main.js']);
