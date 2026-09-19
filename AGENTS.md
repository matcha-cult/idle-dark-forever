# AGENTS.md —— idle-dark-forever 工程约定

> 面向在本仓库工作的 AI 代理与工程师。**新增环境坑或约定时在此追加一节，不要删旧节。**

`idle-dark-forever` 是《永夜2016典藏重置版》（纯前端单机游戏，源仓库 `/home/nbb/projects/dark-forever-memorize`）
的**服务端权威重制版**：ionet-ts + NestJS 后端，React + Vite + Antd + MobX 前端。

设计与拆解见 [`ai-docs/00-重写总方案.md`](ai-docs/00-重写总方案.md)，
结构与接续点见 [`ai-docs/01-架构与接续指南.md`](ai-docs/01-架构与接续指南.md)，
后续任务书见 [`ai-docs/02-wave2-任务书.md`](ai-docs/02-wave2-任务书.md)。

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

### 7.7 沙箱内**没有**可供端到端验收的数据库（重要）
本机实测：只有 `psql` **客户端**，`/usr/lib/postgresql/18/bin/` 下**没有 `initdb` / `postgres`**；
`docker` 命令存在但 **daemon 不可用**（`/var/run/docker.sock` 不存在）。因此：

- **本地能验的**：`pnpm run build`、`pnpm run typecheck`、`pnpm run test`（纯逻辑单测）、
  以及**不依赖数据库**的服务端启动 + WS 线协议冒烟（`scripts/ws-protocol-smoke.mjs`；
  数据库不可达时 `/api/health` 会返回 `503 degraded`，这是**正确行为**，不影响协议层断言）。
- **本地验不了的**：`db:init`、角色存档读写、以及任何需要真实 `characters` / `users` 表的端到端链路。
  这些**只在 CI 跑** —— `.github/workflows/ci.yml` 已声明 `services: postgres`，
  并注入 `DATABASE_URL` / `JWT_SECRET`，构建后会执行 `db:init` + 线协议冒烟。
- 需要本地做依赖数据库的验证时，用**内存替身**实现 `DatabaseService` 的 `query` / `connect` 接口，
  写进 `packages/server/test/`，不要试图在沙箱里安装/启动 PostgreSQL。

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
| `DATABASE_URL` | PostgreSQL 连接串 |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | HS256 密钥与有效期 |
| `IONET_ALLOW_PRODUCTION` | 生产环境必须置 `true` 才允许启动 ionet 模块 |
