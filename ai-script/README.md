# ai-script —— 复用脚本索引

> 本目录收纳**仓库级/探究级**的可复用脚本（原本散在 gitignore 的 `tmp/` 里，等于随时会丢）。
> **服务端依赖型**脚本不在这里，见文末「[为什么分两处](#为什么分两处)」。
>
> 约定：脚本只读或只打印，**不改仓库源码**；需要落盘的一律写 `tmp/`（gitignore，见 AGENTS §7）。
> 需要数据库 / 运行中服务端的脚本，前置条件写在各节。

---

## 1. 性能与容量基准（`ai-docs/06-容量基准与并发上限.md` 的数字就是它们跑出来的）

| 脚本 | 干什么 | 怎么跑 |
|---|---|---|
| `bench-combat.mjs` | 单角色战斗 tick 的 CPU 成本（多规模 + 稳态两段） | `node ai-script/bench-combat.mjs` |
| `bench-maps.mjs` | 按地图/单位数的 tick 成本 | `node ai-script/bench-maps.mjs town.street home town.valley town.woods` |
| `bench-mem-payload.mjs` | 每会话堆内存增量 + 每帧字节 | `node --expose-gc ai-script/bench-mem-payload.mjs` |

三者都只读 `packages/game-core/dist/**`（**先 `pnpm --filter @idle-dark/game-core run build`**），
驱动方式与 `WorldService.tickSession` 一致（`clock.pause()` + `stepPaused(200ms, budget=2000)`），
所以数字可直接与线上对照。

## 2. 金样回归

| 脚本 | 干什么 | 怎么跑 |
|---|---|---|
| `golden-compute.mjs` | 复算金样事件哈希 / 状态哈希 | `node ai-script/golden-compute.mjs` |

固定种子（`20240919`）+ 30s 虚拟时间，输出 `stateHash`。**AGENTS §21 引用的金样哈希 `0xf7d493b3`
就是它的输出** —— 改了 `game-core` 推演后跑一次，哈希没变即证「推演未动」（实测：27 事件 /
`eventHash 0x1dd67f6b` / `stateHash 0xf7d493b3`）。

## 3. 环境工具

| 脚本 | 干什么 | 怎么跑 |
|---|---|---|
| `dev-takeover.sh` | 等你停掉自己的 3100/5273 后，自动以本会话的后台任务接管 `pnpm dev` | `bash ai-script/dev-takeover.sh` |

背景：`dev.config.json` 是 `strictPort`，端口被占时 Vite 直接失败；而用户那两个进程在别的
PID namespace 里本会话够不到也杀不掉（AGENTS §7），也不该另起一套到备用端口
（两个 `tsc --watch` 抢写 `dist` 会让 `node --watch` 反复重启，AGENTS §15.1）。
脚本的 `REPO` 是硬编码的绝对路径，换机器要改。

## 4. 探究脚本（`explore/`）

一次性问题的**可复跑**答案，都只读 `game-core` dist、不改仓库、不改库：

| 脚本 | 回答的问题 |
|---|---|
| `check-boss-respawn.mjs` | 会话重启后 `wave` 已过 20 但 BOSS 未击杀，BOSS 会在后续波次重刷吗？（结论：单位不入档 ⇒ 丢失，下一次要等 wave 40） |
| `check-world2-unlock.mjs` | `world.2` 挂到 20 波，守关 BOSS 会不会刷、击杀后 `world.3` 会不会解锁 |
| `check-exp-rate.mjs` | 13 级角色在 `world.2`（地图等级 5）的经验速率，判断「13 → 15 级」门槛是否现实可达 |
| `bench-offline-tick.mjs` | 若让**离线角色**也在服务端实时 tick，成本是多少（为「离线实时战斗」方案给量化依据） |
| `check-gains.mjs` | 仅靠时钟推进（不走 `WorldService.isOnline` 判断）角色是否真的涨经验/金币/掉落 |

运行：`node ai-script/explore/<脚本>.mjs`，参数见各脚本头部注释。
后两个连同设计稿一起构成「离线实时战斗（C3）」探究，结论见
[`../ai-docs/26-离线实时战斗探究稿.md`](../ai-docs/26-离线实时战斗探究稿.md)（**未采纳的探究稿**）。

---

## 为什么分两处

`ws` / `jsonwebtoken` / `pg` / `@idle-dark/*` 这些依赖**只存在于 `packages/server/node_modules`**
（pnpm 不把它们提升到仓库根）。Node 的裸模块解析是**按导入文件所在目录**往上找的，
跟 cwd 无关 —— 所以这类脚本放在 `ai-script/` 下会 `ERR_MODULE_NOT_FOUND`：

```
node ai-script/xxx.mjs            # ✗ 找不到 ws / @idle-dark/game-core
cd packages/server && node scripts/xxx.mjs   # ✓
```

（`tmp/frame-size.mjs` 之前就踩了这个坑：它在仓库根 `tmp/` 却 `import 'ws'`，
而 `ai-docs/06` 把它记成 `packages/server/tmp/frame-size.mjs` —— 两边都对不上，
等于一直是跑不起来的状态。本轮把它移进 `packages/server/scripts/` 后恢复正常。）

所以：

| 目录 | 放什么 |
|---|---|
| **`ai-script/`**（本目录） | 纯 Node / 只按**相对路径**读 `packages/*/dist` 的脚本 |
| **`packages/server/scripts/`** | 需要服务端依赖（`ws` / `jsonwebtoken` / `pg` / `@idle-dark/*`）或服务端 `.env` / `dist` 的脚本 |

`packages/server/scripts/` 现有：

| 脚本 | 干什么 | 前置 |
|---|---|---|
| `frame-size.mjs` | 从 live 服务器量 `WorldSnapshotDto` 的 JSON 字节（tick 帧主要成本） | 3100 在跑；会注册一次性账号 |
| `capture-tick.mjs` | 抓 90s 真实 `(world, tick)` 报文，按「帧形状」分类落盘 | 3100 在跑；会注册一次性账号 |
| `character-ops/grant-weapon.mjs` | 给指定角色塞一柄多属性测试武器（走引擎 `fromJSON/toJSON`，形状与线上一致） | `DATABASE_URL`；**先让服务端停掉该会话**，否则内存缓存会覆盖回写 |
| `character-ops/finalize-inventory.mjs` | 把角色背包整理成目标态（幂等） | 同上 |
| `character-ops/verify-equip.mjs` | 端到端校验「等级不足能否装备」（含对照组） | `JWT_SECRET` + 3100；会 `player.select`（踢掉已有会话） |
| `character-ops/reset-session.mjs` | 只做一次 WS 握手 → 触发 `resetActiveCharacter`，停掉旧会话 | `JWT_SECRET` |
| `character-ops/probe-attributes.mjs` | 实时探针：玩家单位是否带 `attributes`/`exp`/`maxExp`（14 项断言） | `JWT_SECRET`（脚本自己读 `.env`） |
| `character-ops/measure-attr-bytes.mjs` | 量 `attributes` 对象给单位 DTO 加了多少字节 | 先 build `server`（读其 `dist`） |

⚠️ `character-ops/` 里多数脚本带**默认 userId/角色 key**（原为测试角色 `nbb01`），
换角色请把参数传全 —— 各脚本头部都有用法。改库类脚本一律**先备份再写**，
备份落在 `packages/server/tmp/`（gitignore）。

---

## 相关文档

- 容量数字与复跑方式：[`ai-docs/06-容量基准与并发上限.md`](../ai-docs/06-容量基准与并发上限.md)
- 推送报文（`capture-tick.mjs` 的产物与逐情况解读）：[`ai-docs/25-战斗推送报文梳理.md`](../ai-docs/25-战斗推送报文梳理.md)
- 环境坑（沙箱 HOME / 端口 / 日志落盘）：AGENTS §7 与 [`ai-docs/17-环境坑与沙箱实操.md`](../ai-docs/17-环境坑与沙箱实操.md)
- 离线实时战斗探究：[`ai-docs/26-离线实时战斗探究稿.md`](../ai-docs/26-离线实时战斗探究稿.md)
