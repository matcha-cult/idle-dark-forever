# AGENTS.md —— idle-dark-forever 工程约定

> 面向在本仓库工作的 AI 代理与工程师。**新增环境坑或约定时在此追加一节，不要删旧节。**
>
> ⚠️ **本文档有注入字节预算（约 64KB），超出部分会被静默截断** —— 新节必须写短，
> 细节一律放 `ai-docs/*` 并在本节留指针；追加后用 `wc -c AGENTS.md` 自查。
>
> **已外迁的详版**（2026 精简，65KB → 34KB）：§5.2/§17 → [`ai-docs/22`](ai-docs/22-框架坑与内核视图门禁.md)、
> §7/§10 → [`ai-docs/17`](ai-docs/17-环境坑与沙箱实操.md)、
> §11/§12 → [`ai-docs/20`](ai-docs/20-拾取规则与剧情沿革.md)、
> §14/§15 → [`ai-docs/21`](ai-docs/21-推送频率沿革与会话归属.md)、
> §16.1/§16.2 → [`ai-docs/23`](ai-docs/23-逻辑服边界详解.md)、
> §18 → [`ai-docs/18`](ai-docs/18-装备与伤害体系约定.md)、
> §19 → [`ai-docs/19`](ai-docs/19-钱包地图混沌仪约定.md)、
> §20.7/§20.8/§20.10/§20.11 → [`ai-docs/24`](ai-docs/24-推送观测与实测数据.md)。
> 内联保留的都是**动作性硬约定**（§1–§5.1、§6、§8–§16、§17 摘要、§20.1–§20.6/§20.9、§21）。

`idle-dark-forever` 是《永夜2016典藏重置版》（纯前端单机游戏，源仓库 `/home/nbb/projects/dark-forever-memorize`）
的**服务端权威重制版**：ionet-ts + NestJS 后端，React + Vite + Antd + MobX 前端。

设计与拆解见 [`ai-docs/00-重写总方案.md`](ai-docs/00-重写总方案.md)，
结构与接续点见 [`ai-docs/01-架构与接续指南.md`](ai-docs/01-架构与接续指南.md)，
后续任务书见 [`ai-docs/02-wave2-任务书.md`](ai-docs/02-wave2-任务书.md)，
交付状态见 [`ai-docs/04-交付状态与验收.md`](ai-docs/04-交付状态与验收.md)，
**未竟事宜（接续前先读这个）见 [`ai-docs/05-交接-未竟事宜.md`](ai-docs/05-交接-未竟事宜.md)**，
**容量基准与并发上限（实测数字 + 待拍板参数）见 [`ai-docs/06-容量基准与并发上限.md`](ai-docs/06-容量基准与并发上限.md)**，
**词缀池与掉落生成（27/3/24 条逐条清单 + 品质→条数 / 部位职业过滤规则）见 [`ai-docs/11-词缀池与掉落生成.md`](ai-docs/11-词缀池与掉落生成.md)**，
**战斗推送报文现状实录（消息地图 / 敌方单位下发链路 / 逐情况真实报文 / 频次与字节）见
[`ai-docs/25-战斗推送报文梳理.md`](ai-docs/25-战斗推送报文梳理.md)**。
**可复用脚本（容量基准 / 金样哈希 / 探针 / 环境工具 / 探究）见 [`ai-script/README.md`](ai-script/README.md)**。

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

---

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

---

## 3. 构建与验证

```bash
pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false

pnpm run build       # 显式拓扑：protocol → game-core → transport → ui-kit → server → web
pnpm run typecheck   # ⚠️ 需先 build（下游包从 dist 解析 @idle-dark/protocol）
pnpm run test        # 仅本仓 packages/*，不含 vendor
```

- 单包：`pnpm --filter <name> run build|typecheck|test`
- `server` 依赖 `game-core`/`protocol` 的 **dist**，所以**改了上游必须先 rebuild 上游**。

---

## 4. 冻结契约（并行开发期间只许加可选字段）

| 契约 | 位置 |
|---|---|
| 线协议 cmd 段 / DTO / 结果约定 / 错误码 | `packages/protocol/src/**` |
| 时间·随机·战斗事件端口 | `packages/game-core/src/contracts/ports.ts` |
| 数据表类型 | `packages/game-core/src/contracts/data.ts` |
| `game-core` 导出面 | `packages/game-core/src/index.ts` |

**前端不再手工镜像 cmd 常量**（这是相对参考实现 `idle-path-of-xiuxian` 的改进）：
`@idle-dark/ionet-transport` 直接依赖 `@idle-dark/protocol`。

---

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

### 5.2 框架已知坑与规避 → 详版 [`ai-docs/22`](ai-docs/22-框架坑与内核视图门禁.md)

六条必踩的坑（**`FlowContext` 必须值导入**，否则 `emitDecoratorMetadata` 退化 → **鉴权静默失效**；
裸 object DTO 一律 `{data:{…}}` 包装；`resolveAction` 走容器；生产须 `allowProduction`；
限流要自建；普通对象构造参数要给显式 DI token）—— 详见详版。

---

## 6. 新框架源码由 CI 挂载到 `vendor/ionet-ts/`

本仓库**不提交** `vendor/ionet-ts/`。`pnpm-workspace.yaml` 通过 `vendor/ionet-ts/packages/*`
把框架包纳入 workspace，所以**构建前它必须就位**。

- CI：`.github/workflows/ci.yml` 用 `actions/checkout` 把 `matcha-cult/ionet-ts`(dev) 检出到该路径。
- 本地：`ln -sfn /path/to/ionet-ts vendor/ionet-ts`
- **不要**在本仓库修改 `vendor/ionet-ts/`：框架改动须在框架仓库完成、提交、推送后再同步。

---

## 7. 环境坑（本机 DSH 沙箱实测）→ 详版 [`ai-docs/17`](ai-docs/17-环境坑与沙箱实操.md)

> 完整原文（§7.1–§7.9，含命令、实测与反面教训）已外迁，**动这些环境前先读**。下面是最高频几条：

| 场景 | 一句话 |
|---|---|
| SSH 到 GitHub 报 `Bad owner or permissions` | 沙箱 uid 假象 → `GIT_SSH_COMMAND='ssh -F /dev/null'`；**不要** chown/chmod `/etc/ssh` |
| pnpm 安装卡住 / store 只读 | `pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false`；**不要**在 `CI=1` 下跑 |
| 改前端 UI | **先用全局 `antd` CLI 查权威 props**（`--version 6.6.3`，见 `ai-docs/17` §7.3）；颜色只用 token |
| workspace 包报 `Cannot find module` | 必须在 `package.json` 声明 `workspace:*`；**不许软链绕过**，改完重跑 install |
| 浏览器看不到新代码 | Vite 会缓存工作区外旧版 → 先 `curl` dev server 的模块 + grep 新符号（§7.5） |
| 端口疑似被占 | **自己 bind 一次判定**，别信 `ss`；`/tmp` 每次调用都是新 tmpfs，日志写工作区 `tmp/` |
| 想复用脚本 | `tmp/` **只放临时产物**（日志 / 抓包 JSON）；可复用脚本一律进 [`ai-script/`](ai-script/README.md) 或 `packages/server/scripts/`（后者给需要 `ws`/`pg`/`@idle-dark/*` 的脚本，见该 README「为什么分两处」） |
| 端口默认值 | `dev.config.json` 是唯一真相（后端 3100 / 前端 5273）；前端 `strictPort: true` |
| 数据库 | 沙箱内装不了 PG，但外部实例可用（见 §10 与 `ai-docs/17` §7.7） |

⚠️ **不要 `pkill -f vite`**：跨 PID namespace 杀不到，且 3000/5173 是 `idle-path-of-xiuxian` 的服务。

---

## 8. 新增一个游戏域要改哪些文件
1. `packages/protocol/src/cmd.ts` —— 登记段与 subCmd（段宽 10、subCmd 从 1 起、0 保留）
2. `packages/protocol/src/dto.ts` —— 该域请求/响应类型
3. `packages/server/src/modules/logic/<domain>/` —— `*.action.ts`（只校验转发）+ `*.logic.service.ts`（门面编排）+ `internal/`（实现）
4. `packages/server/src/ionet/game-actions.ts` —— 登记 Action 类与 Module
5. `packages/ionet-transport/src/api/game-api.ts` —— 加 typed 方法（cmd 常量直接来自 protocol）
6. `packages/web/src/stores/<domain>-store.ts` + `packages/web/src/pages/game/panel-registry.tsx` —— 注册面板
7. 单测：纯规则放 `game-core`，编排放 `server`（用内存端口替身）

**纯前端域**（如「角色属性」）只走第 6 步 + 一个面板组件，不碰协议与服务端。
⚠️ **导航顺序 ≠ 默认落地页**：`DOMAINS` 的顺序是信息优先级，落地页由 `DEFAULT_PANEL_KEY`
显式给出 —— **不要**写成 `listPanelKeys()[0]`，否则「把某个域排到最前面」会顺手改掉默认面板。

---

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

## 10. 数据库：schema 是设计真相，运行期用原生 pg → 详版 [`ai-docs/17`](ai-docs/17-环境坑与沙箱实操.md)

- `packages/server/prisma/schema.prisma` = **设计真相**；`scripts/init-db.mjs` = **实际执行的 DDL**（幂等）；
  运行期用**原生 `pg`**，`src/` 内**禁止** import `@prisma/client`（prisma 只在 devDependencies）。
- **改表必须同时改这两处**（`pnpm run db:init` 执行、`prisma:pull` 核对漂移）。
- **本工程用独立库 `idle_dark`，绝不与 xiuxian 的 `idle_game` 共库**（`characters` 列定义不同，
  共库会被 `CREATE TABLE IF NOT EXISTS` 静默跳过）。清库用 `DELETE FROM users;`。
- 沙箱内跑 prisma 必须把 `HOME` 指到工作区 `tmp/`（`~` 只读，`XDG_CACHE_HOME` **无效**）。
- 端到端验收脚本与「3000 端口可能是别人的服务」的坑见 `ai-docs/17` §10.3。

---

## 11. 跨域硬约定：拾取规则编码（只允许一处定义）→ 详版 [`ai-docs/20`](ai-docs/20-拾取规则与剧情沿革.md)

- `Player.lootRule` 是 `Map<string, number>`，编码：`__enabled__` = 1 开 / 0 关；
  `c:${class}:${quality}` = `action`（0 拾取 / 1 出售 / 2 分解）或 `action + 10`（该条停用）。
- **唯一定义在 `game-core/src/rules/loot-rule.ts`**（`lootRuleKeyOf` / `parseLootRuleKey` /
  `encodeLootRule` / `decodeLootRule` / `lootRuleEnabledOf` / `lootRuleActionOf`）；面板与战斗**只消费**。
  **禁止在消费侧复制编码或判定逻辑** —— 曾两处各写一份、键格式与值类型双双漂移 → 面板设置静默失效。
- 判定顺序：全局关 → 一律拾取；显式规则命中且 `action !== 0` → 用该 action；否则回落 `minLootLevel`。
- ⚠️ **落地回调必须先把 slot 快照再 `player.loot()`**（`loot()` 会 `clear()` 传入的 slot，
  后读只能拿到空槽 → 推送与金币双双丢失）。

---

## 12. 剧情（quest / story）域：**已物理删除**（W2）

原「进图自动触发剧情」（`MapPanel.checkStories()` 移植）随 quest / story 逻辑服一起删除：
`story` cmd 段(100)、`MapEntered` / `EnemyKilled` 事件、`StoriesPanel` / `story-store`、
`story-entry-smoke.mjs`、`Requirement.stories` 均已移除。

- 删除清单见 [`ai-docs/19`](ai-docs/19-钱包地图混沌仪约定.md) §19.5。
- 旧实现原文存档在 [`ai-docs/20`](ai-docs/20-拾取规则与剧情沿革.md) —— **仅作参考，不要回引**。

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
  (`slime.giant`) 既看不见也点不动 —— 当时直接把一条主线任务卡死（那次教训之后，
  中立怪改为可点选）。这正是原版要教玩家的那条规则：「黄色名字的魔物不会主动攻击英雄们……
  但如果英雄主动攻击他们，他们就会加入战斗」。
- 中立怪不是"点一下就变敌人"，而是**首次受到伤害**时由
  `Unit.damage()` → `setTarget(from)` → `EnemyUnit.setTarget()` 把 `camp` 翻成 `enemy` 并反击
  （见 `unit.ts:602-614` 与 `enemy-unit.ts:455-460`）。
- 服务端 `battle.focus` 只拒绝 `ghost` 与不存在的目标，中立目标本就被允许 ——
  **别在前端把它过滤掉**。

---

## 14. `(world, tick)` 推送频率 → **已被 §20 取代**

旧设计「每 200ms 无条件推整份 `units` 快照、5 帧/秒」**已废弃**；现在是 §20 的 **200ms 累计制差分**
（无变化不发帧，实测 1.6~1.8 帧/秒，见 §20.7）。判断服务端是否在跑请看 `/api/metrics` 的
`world_push_*`（§20.6 / §20.7），**不要**再用「窗口内 0 帧」当断线判据。

仍然有效的部分（`__idleDarkTickRate()` 探针、`__IDLE_DARK__`、
「同一 `serverTime` 出现多次 ⇒ 一帧被投递多次」的排查表）见
[`ai-docs/21`](ai-docs/21-推送频率沿革与会话归属.md)。

---

## 15. 角色会话归属：一个账号同一时刻只有一个活跃角色 → 详版 [`ai-docs/21`](ai-docs/21-推送频率沿革与会话归属.md)

- 选角是 WS Action（`player.select` 20/6）；握手只认账号 → **每次握手成功 = 该账号回到「未选角色」**：
  `app.module.ts` 的 `authenticate` 里 **await** `WorldService.resetActiveCharacter(userId)`
  （停旧会话 + 清两个注册表 + `batcher.drop`；2s 超时保护）。不 await / 改成 flush 会漏帧或串号。
- `player.select` 是**切换**（`start(新角色)` 后 `stop(旧角色)`）—— 同一账号只有一个活跃世界会话。
- **归属校验唯一入口** `WorldService.resolveActiveCharacter(userId, rawKey)`：
  未选角 + 无 key → 失败（`NOT_IN_MAP`）；已选角 + 无 key / 空串 → 回退当前角色；key 相等 → 通过；
  key 不等 → 失败（`PLAYER_NOT_FOUND`）。`world.*` / `battle.focus` / `idle.*` 都走它，
  **不要再各写一份 `?? activeCharacterOf`**。
- 理由：框架 `sendNotification(userId, …)` 会发给该账号**全部 OPEN 连接** —— 允许多会话就会互相串号
  + 双份 tick 推送（实测过）。
- **刷新页面自动进入上次的角色**（前端缓存，详版 §15.2）：`player.select` 成功后落盘
  `{userId, key}`；`bootstrap()` 用 `resumePlayerKey()` 三重校验（形状 / 账号一致 / key 仍在角色列表）
  后自动 `player.select`。⚠️ **必须校验 `userId`**（换账号后误用别人的 key → `PLAYER_NOT_FOUND`）；
  登出 / 换账号 / 「切换角色」/ 角色被删**必须清缓存**；瞬时失败**不清**（下次刷新继续重试）。
  ⚠️ `App` 在 `session.restoring` 时渲染「正在恢复会话」——`setRestoring(true)` 必须在
  `bootstrap()` 第一个 `await` 之前，否则首帧会先闪一下**建角页**（那时 `players` 还空着）。
- 回归：`server/test/character-switch.test.ts`、`scripts/character-scope-smoke.mjs`（11/11）、
  `web/test/integration.test.ts`（缓存自动进入 9 例）、`web/test/ui-smoke.test.tsx`（顶层门 3 例）。
- ⚠️ **别在 `pnpm dev:server` 运行时手动 build**：watcher 会抢写 dist → 端口短暂不可用。

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

### 16.1 边界登记表是唯一真相（详版 [`ai-docs/23`](ai-docs/23-逻辑服边界详解.md)）

- 唯一真相：`logic-servers/registry.ts#SERVER_DEFINITIONS`。
  当前 **六服** = `external / battle / item / character / idle / map`
  （`idle` 兼持 `idle(120)` + `chaos(140)`；旧 `quest` / `dungeon` 已删除）。
- 跨服事件（`modules/logic/shared/events.ts`）**仅两条**：
  `CombatHooksDirty`（item / character → battle）、`ChaosRunEnded`（battle → idle）；
  总线 `EVENT_BUS` 是**进程内同步**实现，保持解环前的调用时序。

### 16.2 架构门禁（详版 [`ai-docs/23`](ai-docs/23-逻辑服边界详解.md)）

`test/logic-server-boundary.test.ts` 断言：文件级 SCC = 0、逻辑服级无环、
共享层不反向依赖任何逻辑服、**`TRANSITIONAL_DEEP_IMPORTS` 当前为空数组（禁止增长）**、
cmd 段唯一归属、每个 `*LogicServer` 里不得出现 `@ActionMethod`。
⚠️ 扫描器**先剥注释**再解析；动态 `import(变量)` 与无法解析的相对 import **显式报告**，不得静默通过。

### 16.3 容量不变式（07 §0，与逻辑服调度绑定）

- **I1**：世界时间 = 真实时间（`world_time_ratio ≥ 0.99`）；
- **I2**：任何「每轮处理 N 个」的循环必须**同时**给出全局预算与超载行为；
- **I3**：禁止静默降级（一切降频/截断/丢弃都要有日志 + 指标 + 明确动作）；
- **I4**：CPU 不是瓶颈，不得用「少 tick 几个角色」换吞吐；
- **I5**：每个限额都要能在 `/api/metrics`（或 `system.stats`）看到当前值。

---

## 17. `src/data/**` 的视图类型是「对内核的断言」→ 详版 [`ai-docs/22`](ai-docs/22-框架坑与内核视图门禁.md)

- `contracts/data.ts` 把数据表函数的 `this` / `world` / `self` 冻结成 `unknown`；为让原版数据文件
  保持原样过 `strict`，`src/data/_shapes.ts` 声明了一层「视图接口」。
  **视图比真实内核多写一个成员时 `tsc` 不会报错** → 缺陷延到运行期，且被 tick / 离线结算的
  `try/catch` 吞成一条 WARN = **静默失效**（已发生三次：`UnitLike.timeline`、
  `WorldLike.sendGeneralMsg`、`SkillStateLike.summoner`）。
- **编译期门禁** `src/data/_shapes.gate.ts`（`MissingOn<View, keyof Kernel>` + `AssertNoMissing`）：
  视图再撒谎，`pnpm run typecheck` 就报 `TS2344` 并**点名成员**。
- ⚠️ 门禁文件**不可**命名为 `*.test.ts`（`game-core` 的 tsconfig `exclude` 含 `src/**/*.test.ts`，
  放进去就是**假门禁**）；多类目标要传**并集**（`keyof (A | B)` 是**交集**，会误报子类独有成员）。
- 移植数据：原版属性在本仓改名就写**新名**；「原版 `world.*` 但内核没有」的调用
  （如 `sendSkillUsage` / `sendGeneralMsg`）一律在 `BattleWorld` 上加**适配器**。

---

## 18. 装备与伤害体系（12 号任务书 E0–E7 后的硬约定）→ 详版 [`ai-docs/18`](ai-docs/18-装备与伤害体系约定.md)

- **装备槽 9 个**（箭袋属副手，不是第 10 槽）：唯一真相是 `@idle-dark/protocol` 的 `equip.ts`；
  `canEquipOffHand(main, off)` 是前后端**共用**判定表（禁止各写一份）；`Player.equip()` 返回 boolean。
- **品质三档** `Quality = 0|1|2`（普通 / **稀有** / 传奇），`BASE_QUALITY_RATE = [1, 0.5, 0.005, 0]`。
  ⚠️ `UnitStateDto.quality` 是**敌人词缀条数**（可 >2），与装备品质**同名不同义**，不要夹到 0..2。
  ⚠️ 档位 1 的**玩家文案是「稀有」**（`game-core` 内部注释仍叫「优秀」，只是内部代号）——
  展示文案的唯一真相是 protocol `QUALITY_NAMES`，ui-kit 镜像由门禁测试逐字比对。
- **稀有度视觉**：`普通` **不显示徽标**（`RarityTag` 返回 `null`；需要文字的场景传 `showCommon`）。
  稀有 `#ffff77` / 传奇 `#ef6916` 是**徽标底色**（实色块 + 深色字），**两种主题完全一致** ——
  换主题只换**名称文字**（亮色主题用同色系深色变体，否则 `#ffff77` 对白底 1.06:1 看不见）。
  色板放**应用层**（`web/src/theme/rarity-palette.ts`），ui-kit 只提供 `RarityPaletteProvider` +
  `useRarityColor`（`{name, chip, chipText}`）契约 —— 因为 ui-kit 有「源码零内联 hex」硬门禁。
  ⚠️ **徽标底不要跟着主题变**（曾把亮色主题的徽标底也换成 `#7a6c00`，观感与设计色差太远）。
  ⚠️ **不要**改回 antd `Tag color={hex}`：那条分支会把背景按 HSL 亮度 0.95 提亮、文字设成同一个色，
  `#ffff77` 会变成「浅底浅字」完全看不见。详见 `ai-docs/18` §18.2。
- **词缀**按前后缀分池（普通 1+1 / 稀有 3+3 / 传奇 3+3+1，传奇词缀豁免前后缀规则）；
  不变式：同一 `tag` 只归前缀或后缀之一（有门禁）。
- **元素 = fire/cold/lightning；物理 = melee；混沌 chaos 非元素**（`allResist` 不作用于它）。
  唯一真相 `game-core/src/rules/damage.ts`；护甲/抗性分支收口到 `mitigationKindOf`，
  **禁止**再散落 `camelCase(type + '-resist')` 判定。
- **词缀作用域二元划分**：武器 / 副手 = **区域**（只在该手出手时生效，按手取值
  `atkOf` / `atkSpeedOf` / `critRateOf` / …，双持交替走 `activeHand`）；防具 / 饰品 = **全局**
  （`addAttrHook`）。**攻速基准取自该手武器底材**，双持总节奏 ≠ 两把武器攻速之和。
- **掉落**：怪物与副本**都不再产装备**（184 条 equip 掉落已物理删除，有门禁）；改为通货 12 种 +
  精华 6 种（规格表 `CRAFT_DROP_SPECS` / `ESSENCE_DROP_RATES`，`count` **一律 `[n,n]` 数组**，
  标量会算出 0）。等级门槛在**消耗 RNG 之前**判定。默认背包 **50 格**（原版 4 格）。
- **掉落必须如实上报**：`Player.loot(good)` 返回**实际入包数量**，`lootGood` **先落地再上报**；
  放不下 → `handled:'lost'`（前端提示「包裹已满」，`BattleCollector` 跳过）。
  ⚠️ 不要改回「先发事件后落地」—— 会出现「弹了获得提示但背包里没有」。

---

## 19. 钱包 · 新地图 · 混沌仪（13 号任务书 W0–W7 后的硬约定）→ 详版 [`ai-docs/19`](ai-docs/19-钱包地图混沌仪约定.md)

> 本节覆盖更早文档里关于「剧情 / 氪金秘境 / 旧地图」的旧描述 —— 那些系统**已物理删除**。

- **钱包（R1）**：`GoodData.wallet` 标记的通货 / 精华**不占背包格**、无容量上限、永不 `handled:'lost'`；
  普通材料仍占背包；**混沌钥石不进钱包**。DTO 带 `wallet?`，**前端零推导**。
- **新地图（R2 / W11）**：`world.1`…`world.13`（等级 1/5/15/25/35/45/55/65/75 + 85×4 张）；
  ⚠️ **解锁链只用 `bossKilled`**（`world.1` 无门槛，`world.N` 需先击杀上一段守关 BOSS，
  85+ 四张统一接 `world.9`）。**不要把 `level` 放回解锁条件** —— `MapEntry.level` 同时是
  怪物等级覆写来源，一旦它又是门槛，解锁线就正好落在经验衰减零点上（历史上因此整条推进链
  不可达：`world.2` 实测 13→14 需 21228 次击杀）。`level` 只作**内容/建议等级**。
  上限 **100 级，巅峰已删**。统一 `total = 4` / `max = 4`；**刷怪闸门是
  `Born.aliveMonsterCount()`（全图存活敌对怪，排除 ghost、排除玩家/联军召唤物）**，
  不是 `this.count`；到达上限**保持轮询**，有怪死自动恢复（绝不永久停刷）。
- **波次里程碑（W11）**：**开荒**（`bossPending`）= 第 10 波精英 + 第 20 波守关 BOSS，各一次；
  **挂机**（已通关）= 每 10 波一只精英、**不再出 BOSS**；**混沌图** = 每 20 波 BOSS（可重复刷）、
  **不出精英**。守关 BOSS 用显式 `worldBoss` 标记，**不要用 key 比较**（`slime.queen` 既可能是
  某图 BOSS 又是另一图普通怪）。
  ⚠️ **闸门是「目标波 + 已交付记录」（`EnemyBorn.ensureMilestones`），不是 `wave % N === 0`** ——
  取模在会话恢复后必然错过窗口（旧实现恢复到第 20 波要等到第 40 波）。野外 BOSS 的判据是
  「`bossPending` 且场上没有 BOSS」⇒ **恢复到第 20 波会当波补刷**；混沌 BOSS 按 20 波窗口记
  `lastBossWave`（否则杀掉后每波重刷）。`completeWave()` 与会话恢复都要调 `ensureMilestones()`。
- **守关 BOSS 在场 ⇒ 停刷杂兵（W12）**：`Born.onTimer` 在原有两条闸门（本图同屏上限 / 全局单位
  硬顶）**之前**先查 `BattleWorld.hasWorldBossUnit()`，BOSS 在场则**一只杂兵都不刷**；与那两条一样
  **保持轮询**，BOSS 一离场自动恢复，不需要任何人重置状态。
  ⚠️ 口径是「**存在**」（含已死未清尸的 `ghost`）—— 与混沌 `clear` 等掉落用的是**同一个**判定，
  但**消费意图不同**（那里等结算，这里拦刷怪）。⇒ BOSS 死后要等清尸（默认 3s）才恢复刷杂兵。
  ⚠️ **副作用（产品已接受）**：BOSS 波期间 `Born.total` 恒达不到 `config.total` ⇒
  `isWaveComplete()` 不成立 ⇒ **波数冻在 BOSS 那一波**。这是「BOSS 波只有 BOSS」的代价，
  由下一条的「通关自动重开」收口。
  ⚠️ **已知尾巴 —— 历史：W12 时曾有，v4.2 换池后消除**：当时 BOSS `chapter3.beast.pengpeng`
  （world.11）携带 `simba.goodFriends`，其 `willClean` 在「仍有兄弟存活」时返回 `false` ⇒ 尸体
  **不挂清尸计时器**，而同池就有携带者 `chapter3.beast.dingman` ⇒ 必须把剩余兄弟也清掉才恢复。
  v4.2 换池后 world.11 的池里**不再有携带者**、新 BOSS 也**不继承**该 buff ⇒ 尾巴消失（详见
  [`ai-docs/19`](ai-docs/19-钱包地图混沌仪约定.md) §19.9）。
  ⚠️ **只拦守关 BOSS**：精英（`elite`，每 10 波保底）与敌方**召唤物**都不拦 —— 后者走
  `data/skills.ts` 的 `addEnemy(..., summoner)`、不经刷怪闸门，拦它等于废掉 world.4/6/8 三只
  BOSS 的看家技能（`wolf.call` / `candle.call` / `necromancer.ghostShield`）。
- **守关 BOSS 唯一化 + 传奇化 + 三合同族（v4.2）**：新数据在 `data/map-bosses.ts`
  （`mapBosses` 29 = 13 野外 `boss.world.NN` + 16 混沌 `boss.chaos.TNN`；`mapMobs` 8 条新普通怪），
  `data/index.ts` 合并进 `enemies`（**只改这一行**）。**P5 只加不改**：`enemies.ts` 逐字不动、
  旧 BOSS 留作**未被引用**的遗留；新条目带 `originKey` 溯源。**P6 三合一**：地图名（主题）=
  普通刷怪池 = 守关 BOSS。门禁 7 条在 `data/spawn-eligibility.test.ts`（唯一 / 不入池 / 数值地板 /
  单调 / 可战性 / 不抬人名 / 同族，各带反向用例）。⚠️ **数值地板只对 13 张野外图强断言**；
  混沌 ATK 地板豁免 T4/T5/T6（池里的 `chapter3.murloc.slaves`，§9.3 Q2 拍板不动）。
  详见 [`ai-docs/19`](ai-docs/19-钱包地图混沌仪约定.md) §19.9。
- **通关后自动重进本图（W11 决策 3 的另一半）**：`EnemyUnit.kill` 在非混沌图登记通关后调
  `world.noteWorldCleared()`；服务端 `WorldService.handleRunReset` **等该 BOSS 清尸**再
  `resetOpenWorldRun()`（波数归 0 ⇒ 因 `bossPending` 已翻 `false` 而自动转挂机节拍）。
  ⚠️ **必须等清尸**：掉落 / 钥石在 `clean()` 结算，提前重开会 `dispose()` 清尸计时器 → **吞掉落**。
  ⚠️ 与**阵亡重开（决策 4）相反：不等清尸** —— 阵亡时 BOSS 通常还活着，等它就是永不重开。
  两个触发源共用一个消费者 `handleRunReset`；离线侧同语义实现在 `applyRunResets`
  （`idle-logic.service.ts`），否则「带着打不死的 BOSS 下线」会因停刷杂兵而**离线收益≈0**
  （外推乘的是模拟区间的速率）。
- **怪物稀有度四阶（W11）**：`普通 / 稀有 / 精英 / 传奇` = `quality 0/1/2` + 守关 BOSS。
  唯一实现 `combat/enemy-rarity.ts`（`enemyRarityOf` / `clampEnemyQuality`）；服务端只序列化。
  **等级偏移 = `mapLevel + min(quality, 2)`**（普通 +0 / 稀有 +1 / 精英 +2 / BOSS +2）。
  第 10 波精英 = 强制 `quality = 2`（两条词缀 ⇒ `maxHp`/`exp` ×4），并**额外必掉一条通货/精华**
  （`BattleWorld.lootEliteGuaranteed`：从该怪 `loots` 里筛 `wallet === true` 的 `key` 条目，
  按 `rate` 加权抽一条并强制 `rate = 1`；钱包物品**不占格、永不丢失**，所以"必掉"是真保证）。
  ⚠️ `quality` 是**敌人词缀条数**，与装备 `Quality`（3 档）**同名不同义**；
  **禁止前端拿 `boss`/`elite`/`quality` 自己拼档位** —— 用服务端下发的 `UnitStateDto.rarity`
  （与 `alive` 同一先例）。`quality` 入构造器前会做安全化（`Infinity` 曾导致词缀循环
  一路 push 到 `RangeError`）。
  **展示唯一渲染处是 ui-kit 的 `UnitCard`**（用 `UnitRarityTag`，文案表 `UNIT_RARITY_LABELS`
  与协议逐字比对）：
  ⚠️ **一只单位只允许一个档位徽标**。`UnitCard` 曾经渲染 `<RarityTag quality={unit.quality} />` ——
  那是把词缀条数当装备品质，会把「两条词缀的精英怪」画成**传奇**、与真 BOSS 撞色，
  于是同一只怪身上同时出现「传奇 + 精英」（用户截图报的就是这个）。**不要**在
  `UnitCard` 之外再贴一遍档位标签，也**不要**给守关 BOSS 另贴「守关 BOSS」—— 它的档位就是传奇。
- **通关清算（W11）**：击杀本图守关 BOSS **首次**时一次性发放 `MapEntry.exp`（原版秘境口径，
  此前是死字段）。**必须先读 `hasWorldBossKilled` 再 `markWorldBossKilled`** 才不会重复发奖；
  混沌图不发（可重复刷，不属于 `worldBossKilled` 链）。`expRate` / `expInc` / `expMul` 照常生效。
- **野外阵亡即重开（W11）**：任意波次阵亡 → 本图 run 重开（`wave = 0`、里程碑复位、清场），
  **不加任何护栏**（产品拍板：系统不为玩家做选择）。`PlayerUnit.kill()` 只置位
  `openWorldDeath`，由 `WorldService.tick` 调 `resetOpenWorldRun()` 落实（复用「重复进图 = 重置本图」
  同一条路径，**不销毁会话**）。混沌图走 `chaosOutcome = 'death'` 分支，不置位。
- **世界侧车（W11 / C6）**：`account_state.data.worldMaps[charId]` =
  `{ map, wave?, lastEliteWave?, lastBossWave? }`。**读写只能走
  `shared/world-map-state.ts`**（`parseWorldMapState` / `writeWorldMapState` /
  `writeWorldMapKeepingProgress`）—— 曾经 `WorldService` 与 `IdleLogicService` 各拼一份对象字面量，
  后者少写 `wave` ⇒ **每次登录波数归零**。离线结算**不推演波次**，只保留进度
  （并把已交付里程碑喂给离线模拟，避免重复交付精英/BOSS）。
- **`bossPending`（BOSS 还会不会出）是唯一判据**：`BattleWorld.bossPending`
  （无 `boss` 数据的图 / 野外图已通关 → `false`；混沌图可重复刷 → `true`）。
  刷怪闸门 `EnemyBorn.trySpawnWorldBoss` 与 UI 的「距守关 BOSS N 波」**读同一个 getter**，
  因此「UI 说还会出」与「引擎真的会刷」不会漂移。
  服务端经 `WorldTickDto/WorldSnapshotDto.bossPending` 下发（翻转也算一次变化、合并取**最新**帧）；
  前端 `world.bossPending === false` 时**整条 BOSS 文案都不显示**（含「守关 BOSS 现身」），
  ⚠️ **不要再按 `wave % bossEvery` 直接显示倒计时** —— 通关后那个倒计时永远不会到来。
- ⚠️ **经验不做等级差衰减**（W10 已移除）：`PlayerUnit.gotExp` 曾按 `dis = min(自身等级, 70) − 怪物等级`
  每级递减 10%、`dis ≥ 10` 时**归零**；那道窗口恰好等于段位宽度（解锁门槛 = 上一段内容等级 + 10），
  于是**越接近解锁线经验越低、到线归零**，整条推进链事实上不可达（`world.2` 实测 13→14 需
  21228 次击杀 ≈ 5300 波，全库 388 角色无一自然推进过 `world.2`）。
  平衡现由**怪物经验分布**（`enemyData.exp` × `2 ** quality`）+ `expRate` 承担 ——
  **后期调整经验曲线不要再引入等级差系数**。`gotExp` 的第二个参数（怪物等级）保留为
  冻结端口契约的一部分，但**当前不参与任何计算**。回归见 `combat/exp-no-level-penalty.test.ts`。
- ⚠️ **刷怪池必须按真实数值 + 阵营挑选**（不能只看 `level`）：普通怪与 BOSS 必须 `camp:'enemy'`
  且非 `onPress` 机关 —— `neutral` 不会自动索敌（挂机卡波次）、`alien` 玩家根本打不到；
  且 BOSS 的 HP 不得低于本图普通怪。`data/spawn-eligibility.test.ts` 是门禁。
- **混沌钥石（R3 / W5）**：`keystone.t01`…`t16`（材料、可堆叠、**不进钱包**）；**仅地图 `level >= 85`**
  掉落，单怪最多掉自身阶 + 1，掷阶 `P(cap)=0.75`；全程走 `rng.loot`，**禁止 `Math.random()`**。
- **混沌仪（R3 / W6）**：`chaos.t01`…`t16`（等级 = 84 + T）；解锁 = 通关全部野外 BOSS；
  状态机唯一实现在 `logic/chaos/internal/chaos-ops.ts`（在线 / 离线共用）。开图 UI 只显示 T 阶，
  混沌图从 `map.list` 过滤且普通 `map.enter` 一律 `MAP_LOCKED`。
  ⚠️ **`clear` 必须等守关 BOSS 清尸（掉落结算）后**才上报，否则换图会 dispose 清尸计时器、吞掉落。
- **已物理删除，不要回引**：quest / story 域、旧氪金秘境（`nightmare.*` / `dungeon` 队列 / 挑战券）、
  巅峰等级体系、旧 `data/maps.ts`。完整清单见详版 §19.5。

---

## 20. 战斗推送通道：200ms 累计制（P2 切流后的硬约定）

> 来源：[`ai-docs/16-战斗推送通道-累计制.md`](ai-docs/16-战斗推送通道-累计制.md)。
> 本节覆盖 §14 里「每 200ms 无条件推整份 `units` 快照」的旧描述 —— 那个行为**已废弃**。
> **逐情况的真实报文（18 种，含 `reset`/`add`/`chg`/`del`/死亡/升级/掉落/波次推进）与频次字节实测
> 见 [`ai-docs/25-战斗推送报文梳理.md`](ai-docs/25-战斗推送报文梳理.md)**。

### 20.1 一句话模型

> **状态是采样（净差分，5Hz 采样率），日志是全保真（逐条、有序、同帧送达）。**

200ms 是一个**累计窗口**：窗口内所有产出（状态变化 + 日志 + 掉落 + 经验金币）合并，
**窗口末无净变化 ⇒ 整帧不发送**（不是发空帧）。因此每 200ms **至多 1 条** `(world, tick)`。

### 20.2 帧形状（`WorldTickDto`，`(world, tick)` = 30/5）

`patch`（有序单位补丁）+ `log` + `loot` + `gainedExp/gainedGold` + `wave/bossEvery` + `seq`。

- `patch: UnitPatchOpDto[]`：`reset`（清空重填，基线）/ `add`（**完整**单位，含标识字段）/
  `chg`（**仅变化字段**）/ `del`（**从单位表移除**）。客户端**必须按序应用**；同批合并 = 数组直接拼接。
- `units` / `events` 是**冻结契约里保留但停填**的字段：恒为 `[]`（历史包袱，20B/帧；
  删除需显式批准）。
- 掉落**并帧**（`loot` 分区），不再走 `(battle, loot)`(40/2)；`(battle, log)`(40/1) 从未被服务端使用。

### 20.3 可变字段白名单是唯一真相

唯一实现在 `packages/server/src/modules/logic/world/internal/unit-state-diff.ts` 的
`MUTABLE_UNIT_FIELDS`（**17 个**）：

```
hp mp rp ep comboPoint targetId castingProgress buffs camp
level maxHp maxMp maxRp maxEp exp maxExp attributes
```

其余字段（`id/kind/typeKey/name/quality/boss/elite/rarity`）**出生即固定**，只在 `add`/`reset` 里出现一次
—— 这部分占单个单位 DTO 的 **64%**（170B/264B），是优化的主要来源。
（`elite` / `rarity` 是 W11 新增的怪物稀有度字段，见 §19；二者都是出生字段，**不进白名单**。）

⚠️ **`camp` 必须在白名单里**：① 死亡 `enemy → ghost`（`unit.ts#kill()`）；
② 中立怪被攻击参战 `neutral → enemy`（`enemy-unit.ts#setTarget`）。
⚠️ `buffs` 必须**归一化后比较**（按 `key` 排序），否则数组顺序抖动会让静默率归零。
⚠️ **玩家单位不是「出生即固定」**：第二行只有玩家会变（升级 / 换装 / 词缀 / 强化），
对敌人恒定 ⇒ 无额外流量。判定标准是「**对所有单位**都不变吗」，不是「对敌人不变」——
把 `level` / `maxHp` 当静态的后果是升级后客户端等级与血条上限**永远停在出生值**
（血条被夹到 100%，看起来像血一直满的）。
⚠️ `exp` **不得塞进 `attributes`**：经验每次击杀都变，塞进去会让整份属性对象（约 400B）
跟着每帧重发；独立字段只多约 20B，且它变化时 `gainedExp !== 0` 本就已触发一帧。
属性面板契约（展示投影 + 与原版的三处刻意偏离）见 [`ai-docs/18`](ai-docs/18-装备与伤害体系约定.md) §18.7。

### 20.4 死亡 ≠ 移除（最容易搞错的一条）

引擎里对象死亡后**仍留在 `world.units`**：

| 事件 | 表现 | 推送 |
|---|---|---|
| 死亡 | `Unit.kill()`：`camp → ghost`、`hp ≤ 0`、`targetId → null`、清 buff、清读条 | 一帧 `chg { alive:false, hp:0, camp:'ghost', … }` |
| 清尸 | `EnemyUnit.clean()` → `world.removeUnit`（默认**死亡后 3000ms**；`willClean` 钩子为假时**可能永不触发**） | 一帧 `del` |

- `alive?: boolean` 由服务端按 `camp === Camps.ghost` 派生（`unit-state.ts`），**前端零推导**；
  前端判死唯一入口是 `world-store.ts#isDead()`（`alive` → 回落 `camp === 'ghost' || hp <= 0`）。
- `hp` 在投影里**夹到 `>= 0`**（`Unit.damage` 只做 `hp -= v`，阵亡瞬间可为负）。
- `aliveMonsterCount()` **排除 ghost**：尸体不占刷怪名额、不卡波次。
- 差分协议**不得假设「每个 add 最终必有 del」**。

### 20.5 静默抑制与丢帧自愈

- **无变化不发帧**：判据唯一实现在 `unit-state-diff.ts#worldFrameOf()`（返回 `null` = 不发）。
- **累计器只在真的入队成功后才清**（`collector.snapshot()` 取、`drain()` 清）——静默窗口若误清，
  会**永久丢失日志与经验**。
- **入队失败（batcher 丢弃）⇒ 不前进基线、不清累计器**：下一窗口重发，客户端自动追平。
  这取代了「依赖 batcher `onResync` 补推」的方案（`NotificationBatcher.enqueue` 的返回值就是信号）。
- 客户端**不需要 seq 断链检测**（WS 有序可靠 + 服务端自愈）；`seq` 只用于观测与调试。
- 客户端若收到指向未知 id 的 `chg`（基线错位），由 `world-store#applyPatch` **主动重拉快照**自愈
  （I3：不允许静默降级）。

### 20.6 无变化 ⇒ 不推送 ⇒ 保活与对时

**不发明心跳帧**（那会违反「无变化不推送」）。保活走 WS 协议层 ping + 应用层 `system.ping`(15s)；
时钟对齐复用 `system.ping` 响应里既有的 `serverTime`。

⚠️ `web/src/services/tick-rate.ts` 的探针语义已变：**帧率 ≤ 5/s 且可以为 0**，
「窗口内 0 帧」不再是「连接已断」。判断服务端是否在跑要看 `/api/metrics` 的 `world_push_*`。

### 20.7 观测与实测（详版 [`ai-docs/24`](ai-docs/24-推送观测与实测数据.md)）

- `/api/metrics` 必看：`world_push_frames_total`、`world_push_quiet_skips_total`（**设计行为**）、
  **`world_push_dropped_total`（> 0 即缺陷信号）**、`world_push_frame_bytes_max`、
  **`world_unit_cap_refused_total`（正常恒 0，> 0 即病态）**，以及 `push_flushed_total` /
  `push_dropped_total` / `push_resync_total` / `push_pending_*` / `push_max_routes_per_user` /
  `push_flush_interval_ms`（I5：限额必须可见）。
- 实测单连接带宽 **5.89 KB/s → 0.63~0.67 KB/s（约 9×）**，静默窗口 **62%~67%**；
  帧字节峰值 699B data / ~776B 线（**未**含 20 波 BOSS 波的最坏值）。完整表格见详版。

### 20.9 禁止事项

- ❌ 不要把 `units` / `events` 重新填起来（前端已不读）。
- ❌ 不要为「一次状态变化」直推一条消息（会退化成消息爆炸）；变化必须经 200ms 窗口累计。
- ❌ 不要在静默窗口 `collector.drain()`（会丢日志/经验）。
- ❌ 不要让前端从 `hp <= 0` 之类别的地方判死 —— 用 `isDead()`。
- ❌ 不要新增「无变化也发」的心跳帧。

### 20.10 单位硬顶 `MAX_UNITS_PER_WORLD = 32`（I2 的全局预算，详版 [`ai-docs/24`](ai-docs/24-推送观测与实测数据.md)）

- 常量为 `game-core/src/combat/battle-world.ts` 的 `MAX_UNITS_PER_WORLD`。
  **为什么需要**：BOSS 与技能召唤物能突破刷怪闸门且**无数量上限**，于是差分循环 `O(单位数 × 白名单长度)`、
  单帧字节、`lastSentUnits` 内存三者都无上界。
- **超载行为**（`BattleWorld.addEnemy`）：达顶 ⇒ **不注册进 `units`**，但仍**返回有效对象**并立刻
  `camp = ghost`（数据层的 `addBuff` / `runAttrHooks` 不会崩），同时 `refusedUnits += 1` 并发
  `general` 事件 `world.unitCap:<type>`（I3：**不许静默降级**）。
  ⚠️ **不要**改成 `unit.kill()`（会白挂 3s 清尸定时器）。
- **刷怪器必须先查再刷**：`Born.onTimer` 的条件是 `atMonsterCap() || world.atUnitCap()`，
  `trySpawnWorldBoss` 也先查 `atUnitCap()`。否则 `addEnemy` 的拒绝会让 `Born.count/total` 记账失真、
  该波永远无法判定完成。被挡住时**保持轮询**，怪死后自动恢复。
- **连续量（`remainMs` / `castingProgress`）**：按设计留在白名单里，但**实测 4 组场景收益均为 0
  → 决定不改绝对时间戳**（保留 `remainMs` 更贴合「前端零推导」）。前提与数据见详版。

---

## 21. 战斗日志与战斗数值（细节见 [`ai-docs/16`](ai-docs/16-战斗推送通道-累计制.md) §7/§8/§9）

- **文案逐句对齐原版** `dark-forever-memorize/src/logics/renderMessage.js`：伤害 =
  `{from}的{技能}对{to}造成了{N}点{类型}伤害。`（治疗 / 躲闪 / 死亡 / Buff / 经验 / 进图 /
  遭遇 / 昏迷 同理）。**不要自创语序**。
- **着色对齐原版** `renderMessage.less`：正文 `colorText` **不着色**，只给伤害数字上色 ——
  玩家打出 `colorError`(红) / 其它 `colorInfo`(蓝)；治疗 `colorSuccess`；暴击前缀加粗。
  片段模型 `LogSegment{tone,bold}`；**禁止整行着色**（会吞掉数字的红蓝）。
- **数值取整在展示层**（`formatLogValue` = `Math.round`，同原版）；**引擎保持浮点** ——
  在结算处取整会改平衡。金样判据看**事件哈希 `0x1dd67f6b` / 事件条数 27**（这两项只随推演变化）；
  状态哈希在 W11 因 `EnemyBorn.dumpState()` 新增两个里程碑字段而重录为 `0x3af5fd2f`
  （**快照形状变化、非推演变化**，见 `combat/golden.test.ts` 的留痕注释）。
- **`entries` 新在最前** ⇒ `<LogPanel>` 必须**截断丢尾部** + **`scrollTop = 0`**。
- **名字/阵营查历史注册表**（`nameOf`/`campOf`），别用 `world.units`；**技能名**用
  `event.skillName`，经验用 `exp.whoId`。
- `general` 的 `key:参数` 走 `formatGeneralText()`（未知前缀原样透出）。

---
