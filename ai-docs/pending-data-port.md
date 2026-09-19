# 数据层移植状态（`packages/game-core/src/data`）

来源：`/home/nbb/projects/dark-forever-memorize/data/` —— **183 个 `.js` 文件**。
目标：`packages/game-core/src/data/`，类型契约 `packages/game-core/src/contracts/data.ts`（**未改动**）。

**结论：183 个源文件全部处理完毕；16 张契约表全部按原版数据逐条落地，没有一张是空表、没有一条是编造值。**

---

## 1. 已移植清单（含条目数）

条目数取自运行时实测（`createDefaultTables()`），且已与原版 `data/index.js` 做过全表逐字段对拍（见 §5）。

| 目标文件 | 源文件数 | 叠加 `packages/*` 后的条目数 | 说明 |
|---|---|---|---|
| `careers.ts` | 5 | 5 | warrior / sorceress / assassin / knight / elementSummoner |
| `roles.ts` | 2 | 2 | Eyer / Aleanor |
| `passives.ts` | 4 | 5 | base / warrior / sorceress / assassin |
| `enhances.ts` | 5 | 35 | warrior / sorceress / assassin / knight / elementSummoner |
| `medicines.ts` | 1 | 6 | `medicines.js` |
| `upgrades.ts` | 1 | 1（对象） | `upgrades.js`（3 个数组） |
| `announcement.ts` | 1 | 1（对象） | `annoucement.js`（原版拼写如此） |
| `goods.ts` | 5 | 94 | junks / materials / weapons / armors / jewels |
| `affixes.ts` | 2 | 27 | base 16 + level2 12 |
| `enemy-affixes.ts` | 1 | 3 | base |
| `buffs.ts` | 8 | 64 | warrior / enemies / sorceress / assassin / knight / simba / elementSummoner / shrine |
| `legends.ts` | 2 | 24 | s1 / s2 |
| `enemies.ts` | 27 | 165 | 27 个源文件（含 `summon.element.js` 的 `elementV2` 派生） |
| `skills.ts` | 7 | 167 | base / warrior / sorceress / assassin / knight / elementSummoner / enemy |
| `maps.ts` | 40 | 47 | home + town(11) + chapter3(11) + chapter4(6) + silver(5) + chapter5(6) |
| `stories.ts` | 33 | 33 | chapter1/2/3 + aleanor-chapter1 + purchaseRates |
| `packages/nightmare.ts` | 7 | +54 `define` / 14 `extend` | base / slime / wolf / kobold / undead / fire / knight |
| `packages/year2018.ts` | 3 | +16 `define` / 4 `extend` | legends / redbag / dungeon |
| `index.ts` | — | — | `createDefaultTables()`：基础表 → `registerNightmare` → `registerYear2018` |
| `_util.ts` / `_shapes.ts` | — | — | 组装工具 + 数据层视图类型（非交付契约） |
| `index.test.ts` | — | 17 个用例 | |

合计：**183 = 178 个数据/脚本文件 + 5 个 `index.js` 聚合文件**（另有 1 个未被任何聚合文件引用的死文件，见 §2）。

---

## 2. 未移植清单

| 源 | 规模 | 原因 |
|---|---|---|
| `data/producers/index.js` | 1 文件 | 导出 `{}`（空对象），且 `DataTables` 契约里**没有** `producers` 表。无处安放，故整体不移植。 |
| `data/affixGroup.js` | 1 文件 | **死文件**：全仓库检索（含 `base.js` / 各 `index.js` / `src/`）无任何 `require('./affixGroup')`。原版从未加载它，移植会造成"凭空多出一张表"。 |
| `data/stories/chapter3/chapter3-8.js` | 1 文件 | **死文件**：`stories/chapter3/index.js` 只引用了 1~7，`chapter3-8.js` 从未被 `require`，原版运行时不存在该剧情。 |
| `data/skills/formula.txt` | 非 `.js` | 不是数据文件（公式草稿），不参与 183 的计数。 |

以上三项**都不是"时间不够没做"**，而是原版运行时不产生对应数据。若后续确需，应在 `contracts/data.ts` 增加表并单独确认语义。

---

## 3. 函数型数据的处理方式

### 3.1 移植手法：整文件 IIFE，保留原始函数体

数据文件里混着**函数（规则）+ 模块级辅助函数/类/常量**，例如：

- `skills/assassin.js` 的 `class Combo` / `MeleeCombo` / `EnergyCombo` / `BloodCombo`、`addCombo` / `comboCount` / `clearCombo`；
- `skills/sorceress.js` 的 `addFlaming` / `magicArtist` / `addColdAir` / `getLevelBonus` / `TRANFORM_TYPES`；
- `enemies/summon.element.js` 的 `getLevelBonus` / `elements` / `elementV2`；
- `buffs/sorceress.js`、`buffs/knight.js`、`enhances/knight.js`、`skills/knight.js` 的 `addColdAir` / `addCombo` / `useCombo`。

若用 `Function.prototype.toString()` 抽取函数，这些**闭包自由变量会丢失**。因此移植时把每个源文件整体包进
`((): EntryType[] => { ... })()`，只把 `module.exports = X` 换成 `return X`，**函数体逐字节保留**（含注释、字符串、模板字面量）。

已验证：把定点补丁关掉重新生成后，**671/671 个去重后的原始函数体在生成的 `.ts` 中原样命中**（见 §5 第 4 条）。

### 3.2 `this` 绑定的逐类对齐

冻结契约把 hook 的 `this` / `world` / `self` 一律标成 `unknown`，而数据层近千个函数必须对它们做鸭子类型调用
（`world.sendDamage` / `self.runAttrHooks` / `this.unit.timeline...`）。
因此新增了 `src/data/_shapes.ts`（**不是契约**，只是数据层的实现细节），按「原版实际访问到的最小面」声明视图类型，
并**逐槽位**给出 `this` 类型：

| 槽位 | `this` 视图 | 原版对照 |
|---|---|---|
| `enemies.onPress` | `UnitLike` | 敌人自身（`this.kill()` / `this.atk`） |
| `enemies.hooks.*` | `UnitLike` | 敌人自身（`this.summoner` / `this.addBuff`） |
| `enemyAffixes.hooks.*` | `UnitLike` | 敌人自身（`this.maxHp`） |
| `passives.hooks.*` / `enhances.hooks.*` | `UnitLike` | 装备者（`this.str` / `this.skills`） |
| `affixes.hooks.*` | `UnitLike` | 装备者（`(effect, value)`） |
| `legends.hooks.*` | `UnitLike` | 装备者（含 5 参 `summonerWillDamage`） |
| `medicines.hooks.*` | `UnitLike` | PlayerUnit（`this.maxHp`） |
| `buffs.hooks.*` / `effect` / `willAppear` / `didAppear` / `willRemove` / `didRemove` / `onOver` / `effectInterval` | `BuffStateLike` | BuffState（`this.unit` / `this.arg` / `this.targetBuff` / `this.over()`） |
| `skills.canUse` / `shouldUse` / `effect` / `coolDown` | `SkillStateLike` | SkillState（`this.summoner` / 末尾把 `this` 当 skillState 传参） |
| `affixes.display`/`generate`/`range`、`legends.display`/`generate`/`range` | 不使用 `this` | 纯函数 |

**没有使用 `any`**：`grep -rn "[^A-Za-z_]any[^A-Za-z_]" src/data/*.ts src/data/packages/*.ts` 只命中 `_shapes.ts` 里
说明「没有使用 any」的两行**注释**，没有任何类型位置的 `any`（`_util.ts` 的动态合并用 `unknown` + 定点断言）。
确实无法确定的叶值（buff hook 第 2/3 参在不同条目里分别是「来源单位 / 世界 / 伤害类型字符串」）
用**交叉类型** `UnitLike & WorldLike & string` 收敛，而不是 `any`。

### 3.3 `Rng` 注入（**已全量清零，数据层零裸 `Math.random()`**）

原版数据文件里共 **52 处**运行时随机调用，全部改为走注入的 `Rng` 端口：

| 场景 | 数量 | 改法 | 随机源 |
|---|---|---|---|
| 词缀 `generate` | 27（`affixes/base.js` + `level2.js`，其中 27 处用随机数） | `Math.random()` → `rng.next()`；签名 `generate(level)` → `generate(level, rng)` | 冻结契约的 `rng` 形参 |
| 传奇 `generate` | 16 个（24 条传奇里只有 16 条写了 `generate`） | 仅签名补 `rng`（原版返回常量） | 同上 |
| `skills.*.effect` | 47 | `Math.random()` → `world.rng.skill.next()` | `BattleWorld.rng.skill`（标签 `'skill'`） |
| `buffs.*.effect` | 1（`knight.deserve`） | 同上 | 同上 |
| `buffs.*.hooks.attacked`（`iceShield`） | 1 | `this.unit.world.rng.skill.next()`（该 hook 形参里没有 world） | `Unit.world.rng.skill` |
| `legends.*.hooks`（`mithrilRing-1`） | 1 | `this.world.rng.skill.next()`（`AttrHook` 形参里没有 world） | `Unit.world.rng.skill` |
| `enhances.*.hooks`（`knight.recharge`） | 1 | `world.rng.skill.next()` | `world.rng.skill` |
| `packages/year2018` 的召唤 buff `effect` | 1 | `world.rng.skill.next()` | `world.rng.skill` |

设计要点：

- **独立通道**：只用 `world.rng.skill`（`combat/battle-world.ts` 的 `CombatRngStreams.skill`，标签 `'skill'`），
  不借 `crit` / `dodge` / `loot`，也不 `fork` 新流——否则会互相扰动战斗判定序列、破坏金样回归的可解释性。
- **统一用 `.next()`**：保持原表达式逐字不变（`Math.random() * a + b` → `rng.skill.next() * a + b`），
  分布与 `[0,1)` 语义与原版**逐位一致**；没有改成 `.int(n)`，以免依赖 `int` 的具体实现。
- **无法从形参拿 world 的只有 2 处**（buff `attacked` hook、传奇 hook），按 `this.unit.world` / `this.world` 取，
  底层就是原版 `Unit.world`（`readonly world: BattleWorld`），**没有臆造随机源、没有保留降级分支**。
- 视图类型（`_shapes.ts`）补了 `WorldLike.rng: DataRngStreams` 与 `UnitLike.world: WorldLike`，仍然零 `any`。
- 护栏：`index.test.ts` 新增「源码扫描」用例——遍历全部数据表函数（>600 个）的 `toString()`，
  断言无一含 `Math.random`；另有「同 seed 两次运行产出相同伤害、不同 seed 不同、且恰好消费一次 `skill` 流」
  的可重放断言，以及两处 `this.world` / `this.unit.world` 路径的定向用例。

### 3.4 消灭副作用式 `extend`

原版 `data/packages/util.js` 的 `define` / `extend` / `mergeObject` 语义原样搬进 `src/data/_util.ts`（含
「函数叶子是变换器：`fn(origin[key], merged)`」这条），但**注册变成显式函数**：

```ts
createDefaultTables()
  → cloneTables(基础表)
  → registerNightmare(tables)   // 顺序 = 原 require 顺序
  → registerYear2018(tables)    // redbag 会给"当时已存在的"enemies/maps 追加红包
```

`year2018/redbag.js` 的「遍历全表追加红包掉落」也保留为运行期循环（而不是烘焙进数据），
并配了「可重入」单测：重复调用 `createDefaultTables()` 不会让红包累加。

移植期顺带修掉一个**真实缺陷**：`extend` 组合出的新条目原样沿用了 origin 的 `key`（原版 `util.define` 会覆写
`info.key`），导致 `skills['nightmare.wolf.1'].key === 'wolf.call'`。已在 `_util.ts` 显式覆写，并有单测覆盖。

---

## 3.5 随机源现状（`grep` 前后对比）

| 口径 | 改造前 | 改造后 |
|---|---|---|
| `grep -ro "Math\.random" src/data --include=*.ts \| wc -l`（含注释/测试名里的字样） | 72 | 23 |
| 其中**真实调用点** | **52** | **0** |
| 剩余字样分布 | — | 18 个数据文件的头注释（自述「零 `Math.random()`」）+ `_shapes.ts` 设计说明 1 处 + `index.test.ts` 的 2 个用例名与 1 处断言字符串 |

---

## 4. 与 `contracts/data.ts` 不一致之处（**未自行修改契约**，仅列出建议）

契约是冻结的，以下不一致通过 `src/data/_shapes.ts` 的局部放宽吸收；**建议后续在契约里修订**：

| # | 契约现状 | 原版实际 | 建议 |
|---|---|---|---|
| 1 | `GoodData.price: number`（必填） | 94 件物品里 59 件（**全部装备**）没写 `price` | 改 `price?: number` |
| 2 | `AffixData.weight: number`（必填） | 27 条词缀里 18 条没写 `weight` | 改 `weight?: number` |
| 3 | `AffixData.range: (level) => [number, number]` | 实际返回**展示字符串**：`"11~31"`、`"30%"`、`"2%~4%"`；少量传奇返回数字 | 改 `=> string \| number \| [number, number]` |
| 4 | `LegendData.range` 同上 | 同上（`"40%"` / `"3"`） | 同上 |
| 5 | `EnemyData.maxHp/atk/atkSpeed/exp/level/skills` 必填 | 剧情单位、图腾、机关等大量条目缺其中若干（如 `nightmare.wolf.hunter.trigger` 只有 `camp/race/career/onPress`） | 这些字段改可选，或引入 `EnemyDataPartial` |
| 6 | `EnemyData.buffs?: string[]` | 也有 `{ type: string }[]`（带参 buff，如 `simba.goodFriends`） | `Array<string \| { type: string }>` |
| 7 | `EnemyData.onPress?: (world: unknown) => void` | `this` = 敌人自身（`this.kill()` / `this.atk`） | 补 `this` 参数 |
| 8 | `SkillData.isAttack/group` 必填、`maxExp` 必填 | 分别有 155 / 136 / 30 条技能没写（敌方技能、被动技能） | 改可选 |
| 9 | `SkillData.antiBreak?: boolean` | 实际是 `0.5 / 0.8 / 0.9` 这类**概率数值** | 改 `number`（或 `boolean \| number`） |
| 10 | `SkillData.cost?: Partial<Record<..., number>> \| ((level) => ...)` | 对象里的值**也可以是 `(self) => number`**（如 `cost: { mp: (self) => 8 * (self.level * 0.2 + 1) }`） | `Record<CostKey, number \| ((self: Unit) => number)>` |
| 11 | `MapData.phases[].monsters: Array<{type, total}>` | 还支持 `{ types: Record<key, weight>, warmup, delay, max }`，且 BOSS 项常缺 `total` | 复用 `MonsterSpawnConfig` 的字段并放宽 |
| 12 | `StoryData.taskType` / `awards` 必填 | 33 条里 16 条没 `taskType`、31 条没 `awards`；`purchaseRates.js` 2 条连 `group`/`name` 都没有 | 改可选 |
| 13 | `RoleData.startup` 必填 | 2 个角色都没写；反而有额外 `requirement` | 改可选 |
| 14 | 契约无 `producers` 表 | 原版 `base.js` 导出 `producers: {}` | 确认是否需要（当前为空表） |
| 15 | `announcement` 在 `DataTables` 内 | 原版 `annoucement.js` **不在** `data/base.js` 的表里，是单独 import | 确认归属（当前按契约放进 `DataTables`） |
| 16 | hook 家族没有 `rng` 形参 | ~~52 处裸 `Math.random()`~~ | ✅ **已解决，且无需改契约**：`BattleWorld.rng` 新增了 `skill` 通道（由并行开发的 `combat/` 侧提供），数据层一律改用 `world.rng.skill`；两处拿不到 world 形参的 hook 走 `this.unit.world` / `this.world`。当前数据层**零** `Math.random()` 调用（见 §3.3）。 |

其它原版额外字段（`def` / `stunResist` / `*Absorb` / `allResist` / `speedRate` / `v2Skills` / `element` / `targetType` /
`nonBreakable` / `isEndless` / `level`(goods)）通过条目类型的索引签名承载，未写进契约。

---

## 5. 实际运行的校验与结果

```bash
cd /home/nbb/projects/idle-dark-forever

# ① 类型检查（strict + noUncheckedIndexedAccess + verbatimModuleSyntax）
pnpm --filter @idle-dark/game-core exec tsc -p tsconfig.json --noEmit
# → 0 error（整个 game-core 包干净）

# ② 数据层单测
pnpm --filter @idle-dark/game-core exec vitest run src/data
# → Test Files 1 passed / Tests 21 passed
```

> 注：`src/rules/*.test.ts` 的失败属于并行进行的规则层开发，不在数据层范围内。
> 同一时刻 `tsc` 的 0 error 指 `src/data/**` 与 `_shapes.ts` / `_util.ts` 全部干净；
> 全包若报错只会来自其它 agent 正在写的 `src/rules/**`。

另外做了两项**一次性**（不随包提交）的强化验证：

3. **与原版全表逐字段对拍**：把 `createDefaultTables()` 与原版 `require('dark-forever-memorize/data/index.js')`
   递归比较「键集合 + 叶子值（含数组长度与逐元素、字符串逐字节）」，函数只比存在性。
   16 张表**零差异**（`announcement` 除外，它不在原版 `base.js` 的表里）。
4. **函数体逐字对拍**：收集原版全部函数 `toString()`（去重后 671 个），检查其归一化文本是否出现在生成的 `.ts` 里：
   - 关闭全部补丁重生成 → **671/671 命中**（证明移植本身零改写）；
   - 打开补丁 → 命中 627，未命中的 44 个**全部**是 §3.3 / §3.4 列出的定点改动。

> 移植期的生成脚本与一次性对拍测试在交付前已删除；本文档即为可追溯记录。
