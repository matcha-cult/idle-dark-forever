# AGENTS.md —— idle-dark-forever 工程约定

> 面向在本仓库工作的 AI 代理与工程师。**新增环境坑或约定时在此追加一节，不要删旧节。**

`idle-dark-forever` 是《永夜2016典藏重置版》（纯前端单机游戏，源仓库 `/home/nbb/projects/dark-forever-memorize`）
的**服务端权威重制版**：ionet-ts + NestJS 后端，React + Vite + Antd + MobX 前端。

设计与拆解见 [`ai-docs/00-重写总方案.md`](ai-docs/00-重写总方案.md)，
结构与接续点见 [`ai-docs/01-架构与接续指南.md`](ai-docs/01-架构与接续指南.md)，
后续任务书见 [`ai-docs/02-wave2-任务书.md`](ai-docs/02-wave2-任务书.md)，
交付状态见 [`ai-docs/04-交付状态与验收.md`](ai-docs/04-交付状态与验收.md)，
**未竟事宜（接续前先读这个）见 [`ai-docs/05-交接-未竟事宜.md`](ai-docs/05-交接-未竟事宜.md)**。

---

## 1. 硬约束（违反即不合格）

1. **提交信息禁止 `Co-Authored-By` 签名**（含 Claude/agent 默认模板）。只写提交信息本身。
2. **代码改动后必须通过**：`pnpm run build` 与 `pnpm run typecheck`，并在交付里报告结果。
   构建有严格的拓扑顺序（见 §3），根 `build` 脚本已固化。
3. **业务代码改动必须同步补单测**，且**必须覆盖边界**：undefined / null / NaN / Infinity / 负数 / 0 /
   空数组 / 超大值 / 精度边界 / 错误路径。不得只测 happy path。
4. **工作量预估禁止任何时间单位**（天/小时/人日/周/分钟…）。改用：规模（文件数与行数量级）、
   测试与门禁、依赖顺序、风险与未知。需要排序时用「小/中/大 + 依据」。
5. **禁止裸 `Math.random()` 与裸 `Date.now()`**（`game-core` 全包）：随机走 `Rng` 端口，
   时间走 `Clock` 端口或注入参数。这是离线结算可审计、单测可稳定、金样回归可对比的前提。
6. **禁止前端做数值推导**：服务端权威。前端只发"意图"、只渲染服务端下发的 DTO。

## 2. 依赖方向（单向，禁止反向）

```
web → ionet-transport → protocol
web → ui-kit              （ui-kit 只允许 import type @idle-dark/protocol 的类型）
server → game-core → protocol
server → protocol
```

- `game-core`：不得 import MobX / React / DOM / 业务相关的 Node 内置。
- `ui-kit`：不得 import 任何业务包 / store / 传输层（`packages/ui-kit/src/hygiene.test.ts` 门禁强制）。
- `web`：不得 import 除 `@nbb-ionet/client-protocol` 之外的任何 `@nbb-ionet/*`
  —— 框架其余包依赖 Node `async_hooks`，浏览器加载即炸。

## 3. 构建与验证

```bash
pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false

pnpm run build       # 显式拓扑：protocol → game-core → transport → ui-kit → server → web
pnpm run typecheck   # ⚠️ 需先 build（下游包从 dist 解析 @idle-dark/protocol）
pnpm run test        # 仅本仓 packages/*，不含 vendor
```

- 单包：`pnpm --filter <name> run build|typecheck|test`
- `server` 依赖 `game-core`/`protocol` 的 **dist**，所以**改了上游必须先 rebuild 上游**。

## 4. 冻结契约（并行开发期间只许加可选字段）

| 契约 | 位置 |
|---|---|
| 线协议 cmd 段 / DTO / 结果约定 / 错误码 | `packages/protocol/src/**` |
| 时间·随机·战斗事件端口 | `packages/game-core/src/contracts/ports.ts` |
| 数据表类型 | `packages/game-core/src/contracts/data.ts` |
| `game-core` 导出面 | `packages/game-core/src/index.ts` |

**前端不再手工镜像 cmd 常量**（这是相对参考实现 `idle-path-of-xiuxian` 的改进）：
`@idle-dark/ionet-transport` 直接依赖 `@idle-dark/protocol`。

## 5. 线协议要点（唯一规格：ionet-ts `PROTOCOL.md`）

| 项 | 值 |
|---|---|
| 请求 | `{ cmd, subCmd, data?, headers?, traceId?, reqId? }` |
| 响应 | `{ data?, errorCode?, errorMessage?, reqId?, kind? }`（**不回显 cmd/subCmd**） |
| 推送 | `{ kind:'notification', type?, cmd?, subCmd?, data?, timestamp? }` |
| 错误码 | `0/undefined` 成功、`400` 解析失败、`404` 路由不存在、`500` 内部异常 |
| 鉴权 | WS **握手期** `authenticate` → `{userId: bigint}`；浏览器不能设头 → `?token=<jwt>`；失败 401 |
| 心跳 | WS 协议层 ping 浏览器不可见 → 客户端用应用层 `system.ping`（15s） |

### 5.1 两级错误判定（**硬契约**）
1. 响应 `errorCode !== 0` → **传输错误**
2. `errorCode === 0` 但 `data.success === false` → **业务错误**（业务码在 `data.data.code`）
3. 其余 → 成功

> ⚠️ **只判 `errorCode` 会把全部业务失败当成成功。**

### 5.2 框架已知坑与规避
| 坑 | 规避 |
|---|---|
| HTTP 裸 object DTO 被当信封解包（与 `PROTOCOL.md` §9 矛盾） | 业务 object DTO **一律** `{data:{...}}` 包装 |
| `RateLimitInOut` 无法短路（骨架不读 `ctx.errorCode`） | 自建限流，抛错或返回 `fail(RATE_LIMITED)` |
| NestJS 默认直接 `new` Action，不经容器 | `resolveAction: (Cls) => appRef.app!.get(Cls)`；Action 加 `@Injectable()` |
| `FlowContext` 用 `import type` → `emitDecoratorMetadata` 退化 → **鉴权静默失效** | **必须值导入** |
| `NODE_ENV=production` 默认拒启动 | 显式 `allowProduction` |
| 普通对象构造参数无 DI token → Nest 把 `Object` 当 provider | 给显式 token |

## 6. 新框架源码由 CI 挂载到 `vendor/ionet-ts/`

本仓库**不提交** `vendor/ionet-ts/`。`pnpm-workspace.yaml` 通过 `vendor/ionet-ts/packages/*`
把框架包纳入 workspace，所以**构建前它必须就位**。

- CI：`.github/workflows/ci.yml` 用 `actions/checkout` 把 `matcha-cult/ionet-ts`(dev) 检出到该路径。
- 本地：`ln -sfn /path/to/ionet-ts vendor/ionet-ts`
- **不要**在本仓库修改 `vendor/ionet-ts/`：框架改动须在框架仓库完成、提交、推送后再同步。

## 7. 环境坑（本机 DSH 沙箱实测）

### 7.1 SSH 访问 GitHub 报 "Bad owner or permissions"
这是**沙箱 uid 映射渲染出的假象**（`/bin/bash` 也显示 `nobody:nogroup`），不是真机 `/etc/ssh` 坏了。
OpenSSH 拒绝解析含坏 owner 的 `Include`。解法：让 ssh 不读系统配置。

```bash
GIT_SSH_COMMAND='ssh -F /dev/null' git ls-remote git@github.com:matcha-cult/idle-dark-forever.git
GIT_SSH_COMMAND='ssh -F /dev/null' git push -u origin main
```
**不要**试图 `chown`/`chmod` `/etc/ssh`（`/` 只读 + `no_new_privs` 已置位）。

### 7.2 pnpm 全局 store 只读
`~/.local/share/pnpm/store` 在沙箱外、只读。根 `.npmrc` 已写 `store-dir=.pnpm-store`（工作区本地）。
安装用 `--config.confirmModulesPurge=false` 避免无人值守卡在交互确认；**不要**在 `CI=1` 下跑
（会顺带打开 frozen-lockfile）。

### 7.3 antd 权威资料用全局 CLI（**改前端 UI 前必须先查，别靠记忆**）
```bash
cd /home/nbb/projects/idle-dark-forever
antd-zh() { XDG_CACHE_HOME="$PWD/tmp/antd-cache" /home/nbb/n/bin/antd --lang zh --version 6.6.3 "$@"; }
XDG_CACHE_HOME=$PWD/tmp/antd-cache /home/nbb/n/bin/antd list --lang zh
antd-zh info Card          # 精确 props / 默认值 / Since
antd-zh doc Button --format markdown
antd-zh demo Layout side --format markdown
antd-zh token Menu --format markdown
```
- `--version` 必须与本仓实装一致（当前 **6.6.3**），且是**全局选项、放在子命令之前**。
- `XDG_CACHE_HOME` 指向工作区是必需的：沙箱 `~/.cache` 只读，不加会喷 `EROFS`（exit 0，非失败）。
- 已知 v6 弃用：`Space split→separator`、`Space direction→orientation`、`Divider type→orientation`、
  `Alert message→title`、`Card bordered→variant`、`Statistic valueStyle→styles`、`Drawer width→size`、
  `InputNumber addonAfter→suffix`、**`Progress trailColor→railColor`**（6.6.x 运行期告警，
  `.d.ts` 也标了 `@deprecated`）、**`List`→`Listy`**（6.6 起 `[antd: List]` 弃用告警；
  本仓 src 无直接使用，告警来自 antd 内部组件，属上游噪声）。
- 另注意：antd 默认 `autoInsertSpaceInButton` 会把**两个汉字**的按钮文案插空格（「攻击」→「攻 击」），
  写断言时必须归一化空白。
- 官方示例必须按本仓规则改写：颜色只用 token（禁内联 hex）、不传 `size`（全局 `compactAlgorithm` 承担紧凑）、
  组件禁 `export default`。

### 7.4 workspace 包必须显式声明依赖（pnpm 隔离布局）
`packages/ui-kit` 用 `import type { ... } from '@idle-dark/protocol'`（type-only，运行时被擦除），
但**仍必须**在 `package.json` 里声明 `"@idle-dark/protocol": "workspace:*"`，否则 pnpm 隔离布局下
`tsc` 会报 `Cannot find module`。**不要用软链绕过** —— `pnpm install` 会清掉它，
且会掩盖真实的依赖缺失。（已发生一次：ui-kit 用软链绕过，集成时才修。）

加依赖后必须重跑 `pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false`，
并确认 `node_modules/@idle-dark/<pkg>` 指向 workspace 包（`../../../<pkg>`）而非手工软链。

### 7.5 Vite dev server 会缓存「工作区外源码」的旧版
`packages/web` 是 vite root，而 `ui-kit/src`、`ionet-transport/src` 在 root 之外（经 `resolve.alias` 指过去）。
**新增文件**总是从磁盘首读；**改写老文件**可能被缓存住旧版甚至读到撕裂内容 → 表现为「磁盘对、单测绿、
浏览器就是看不到新东西」。

- `packages/web/vite.config.ts` 的 `idle-dark:watch-workspace-src` 插件是**必需项**，不是可选优化。
- 仍失效时 `touch` 相关文件强制失效；彻底办法是重启该 dev server。
- **验证纪律**：报告"已生效"前，必须 `curl` dev server 吐出的那份模块，并 grep **只有新版本才有的运行期符号**
  （type-only 模块被 esbuild 抹空，grep 其类型字段名必然 0 命中，那是正常的）。
  先看状态码：`curl -s -o /dev/null -w '%{http_code}'`；`000` 说明 server 压根没监听，
  和"缓存旧版"是完全不同的处置。

### 7.6 开发中的页面一律包 `ErrorBoundary`
模块级异常会把整棵 React 树卸载成白屏。`panel-registry` 对每个域包一层（key 跟域走，错误态不粘下一个面板）。

### 7.7 数据库：沙箱内**没有服务端二进制**，但有一个**可用的外部实例**
本机实测：
- 只有 `psql` **客户端**；`/usr/lib/postgresql/18/bin/` 下**没有 `initdb` / `postgres`**；
  `docker` 命令存在但 **daemon 不可用**（`/var/run/docker.sock` 不存在）→ **无法在沙箱内自建集群**。
- **但**本机有一个可直接使用的 PostgreSQL 实例（`idle-path-of-xiuxian` 用的那台），
  凭据写在 `packages/server/.env` 里 → **数据库相关的端到端验收在本地就能跑**（见 §10.3）。

因此：

| 能在本地跑 | 说明 |
|---|---|
| `pnpm run build` / `typecheck` / `test` | 纯逻辑，不需要数据库 |
| `db:init` / `prisma:validate` / `prisma:pull` | 连 `localhost:35432` |
| 服务端启动 + 线协议冒烟 15/15 | 需要数据库健康（`/api/health` = 200） |
| 路由探针 20/20 | 需要数据库（Action 会打到持久化层） |
| **完整游戏流程冒烟 22/22** | `scripts/game-flow-smoke.mjs`，**已在本地实跑通过** |
| **拾取规则冒烟 18/18** | `scripts/loot-rule-smoke.mjs`（真实战斗掉落 → `(battle,loot)` 推送；本地以 `LOOT_WINDOW_MS=300000` 实跑通过） |
| **进图剧情冒烟 14/14** | `scripts/story-entry-smoke.mjs`（进图自动播放 + 击杀任务静默登记，已本地实跑通过） |
| **角色归属冒烟 10/10** | `scripts/character-scope-smoke.mjs`（同账号两条连接不串号 + 刷新后不再推战斗消息，见 §15） |

> 无数据库时的行为：`/api/health` 返回 `503 degraded`（正确降级），协议层断言仍可通过；
> 但依赖 `users`/`characters` 的 Action 会返回 `INTERNAL`。

需要**脱离外部实例**做单测时，用内存替身实现 `DatabaseService` 的 `query` / `connect`
（`packages/server/test/helpers/fake-database.ts` 已有），不要试图在沙箱里安装/启动 PostgreSQL。

### 7.8 端口冲突排查：每次 bash 调用在**独立 PID namespace**

**结论（已验证）**：DSH 的每次 `bash` 调用都跑在 `bwrap --unshare-pid` 里 ——
`ps -eo pid,ppid,comm` 只能看到本调用自己的 `bwrap / bash / ps / head`，
而**网络 namespace 是共享的**（`ss` 能看到别的调用绑的端口）。于是会出现两种看似矛盾的现场：

| 现象 | 真相 |
|---|---|
| `ss` 里有监听、`ps` 里找不到对应进程 | 正常：进程在**另一次调用**的 PID namespace 里，`kill` / `pkill` 都够不到 |
| bind 失败（`EADDRINUSE`）但 `ss` 空空如也、`curl` 也是 `000` | 端口确实被占（多半是上次调试残留的 dev server），只是那一刻没抓到 |

排查只用**自己 bind 一次**（比 `ss` 可信）：

```bash
node -e "const n=require('net');const s=n.createServer();
s.on('error',e=>{console.log('FAIL',e.code)});
s.listen(5273,'127.0.0.1',()=>{console.log('OK');s.close()})"
```

- `FAIL EADDRINUSE` → 换端口，或让**用户在他自己的终端里**关掉那个进程（你够不到它）。
- `OK` 但 Vite 仍报占用 → 是**竞态 / 残留**，重试一次通常就好（实测 5273 经历过
  「占用 → 空闲 → 又占用」的反复），**不要**据此写下"某端口不可用"的死结论。

> ⚠️ 不要用 `pkill -f vite` 去"清理干净"：跨 namespace 杀不到，
> 而且 3000 / 5173 是 `idle-path-of-xiuxian` 的服务，误杀会影响别的工程。
> 另外 `curl` 得到 `000` 既可能是"没有监听"，也可能是"端口被占但无响应"，
> 两者处置相反 —— 判断依据只能是 bind 探测。

### 7.9 本地调试默认值：`dev.config.json`（唯一真相）

端口与代理地址只写一次：前端 `packages/web/vite.config.ts` **直接 import 它**，
后端 `packages/server/scripts/dev.mjs` 读它并写进 `process.env.PORT`
（dotenv 不覆盖已存在的环境变量，所以配置能盖住 `.env` 里的 `PORT=3000`，
而命令行 `PORT=… pnpm dev:server` 又能盖住配置）。

```jsonc
// dev.config.json
{ "backendHost": "127.0.0.1", "backendPort": 3100, "frontendPort": 5273, "expRate": 10 }
```

```bash
pnpm dev:server          # 后端 3100（tsc --watch + node --watch）
pnpm dev:web             # 前端 5273（vite），/api 与 /ws 代理到 3100
pnpm dev                 # 两者一起（--parallel）
```

临时换端口/倍率（不改文件）：`PORT=3200 pnpm dev:server`、`EXP_RATE=1 pnpm dev:server`、
`VITE_DEV_PORT=5300 pnpm dev:web`、`VITE_BACKEND_ORIGIN=http://127.0.0.1:9999 pnpm dev:web`。

**`expRate`（角色经验倍率，开发用）**：`dev.mjs` 把它写成环境变量 `EXP_RATE`，
服务端启动时读一次（`world.config.ts#parseExpRate`），注入 `BattleWorldOptions.expRate`：

- 只作用于**角色经验**（在线战斗 + 离线结算都走 `BattleWorld.gotExp`）；
  **不影响技能经验与掉落数量**（掉落数量归 `updateRate`，两者相乘）。
- **只有走 `pnpm dev:server` 才有倍率**：直接 `node dist/main.js`、CI、生产都不设 `EXP_RATE` → `1`。
- 非法值（0 / 负数 / NaN / Infinity / > 1000 / 非数字）一律回落 `1` ——
  配错一个 0 不该让全服经验归零。

前端固定 `strictPort: true`：端口被占时**直接失败**、不静默换号 ——
否则收藏夹 / 代理指向的地址会悄悄变成一个不存在的 dev server（曾因此误判"改了没生效"）。

## 8. 新增一个游戏域要改哪些文件
1. `packages/protocol/src/cmd.ts` —— 登记段与 subCmd（段宽 10、subCmd 从 1 起、0 保留）
2. `packages/protocol/src/dto.ts` —— 该域请求/响应类型
3. `packages/server/src/modules/logic/<domain>/` —— `*.action.ts`（只校验转发）+ `*.logic.service.ts`（门面编排）+ `internal/`（实现）
4. `packages/server/src/ionet/game-actions.ts` —— 登记 Action 类与 Module
5. `packages/ionet-transport/src/api/game-api.ts` —— 加 typed 方法（cmd 常量直接来自 protocol）
6. `packages/web/src/stores/<domain>-store.ts` + `packages/web/src/pages/game/panel-registry.tsx` —— 注册面板
7. 单测：纯规则放 `game-core`，编排放 `server`（用内存端口替身）

## 9. 环境变量（`packages/server/.env`）

| 变量 | 说明 |
|---|---|
| `PORT` | 单端口三合一（REST `/api` + WS `/ws`），默认 `3000` |
| `DATABASE_URL` | PostgreSQL 连接串（**本工程用独立库，见 §10**） |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | HS256 密钥与有效期 |
| `IONET_ALLOW_PRODUCTION` | 生产环境必须置 `true` 才允许启动 ionet 模块 |
| `REDIS_URL` | 预留：本工程当前**未使用** Redis（在线状态走内存注册表） |
| `EXP_RATE` | 角色经验倍率；**不设 = 1（原版）**。只由 `pnpm dev:server` 按 `dev.config.json` 注入。仅影响角色经验，不影响技能经验与掉落数量 |

`.env` 已在 `.gitignore` 中，**不要提交**（里面有数据库口令）。

---

## 10. 数据库：schema 是设计真相，运行期用原生 pg

采用与 `idle-path-of-xiuxian` **相同**的 Prisma 用法（刻意保持一致，便于两个工程互相参照）：

| 角色 | 是什么 |
|---|---|
| `packages/server/prisma/schema.prisma` | **数据设计的唯一真相**：表形状/约束/默认值以它为准 |
| `packages/server/scripts/init-db.mjs` | **实际执行 DDL**（幂等 `CREATE TABLE IF NOT EXISTS` + 增量 `ALTER ... ADD COLUMN IF NOT EXISTS`） |
| 运行期 | **原生 `pg`**（`DatabaseService` / `GameDatabaseService`）。`src/` 内**禁止** import `@prisma/client` |
| `prisma` / `@prisma/client` | 只在 **devDependencies**，仅用于 `validate` / `generate` / `db pull` |

> 改表 = 同时改 `schema.prisma` **和** `init-db.mjs`，两处必须一致（`db pull` 可核对）。

```bash
cd packages/server
pnpm run prisma:validate   # 校验 schema 语法/一致性（不需要数据库）
pnpm run prisma:generate   # 生成 Prisma Client（仅类型参考，运行期不用）
pnpm run prisma:pull       # 用**线上库**反推 schema —— 核对「设计真相」是否已漂移
pnpm run db:init           # 执行 DDL（幂等）
```

### 10.1 沙箱内跑 Prisma 必须重定向 `HOME`

Prisma 把引擎缓存在 `os.homedir()/.cache/prisma`，而沙箱内 `~` 只读 → 报
`EROFS: read-only file system, utime '.../libquery-engine'`。`XDG_CACHE_HOME` **无效**（Prisma 不读它），
必须改 `HOME`：

```bash
export HOME="$PWD/../../tmp/prisma-home"   # 指向工作区内（tmp/ 已 gitignore）
mkdir -p "$HOME"
./node_modules/.bin/prisma validate
```

### 10.2 库的选择：**独立数据库，绝不与 xiuxian 共库**

本机 PostgreSQL（`localhost:35432`）上的 `idle_game` 是 `idle-path-of-xiuxian` 的库，里面已有它的
`users` / `characters`（`characters.id` 是 `integer`、有 `nickname`/`gender`…）与 30 张 `game_*` 表。

本工程的 `characters` 列定义**完全不同**（`id text` / `name` / `role` / `career` / `state jsonb`）。
建在同一库里会被 `CREATE TABLE IF NOT EXISTS` **静默跳过**，随后所有查询都会失败。

因此本工程使用**独立数据库** `idle_dark`：

```sql
CREATE DATABASE idle_dark;   -- 已创建；init-db.mjs 只建表不建库
```
`DATABASE_URL` 指向 `.../idle_dark`。当前用户具备 `CREATEDB`/`SUPERUSER`（实测），
但**不要把本工程的表建进 `idle_game`**。

### 10.3 端到端验收（需要数据库，本地/CI 均可）

```bash
cd packages/server
node dist/main.js &                        # 需先 pnpm run build；会读 .env
node scripts/route-probe.mjs 3000 "$JWT_SECRET"    # 20/20 域 Action 是否都注册
node scripts/game-flow-smoke.mjs 3000              # 完整流程（22 项断言）
LOOT_WINDOW_MS=300000 node scripts/loot-rule-smoke.mjs 3000   # 拾取规则 → 真实掉落（18 项）
node scripts/story-entry-smoke.mjs 3000                       # 进图自动触发剧情（14 项）
node scripts/character-scope-smoke.mjs 3000                   # 角色归属 / 推送范围（10 项）
```

> ⚠️ **不要占用 3000 端口做验证前先确认它是不是 xiuxian 的服务端**：
> 两者健康检查形状不同（xiuxian 的响应没有 `service` 字段且会报 `redis`），
> 打到别人的服务端会得到一堆莫名其妙的 404。本工程验证时用独立端口更安全。

---

## 11. 跨域硬约定：拾取规则编码（只允许一处定义）

`Player.lootRule` 是 `Map<string, number>`（原版是 `Map<class, number[]>`），扁平编码为：

| key | value |
|---|---|
| `__enabled__` | `1` 开 / `0` 关（缺省视为开） |
| `c:${class}:${quality}` | `action`（启用）或 `action + 10`（该条停用）；`action` = 0 拾取 / 1 出售 / 2 分解 |

**唯一定义在 `packages/game-core/src/rules/loot-rule.ts`**（`lootRuleKeyOf` / `parseLootRuleKey` /
`encodeLootRule` / `decodeLootRule` / `lootRuleEnabledOf` / `lootRuleActionOf`）。
面板（`server/.../lootrule/internal/loot-rule-ops.ts`）与战斗（`combat/battle-world.getLootRule`）
都**只消费**这套定义。

判定顺序：全局关 → 一律拾取；显式规则命中且 `action !== 0` → 用该 action；
否则回落 `minLootLevel`（`level < minLootLevel` 时 0 品质出售、其余分解）。
注意「显式设为拾取（0）」等价于未设置，仍会被 `minLootLevel` 兜底（与原版 `if (ret) return ret;` 一致）。

> 教训：这两处曾各写一份实现，键格式（`class` vs `c:class:quality`）与值类型（`number` vs `number[]`）
> 双双漂移，面板设置**静默失效**、永远回退兜底。类型撒谎（`PlayerLike.lootRule` 曾误标为
> `Map<string, Record<number, number>>`）还让 `tsc` 无法发现。**禁止在消费侧复制编码或判定逻辑。**

### 11.1 落地回调必须**先快照再 `player.loot()`**

`Player.loot(slot)` 会把传入的 slot `clear()`（key/count 归零）。`toPlayerLike` 的 `lootRecorder`
如果在其后才读 slot，拿到的是空槽 → `(battle, loot)` 推送变成 `{slot:{key:null,count:0}}`、
`dto.gold` 也会因 `slot.key !== 'gold'` 丢失。
因此 `internal/player-like.ts` 先 `InventorySlot.fromJSON(...)` 复制一份再调用 `player.loot`。
新增任何"落地后记录"的回调都要遵守这条。

---

## 12. 剧情推进：进图自动触发（原版 `MapPanel.checkStories()`）

**服务端**：判定与登记的唯一实现在 `server/.../story/internal/story-ops.ts#opAdvanceStoriesOnMapEntry`，
由 `WorldService.start()`（会话首次落地在该图）与 `WorldService.enterMap()` 调用。
对**当前地图上条件已满足且尚未开启**的每条剧情：

| 剧情类型 | 服务端行为 | 推送 `StoryUnlockDto` |
|---|---|---|
| `kill` / `purchase` | **静默登记**为进行中；击杀任务同时挂上剩余数（原版 `addKillTask`） | `autoPlay: false`（等玩家去打 / 去买） |
| 纯剧情脚本（数据里无 `taskType`） | **不改状态** | `autoPlay: true`（前端自动播放） |

- `opFinishStory` 也用同一套分类：新就绪的 `kill`/`purchase` 当场登记，纯剧情脚本上报 `autoPlay: true`
  —— 对应原版 `checkStories()` 的 `while (dirty)` 循环。
- 击杀任务剩余数降到 0 时，`WorldService.onEnemyKilled` 推 `autoPlay: true`（原版 `checkKill()` 当场弹剧本）。
- ⚠️ **服务端绝不替玩家 `finish`**：剧本要人读，`finish` 只能由前端在玩家读完/关闭后调用。
- 该函数**幂等**：登记过的条目因 `status !== 'none'` 直接跳过，重复进图不会重置击杀进度。

**前端**：`story-store.handleNotification` 按 `autoPlay` 分流 —— 为真则 `story.load()` 后
`ui.setActivePanel('stories')` 并 `open(key)`；为假只提示 + 刷新列表。
玩家正在读另一段剧情时（`play !== null`）**不打断**。

⚠️ 面板 key 是 **`UiStore` 状态**（不是 `GameShellPage` 的局部 state），否则推送驱动的跳转无法发起。

---

## 13. 中立（黄名）单位必须可被玩家点选攻击

`packages/game-core/src/combat/camps.ts` 是阵营关系的唯一真相：

| 关系 | 值 | 语义 |
|---|---|---|
| `CampRelation.player.enemy` | `'hate'` | 自动选为目标（红名野怪） |
| `CampRelation.player.neutral` | `true` | **可攻击，但不会被自动选中**（黄名中立） |
| `ghost` / `story` / `shrine` | 无 | 不可攻击 |

所以「战场单位」列表与点选逻辑必须是 **敌方 + 中立**：

- 判定只有一个入口：`web/src/stores/world-store.ts` 的 `isAttackableCamp(camp)` /
  `get attackables()`；`enemies` 只用于计数与展示。
- ⚠️ **不要自己写 `unit.camp === 'enemy'`**：前端曾经只列 `enemy`，于是中立的大史莱姆
  (`slime.giant`) 既看不见也点不动 → `eyer-stories-4`（击杀 1 只大史莱姆）直接把主线卡死。
  这正是原版剧情要教玩家的那条规则：「黄色名字的魔物不会主动攻击英雄们……但如果英雄主动
  攻击他们，他们就会加入战斗」。
- 中立怪不是"点一下就变敌人"，而是**首次受到伤害**时由
  `Unit.damage()` → `setTarget(from)` → `EnemyUnit.setTarget()` 把 `camp` 翻成 `enemy` 并反击
  （见 `unit.ts:602-614` 与 `enemy-unit.ts:455-460`）。
- 服务端 `battle.focus` 只拒绝 `ghost` 与不存在的目标，中立目标本就被允许 ——
  **别在前端把它过滤掉**。

---

## 14. `(world, tick)` 推送频率：设计值 5Hz/连接 + 自检探针

**设计（实测，不要凭感觉）**：`WorldService` 心跳 `WORLD_CONFIG.tickIntervalMs = 200`，
`NotificationBatcher` flush 周期 `200`，同一 `(userId, cmdMerge)` 在一批内**合并成一帧**。
⇒ **每个 WS 连接**每秒收到 ~5 帧 `(cmd=30, subCmd=5)`，帧间隔中位数 200ms。

实测（直连 3100 与经 5273 代理一致）：

```
{"frames":60,"perSecond":5,"gapMin":199,"gapP50":200,"gapP90":201,"gapMax":202}
```

**若在浏览器里看到明显更多**，只有两种可能 —— 用探针量，不要靠 console 里数：

```js
await __idleDarkTickRate()      // 默认采样 10s，打印 frames / perSecond / 间隔分布 / 结论
await __idleDarkTickRate(3000)
__IDLE_DARK__                   // 根 store（临时排查）
```

| 现象 | 结论 |
|---|---|
| 同一 `serverTime` 出现多次（`duplicatedFrames > 0`） | **同一帧被投递多次**：多个标签页 / 5273 与 5274 两个 dev server / 残留 socket。框架 `sendNotification` 会发给该 userId 的**全部** OPEN 连接 |
| 不重复但 `perSecond > 6` | 服务端真的快于设计 —— 查 `tickIntervalMs` 与 batcher `flushIntervalMs` |
| 两者都正常，只是"刷屏" | 帧里带整份 `units` 快照，`console.log` 5 次/秒 × 大对象 = 观感问题 |

探针只在 `import.meta.env.DEV` 下**动态 import**（`main.tsx`），
生产包里 `grep __idleDarkTickRate dist/assets/*.js` 应为 **0 命中**（已验证）。
纯汇总逻辑在 `web/src/services/tick-rate.ts#summarizeTickRate`，单测覆盖空样本/单帧/乱序/
重复 `serverTime`/窗口非法等边界。

---

## 15. 角色会话归属：一个账号同一时刻只有一个活跃角色

**语义**（原版是单存档单玩家，没有"同账号同时玩两个角色"的概念）：

- 选角是 WS Action（`player.select`，cmd 20/6）；握手只认**账号**（`?token=` → userId），
  所以「先连 WS 再选角色」是协议决定的，不是 bug。
- **每次 WS 握手成功 = 该账号回到「未选角色」**：`app.module.ts` 的 `authenticate` 里
  **await** `WorldService.resetActiveCharacter(userId)`（停活跃会话 + 清两个注册表 +
  `batcher.drop(userId)`）。不这样做的话，刷新页面后旧角色仍被当成"在线"
  （`OnlineSessionService.isOnline` 是**账号级**判据），`(world, tick)` 会灌给停在选角页的页面。
  - 必须 **await**：否则握手已放行、连接已能收推送，而旧会话还在 tick（实测漏 1 帧）；
  - 必须 **drop** 而不是 flush 待发帧：队列里那批 tick 属于"上一段游玩"，不能投给新连接；
  - 有 2s 超时保护：DB 卡住也不能把握手挂死（超时放行，重置继续在后台跑）。
  - 断线重连由前端补：`RootStore` 在「曾经 online 过之后再次 online」时重新
    `player.select(activePlayerKey)`；**全新登录/刷新时 `activePlayerKey` 为 null，
    故意不自动选角**（否则又会在选角页拉起战斗推送）。
- `player.select` 是**切换**：`PlayerLogicService.select` 会 `start(新角色)` 后
  `stop(旧角色)`，保证同一账号**只有一个活跃世界会话**。
- `WorldService.stop()` 在指针仍指向该角色时清理 `activeByUser`（切人流程是
  `start(新) → stop(旧)`，所以不能无条件清）。

**角色归属校验**（唯一入口 `WorldService.resolveActiveCharacter(userId, rawKey)`）：

| 入参 | 结果 |
|---|---|
| 未选角 + 不给 key | 失败（`NOT_IN_MAP`，'尚未选择角色'） |
| 已选角 + 不给 key / 空串 | 回退到当前角色 |
| key === 当前角色 | 通过 |
| key ≠ 当前角色 | **失败**（`PLAYER_NOT_FOUND`，'该角色不是当前选择的角色'） |

`world.*` / `battle.focus` / `idle.*` 都走这一个入口，**不要再各写一份 `?? activeCharacterOf`**。

> ⚠️ **为什么必须这样**：框架的定向推送 `sendNotification(userId, …)` 会发给该 userId 的
> **全部 OPEN 连接**。如果允许"一个账号两个角色会话"或"A 连接操作 B 角色"，就会出现
> 「两条连接互相收到/推进对方的角色」= 串号 + 双份 tick 推送（实测过：
> A 选 X、B 选 Y，A 不带 key 的 `world.snapshot` 解析到 Y；2 秒内 A=9 B=10 帧且 serverTime 相同）。
> 单会话 + 归属校验之后，**推送到该账号任何连接的消息都只属于当前角色**。

**回归验证**：

- 单测 `server/test/character-switch.test.ts`（切人停旧会话 / tick 只含当前角色 /
  `stop` 清指针 / `resolveActiveCharacter` 四种入参 / 每 tick 至多一帧）。
  去掉"停旧会话"那两行 → 3/6 用例失败（已实测）。
- 端到端 `server/scripts/character-scope-smoke.mjs`（真实 REST+WS+DB，同账号两条连接）
  **10/10 通过**，含「新连接（未 select、模拟刷新）收不到 `(world, tick)`」与
  「新连接 `world.snapshot` → 尚未选择角色」。
- 面板域（inventory/shop/… 的 `characterId` 可选、走 `PanelCharacterService`）**尚未**做
  同样的显式化 —— 见交接文档的后续项。

### 15.1 别在 `pnpm dev:server` 运行时手动 build

`pnpm dev:server` 已经在跑 `tsc --watch` + `node --watch dist/main.js`。
再手动 `pnpm --filter idle-dark-server run build`（或 `pnpm run verify` 里的 build）会与 watcher
抢写 dist → `node --watch` 连续重启，期间**端口短暂不可用**（实测出现过
`ECONNREFUSED` 与 `Cannot use a pool after calling end on the pool`）。
要跑全量门禁就**先停 dev**，或跑完后再确认 `/api/health` 已恢复。
