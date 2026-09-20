# AGENTS.md —— idle-dark-forever 工程约定

> 面向在本仓库工作的 AI 代理与工程师。**新增环境坑或约定时在此追加一节，不要删旧节。**

`idle-dark-forever` 是《永夜2016典藏重置版》（纯前端单机游戏，源仓库 `/home/nbb/projects/dark-forever-memorize`）
的**服务端权威重制版**：ionet-ts + NestJS 后端，React + Vite + Antd + MobX 前端。

设计与拆解见 [`ai-docs/00-重写总方案.md`](ai-docs/00-重写总方案.md)，
结构与接续点见 [`ai-docs/01-架构与接续指南.md`](ai-docs/01-架构与接续指南.md)，
后续任务书见 [`ai-docs/02-wave2-任务书.md`](ai-docs/02-wave2-任务书.md)，
交付状态见 [`ai-docs/04-交付状态与验收.md`](ai-docs/04-交付状态与验收.md)，
**未竟事宜（接续前先读这个）见 [`ai-docs/05-交接-未竟事宜.md`](ai-docs/05-交接-未竟事宜.md)**，
**容量基准与并发上限（实测数字 + 待拍板参数）见 [`ai-docs/06-容量基准与并发上限.md`](ai-docs/06-容量基准与并发上限.md)**，
**词缀池与掉落生成（27/3/24 条逐条清单 + 品质→条数 / 部位职业过滤规则）见 [`ai-docs/11-词缀池与掉落生成.md`](ai-docs/11-词缀池与掉落生成.md)**。

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

### 7.8.1 `/tmp` 是**每次调用一个新 tmpfs**，日志别写那儿

沙箱用 `bwrap … --tmpfs /tmp` 起每次 `bash`，所以**上一条命令写进 `/tmp` 的文件，下一条就读不到了**
（实测：`pnpm run verify >/tmp/v.log` 之后 grep 报 `No such file or directory`，
白跑一次全量门禁）。落盘用工作区内的 `tmp/`（已 gitignore）：

```bash
mkdir -p tmp && pnpm run verify >tmp/verify.log 2>&1; echo "exit=$?"; grep -E "Tests  " tmp/verify.log
```

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
由 quest（`StoryLogicService`）**订阅 battle 发布的 `MapEntered` 事件**后调用
（08 §2.3 解环；`WorldService.start()` 会话首次落地 / `enterMap()` 进图时发布该事件，
battle 不再直接调用 story）。
对**当前地图上条件已满足且尚未开启**的每条剧情：

| 剧情类型 | 服务端行为 | 推送 `StoryUnlockDto` |
|---|---|---|
| `kill` / `purchase` | **静默登记**为进行中；击杀任务同时挂上剩余数（原版 `addKillTask`） | `autoPlay: false`（等玩家去打 / 去买） |
| 纯剧情脚本（数据里无 `taskType`） | **不改状态** | `autoPlay: true`（前端自动播放） |

- `opFinishStory` 也用同一套分类：新就绪的 `kill`/`purchase` 当场登记，纯剧情脚本上报 `autoPlay: true`
  —— 对应原版 `checkStories()` 的 `while (dirty)` 循环。
- 击杀任务剩余数降到 0 时，`StoryLogicService` 订阅 `EnemyKilled` 事件并推 `autoPlay: true`
  （原版 `checkKill()` 当场弹剧本）。
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

---

## 16. 逻辑服边界（硬约定，违反即不合格）

> 来源：[`ai-docs/08-逻辑服迁移任务书.md`](ai-docs/08-逻辑服迁移任务书.md) §1、
> [`ai-docs/09-地图与秘境逻辑服.md`](ai-docs/09-地图与秘境逻辑服.md) §4。
> **A2 已拍板**：当前只做**单进程边界**；框架运行时（ionet-ts 逻辑服）由另一会话补齐，
> 本仓不做跨进程，但边界与接口按可拆分设计。

| # | 约定 |
|---|---|
| **C1** | 一个业务域 = 一个逻辑服模块：根下 `logic-server.ts`（`XxxLogicServer`，**仅 builder**）+ `<domain>.action.ts`（`@ActionController`）+ `protocol` 里的 cmd 段/DTO |
| **C2** | 业务逻辑**禁止**写在 `*LogicServer`、对外服、启动/装配类里；业务只属于 `Action` |
| **C3** | 跨逻辑服**只允许走通信契约**（`call`/`send`/事件/将来的 `OnExternal`）；禁止直接 import 另一个服的 service/internal |
| **C4** | 共享层只放协议与配置，不放业务：`packages/protocol`、`modules/logic/shared`、`common/**` |
| **C5** | 依赖图必须是**有向无环（DAG）**，由 `packages/server/test/logic-server-boundary.test.ts` 强制 |
| **C6** | 每片状态只有一个写者（`characters.state` 分区、`account_state.data` 分键、在线/会话注册表归 external） |
| **C7** | **战斗（伤害判定、经验获取、掉落判定）必须运行在 battle 逻辑服内**，不得散落在对外服或面板域 |

### 16.1 边界登记表是唯一真相

逻辑服的划分、源码根、cmd 段归属都写在
`packages/server/src/logic-servers/registry.ts`（`SERVER_DEFINITIONS`）：
`external / battle / item / quest / character / dungeon / map`（拓扑 B，09 §4.1）。

**跨服事件**（08 §2.3 解环）定义在 `modules/logic/shared/events.ts`：
`MapEntered`（battle→quest）、`EnemyKilled`（battle→quest）、`CombatHooksDirty`（item/character→battle）。
总线 `EVENT_BUS` 是**进程内同步**实现，保持解环前的调用时序。

### 16.2 架构门禁（会失败的测试）

`pnpm --filter idle-dark-server exec vitest run test/logic-server-boundary.test.ts` 断言：

1. **文件级 SCC = 0**，且**逻辑服级图无环**（含 `world/story/inventory` 三条已知环的回归）；
2. **共享层不反向依赖任何逻辑服**；
3. **跨服深路径 import 恰好等于** `TRANSITIONAL_DEEP_IMPORTS`（**过渡债务，禁止增长**）；
   当前仅剩 `dungeon → map` 一条（09 §4.2 允许的方向：队列耗尽/非秘境条目 → `map.ContinueOpenWorld`）。
4. **cmd 段唯一归属**：`CMD_SEGMENTS` 每段恰好属于一个服；
5. 每个逻辑服根下的 `logic-server.ts` 导出 `XxxLogicServer` 且**不得出现 `@ActionMethod`**。

> 扫描器会**先剥注释**再解析：本仓多处 JSDoc 里有示例 `import`，不剥会把文档当真实依赖（实测过）。
> 动态 `import(变量)` 与无法解析的相对 import 一律**显式报告**，不得静默通过。

### 16.3 容量不变式（07 §0，与逻辑服调度绑定）

- **I1**：世界时间 = 真实时间（`world_time_ratio ≥ 0.99`）；
- **I2**：任何「每轮处理 N 个」的循环必须**同时**给出全局预算与超载行为；
- **I3**：禁止静默降级（一切降频/截断/丢弃都要有日志 + 指标 + 明确动作）；
- **I4**：CPU 不是瓶颈，不得用「少 tick 几个角色」换吞吐；
- **I5**：每个限额都要能在 `/api/metrics`（或 `system.stats`）看到当前值。

---

## 17. `src/data/**` 的视图类型是「对内核的断言」——已加编译期门禁

`contracts/data.ts` 把数据表函数的 `this` / `world` / `self` 冻结成 `unknown`（正确：契约只描述
「表里有什么」）。为了让 183 个原版数据文件**保持原样**能过 `strict`，`src/data/_shapes.ts` 声明了
一层「视图接口」（`UnitLike` / `WorldLike` / `BuffStateLike` / `SkillStateLike` / `PlayerView`）。

**风险**：视图类型比真实内核**多写一个成员**，`tsc` 只会更宽松 —— 缺陷被推迟到运行期，
而数据层 hook 抛的错会被 tick / 离线结算的 `try/catch` 吞成一条 WARN，**静默失效**。

已发生三次（同一根因，详见 `05` §2.3 / §2.4）：

| 视图成员 | 内核真相 | 运行期后果 |
|---|---|---|
| `UnitLike.timeline` | 真实 `Unit` 只有 `clock`（原版 `this.timeline` 的移植名） | `undefined.pause()`；`freezed`/`stunned` 等 debuff 全部失效 |
| `WorldLike.sendGeneralMsg` | `BattleWorld` 上**不存在**该方法 | 26 处机关提示 / BOSS 对话 `is not a function` |
| `SkillStateLike.summoner` | `summoner` 只属于 `Unit`；hook 的 `this` 是 `SkillState` | `year2018.heal` 恒 `undefined` → 永远静默不生效 |

**门禁**：`packages/game-core/src/data/_shapes.gate.ts` ——
`type MissingOn<View, keyof Kernel>` + `AssertNoMissing<T extends never>` 为 7 组视图断言
「视图的每个成员都真实存在于内核上」。视图再撒谎 → `pnpm run typecheck` 报 `TS2344` 并**点名成员**。

- ⚠️ 该文件**不可**命名为 `*.test.ts`：`packages/game-core/tsconfig.json` 的 `exclude` 含
  `src/**/*.test.ts`，放进测试文件就是**假门禁**（实测：塞回 `timeline` 后 typecheck 仍 exit 0）。
- ⚠️ 多类目标要传**并集**：`keyof (A | B)` 是**交集**，写成 `keyof (Unit | PlayerUnit | EnemyUnit)`
  会把子类独有的 `str` / `player` / `transformType` 全误报为缺失。
- 加成员的处置顺序：**先在内核上补**（如 `BattleWorld.sendGeneralMsg` 转发到 `BattleSink.general`），
  确实属于数据层动态挂载的才登记进 `BuffDynamicFields` 白名单并写明谁写谁读。

**移植新数据时**：凡原版属性名在本仓被改名，视图里必须写**新名**；
`sendSkillUsage` / `sendGeneralMsg` 这类「原版 `world.*` 但内核没有」的调用，
一律在 `BattleWorld` 上加**适配器**，不要把数据层改成别的写法。

---

## 18. 装备与伤害体系（12 号任务书 E0–E7 重构后的硬约定）

> 来源：[`ai-docs/12-装备与伤害体系重构任务书.md`](ai-docs/12-装备与伤害体系重构任务书.md)。
> **P1：不做存量兼容**（当前无真实玩家、测试号可删号重开）；`idle_dark` 清库用 `DELETE FROM users;`。

### 18.1 装备槽与副手判定：唯一真相在 `@idle-dark/protocol` 的 `equip.ts`

- 装备位有 **9 个**：`weapon / offHand / plastron / gloves / belt / boots / amulet / ring1 / ring2`
  （**箭袋属副手，不是第 10 槽**）。
- `GoodData.position` 使用同一联合；`GoodData.equipCategory` 标武器类别：
  主手 `oneHand | twoHandMelee | bow`，副手专属 `shield | quiver`。
- `canEquipOffHand(main, off)` 是**前后端共用的唯一判定表**（禁止在 server/web 各写一份）：
  主手空→盾/箭袋；单手→双持/盾（禁箭袋）；双手近战→锁定；弓→箭袋（禁盾）。
- `Player.equip(slot)` 返回 **boolean**：判定表拒绝或副手腾不出空位时为 `false`；
  单手武器在主手已占且副手空时自动落副手（双持）；双手武器落主手前把副手挪回背包；
  戒指在两个戒指槽里取第一个空的。`opEquip` 必须处理 `false`（抛 `INVALID_PARAM`）。
- `EQUIP_SLOTS`（`career-info.ts`）与 `EQUIP_POSITIONS`（protocol）是同一份；server 面板槽位
  走 `slot-ref.ts` 自动覆盖。前端只渲染协议常量，不硬编码槽位。

### 18.2 品质三档（P4）

- `protocol` 的 `Quality = 0|1|2`（普通 / 优秀 / 传奇），`QUALITY_NAMES` 是值导出；
  ui-kit 镜像 `QUALITY_LABELS` 并由 `game/quality.test.ts` 做一致性门禁。
- `BASE_QUALITY_RATE = [1, 0.5, 0.005, 0]`（长度绑定最大品质，2 档分别为 ~49.5% / ~0.5%）。
- ⚠️ `UnitStateDto.quality` 是**敌人词缀条数**（`EnemyUnit.quality`，可 >2），与装备 `Quality`
  **同名不同义**，类型是 `number` —— 不要把它夹到 0..2。

### 18.3 词缀前后缀骨架（P5，只做预分类）

- `AffixData.affixType?: 'prefix' | 'suffix'`（缺省 prefix）+ `tag?: string`；
  不变式：**同一 tag 只归属前缀或后缀之一**（`data/index.test.ts` 有门禁）。
- `generateEquip` 按**前后缀分池**抽取：普通 1+1、优秀 3+3、传奇 3+3 + 末尾 1 条传奇
  （传奇词缀**豁免**前后缀规则）；某侧候选不足时按可用数抽取，整池为空才抛错。
- `GoodData.affixGroup` 是「底材 → 词缀池」的挂点：`affixPoolOf(tables, goodData)` 优先查
  `DataTables.affixGroups[group]`，未命中回落全池。具体分组分布下期（P5）。

### 18.4 伤害类型与元素分类（P6/P7）

- 唯一真相 `game-core/src/rules/damage.ts`：元素 = `fire/cold/lightning`；
  物理 = `melee`；**混沌 `chaos` 非元素**（`allResist` 不作用于它）。
- `battle-world.sendDamage` 的护甲/抗性分支收口到 `mitigationKindOf`，**禁止**再散落
  `camelCase(type + '-resist')` 判定。
- **附加元素伤害本期未开工**（P6）：不要给 `GoodData`/`InventorySlot` 加半成品元素字段。

### 18.5 词缀作用域二元划分与双持（P12）

- **区域词缀**（武器 / 副手）：只在该武器出手时生效。`rebindEquipmentHooks` **不挂** weapon/offHand；
  `PlayerUnit.weaponAffixAttr(slot, key, value)` 按手叠加到该手武器底材值上。
- **全局词缀**（防具 / 饰品）：沿用 `addAttrHook` 挂 Unit。
- 按手取值：`atkOf / atkSpeedOf / critRateOf / critBonusOf / leechOf / hpFromKillOf`
  （默认主手）。**攻速基准取自该手武器底材**，双持总节奏**不等于**两把武器攻速之和。
- 双持交替：`PlayerUnit.activeHand` + `setAttackCoolDown`（冷却取当前手攻速、并清除未到期旧计时器）
  + `onAttackCoolDown`（冷却结束换手）；非双持恒用主手。

### 18.6 掉落与商店（P8/P10/P11）

- 怪物与副本**都不再产装备**（184 条 equip 掉落条目已物理删除）；数据门禁断言「无 equip 掉落」。
- **工艺通货 12 种 + 精华 6 种**（实装，全部 `type:'material'` + `stack`）：
  - 通货 key `currency.<code>` = `transmute/alchemy/chaos/scour/annul/blessed/exalt/ember/wisp/divine/fracture/mirror`
    （取自修仙设计稿，**不含 `vaal` 瓦尔宝珠**）；`description` 写有效果说明，但**炼器效果尚未接线**（下期 P9）。
  - 精华 key `essence.<code>` = `atk/spirit/def/hp/regen/insight`（按前后缀 + 词缀族定向）。
  - 精华槽共 12 个：`essence.07..12` 是**空位**（下期实装，**不参与掉落**）。
- 掉落速率表在 `data/index.ts` 的 `CRAFT_DROP_RATES` / `ESSENCE_DROP_RATES`，`registerCraftDrops(tables)`
  接线（地图通关 = ×`MAP_DROP_MULTIPLIER`）。稀有度口径：**`mirror` 最低（控制持有量）**，
  `divine` / `fracture` 高于它且是**大额交易通货**，其余按序递减；**`count` 一律 `[n,n]` 数组**
  （`battle-world.loots` 对 `count` 只认数组，标量会算出 0）。改数值只动这张表。
- 0 级地图 `town` 与 `baseCatalogOf(tables)`（数据驱动底材目录）是商店入口骨架；
  底材目录与购买 Action 下期（P8）。`lootRule` 域因装备不再掉落而**休眠**（未删除）。

