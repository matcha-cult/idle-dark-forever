# Wave 2 任务书（服务端游戏逻辑 · 战斗模拟）

> 前置：Wave 1 落地 `packages/game-core`（`rng/` `sim/` `serialize/` `rules/` `data/`）与 `packages/server`（基础设施层）。
> 本文定义 Wave 2 的两个并行任务，交接给后续会话/子代理执行。

---

## 依赖顺序（必须先满足）

```
game-core/rng ─┐
game-core/sim ─┼─► game-core/rules ─► game-core/combat ─┐
game-core/data ┘                                        │
                                                        ▼
server(基础设施) ─────────────────────────────► server 游戏逻辑域
```

- `game-core/combat`（本任务 A）只依赖 `rules` + `sim` + `ports`，**不依赖 server**。
- `server 游戏逻辑域`（任务 B）依赖 `game-core` 全部 + 基础设施层的 `NotificationPort`。

---

## 任务 A · `game-core/src/combat/` —— 战斗模拟移植

**职责**：把原版 `src/logics/unit.js`（2362 行）+ `src/logics/world.js` 的伤害管线 + `src/logics/EnemyBorn.js`（303 行）移植为**无 MobX、可确定性重放**的纯逻辑。

### 输入（先读）
- 原版：`/home/nbb/projects/dark-forever-memorize/src/logics/unit.js`、`world.js`（`sendDamage` / `sendHeal` / `testDodge` / `gotExp` / `loots` / `addEnemy` / `onMapChanged`）、`EnemyBorn.js`
- 冻结契约：`packages/game-core/src/contracts/{ports,data}.ts`
- 方案：`ai-docs/00-重写总方案.md` §7.2（反应式自动施法 → 显式调度）、§8（战斗与时间三问）

### 交付
```
src/combat/
├── index.ts
├── camps.ts          # Camps / CampRelation / IsAlien
├── skill-state.ts    # SkillState（冷却 / canUse / shouldUse / effect / 读条）
├── buff-state.ts     # BuffState（层叠 / 周期 / hooks 注册注销 / compBuff）
├── unit.ts           # Unit 基类（资源夹取 / attr hook 链 / 目标选择 / 暴击 / dumpState）
├── player-unit.ts    # PlayerUnit（装备+被动+强化+药剂 四类 hook 来源；经验 / 升级 / 巅峰 / 复活）
├── enemy-unit.ts     # EnemyUnit（quality 词缀与数值膨胀 / 无尽层缩放 / 掉落结算）
├── battle-world.ts   # 世界：单位表 / 伤害管线 / 掉落 / 经验 / 地图切换
├── spawner.ts        # Born / EnemyBorn / DungeonState（阶段推进）
└── *.test.ts
```

### 硬性要求
1. **禁止 MobX**。原版 `reaction(this.canUseSkill, this.tryUseSkill)` 改为**显式调度队列**：技能冷却到期 / 资源变化时入队，由 `Clock` 驱动消费；`autorun(() => timeline.setRate(speedRate))` 改为属性变更时显式 `clock.setRate(...)`。
2. **禁止裸 `Math.random()`**：全部经 `Rng`（暴击、闪避、词缀抽取、刷怪位置）。`fork('crit')` / `fork('loot')` 等标签要稳定。
3. **禁止裸 `Date.now()`**：时间一律来自 `Clock`。
4. 事件全部经 `BattleSink` 端口（原版 `message.sendXxx`）。
5. `dumpState()` / `loadState()` 保留（世界快照需要），但**不含定时器句柄**——恢复时按剩余时间重新 `setTimeout`。

### 验收门禁（这是本任务最重要的产出）
- **金样回归**：固定 `seed` + 固定初始状态，跑 N 秒虚拟战斗，断言事件序列与最终状态稳定（同种子两次运行必须逐字节一致）。
- 边界：0 攻速 / 0 血量 / 负伤害 / 空技能表 / 无目标 / 单位死亡后仍被攻击 / Buff 叠加超上限 / 循环召唤。
- 与 `sim` 的协作：`stepPaused(rest, budget)` 在事件预算耗尽时能正确中断并返回剩余毫秒。

---

## 任务 B · `packages/server/src/modules/logic/` —— 游戏逻辑域

**职责**：把 `game-core` 的能力包装成 ionet Action，并把**权威世界**跑起来。

### 输入（先读）
- `packages/server/src/ionet/{cmd,action-support,game-actions}.ts`（基础设施层产物）
- `packages/server/src/common/ports/notification.port.ts`
- `packages/protocol/src/cmd.ts` + `dto.ts`（**唯一真相**）
- 参考实现：`/home/nbb/projects/idle-path-of-xiuxian/packages/server/src/modules/logic/*`（Action 只校验转发 → 门面 Service 编排 → internal 实现）

### 交付（每域一个目录：`*.action.ts` + `*.logic.service.ts` + `*-logic.module.ts` + `internal/`）
| 目录 | cmd 段 | 关键内容 |
|---|---|---|
| `system/` | 1 | ping（已有）/ version / notice 推送 |
| `player/` | 20 | list / create（用 `game-core` 的 `Player.create` + 角色数据）/ remove / **importSave（旧存档导入）** / exportSave / select |
| `world/` | 30 | snapshot / enterMap / leave / skipOffline + **世界 tick 循环** + tick 推送 |
| `battle/` | 40 | log/loot 推送 + focus |
| `inventory/` | 50 | list / equip / unequip / sell / lock / sort / usePackage / expand + changed 推送 |
| `bank/` | 60 | list / deposit / withdraw / expand |
| `lootrule/` | 70 | get / update / setMinLevel |
| `career/` | 80 | list / switchCareer / selectSkill / unselectSkill / selectEnhance / unselectEnhance + levelup 推送 |
| `produce/` | 90 | enchantCosts / enchant / rebuild / decompose / medicineState / medicineUse / medicineReset |
| `story/` | 100 | list / play / finish + unlock 推送 |
| `shop/` | 110 | state / buyPlayerSlot / exchange |
| `idle/` | 120 | report / claim（**有界快进 + 解析外推**，见方案 §8.3） |

### 硬性要求
1. **服务端权威**：前端只发"意图"（如"分解这件"），所有数值由服务端算。前端 DTO 里不得出现需要前端推导的字段。
2. **幂等**：消耗类操作（分解 / 附魔 / 重铸 / 开包 / 兑换）带 `opId`，服务端去重（`DUPLICATE_OPERATION`）。
3. **限流**：用基础设施层的自建限流（框架 `RateLimitInOut` 无法短路）。
4. **世界 tick 循环**：受管 `setInterval`（100~200ms）推进每角色 `Clock`；事件**批次聚合 + 节流**后经 `NotificationPort` 推送（绝不逐伤害推送）。
5. **离线结算**：`IDLE_CMD.report` 返回 `OfflineReportDto`；上限 72h、真模拟预算有界、超出用速率外推。
6. **tick 与推送不得阻塞**：单个角色单帧的回调执行量要有预算。

### 验收门禁
- 端到端：REST 登录 → WS 连接（`?token=`）→ `player.create` → `world.enterMap` → 收到 `world.tick` 推送 → `inventory.list` 有掉落。
- 旧存档导入：用 `dark-forever-memorize` 真实导出的存档（`'save'` 编码与明文 JSON 两种）导入成功，角色属性与原版逐字段一致。
- 边界：并发同角色请求、断线重连后状态一致、`opId` 重复提交被拒、离线时长为 0 / 负数 / 超 72h。
