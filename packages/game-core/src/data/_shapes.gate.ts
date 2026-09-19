/**
 * 数据层「视图类型 ↔ 真实内核」一致性门禁（**编译期**，不是运行期测试）。
 *
 * ⚠️ 本文件必须留在 `src/**` 且**不能**叫 `*.test.ts` —— `packages/game-core/tsconfig.json`
 * 的 `exclude` 里有 `src/**\/*.test.ts`，放进测试文件就等于没人检查（实测：把 `timeline`
 * 塞回 `UnitLike` 后 typecheck 依然 exit 0，是**假门禁**）。这里靠 `include: src/**\/*.ts`
 * 被 `pnpm run typecheck` / `build` 覆盖；文件本身无运行期导出，编译后是空模块。
 *
 * 背景（同一根因的三次真实事故）：
 *  1. `UnitLike.timeline` 存在、真实 `Unit` 只有 `clock` ⇒ `this.unit.timeline.pause()`
 *     编译通过、运行期抛 `Cannot read properties of undefined (reading 'pause')`，
 *     且 `freezed`/`stunned` 这些 debuff **静默失效**；
 *  2. `WorldLike.sendGeneralMsg` 存在、`BattleWorld` 上**根本没有这个方法** ⇒
 *     `enemies.ts` 里 26 处机关提示 / BOSS 对话一律 `is not a function`（被 tick 的
 *     try/catch 吞成一条 WARN）；
 *  3. `SkillStateLike.summoner` 存在、真实 `SkillState` 没有 ⇒ `this.summoner` 恒
 *     `undefined`，`year2018.heal` 永远静默不生效（同 AGENTS §11 的 `lootRule` 类型撒谎）。
 *
 * 根因：`_shapes.ts` 的视图类型是**对内核的断言**，却不受任何约束 —— 多写一个成员，
 * `tsc` 只会更宽松，缺陷被推迟到运行期。本文件把该断言变成编译期断言。
 *
 * 处理原则（按优先级）：
 *  1. 内核上缺 → **优先补内核**（如 `BattleWorld.sendGeneralMsg`），保持数据层贴近原版；
 *  2. 只有确实是数据层动态挂载的字段才登记进 {@link BuffDynamicFields}，并写清谁写谁读；
 *  3. **不要**为了让某个数据文件编过而在这里放宽 —— 那正是本门禁要防的事。
 */

import type { BattleWorld, CombatRngStreams } from '../combat/battle-world.js';
import type { BuffState } from '../combat/buff-state.js';
import type { EnemyUnit } from '../combat/enemy-unit.js';
import type { PlayerLike, PlayerUnit } from '../combat/player-unit.js';
import type { SkillState } from '../combat/skill-state.js';
import type { Unit } from '../combat/unit.js';
import type { Clock } from '../contracts/ports.js';

import type {
  BuffStateLike,
  DataRngStreams,
  PlayerView,
  SkillStateLike,
  TimelineLike,
  UnitLike,
  WorldLike,
} from './_shapes.js';

/**
 * 数据层「自己挂上去的动态字段」白名单：原版数据就是直接赋值的，内核上没有声明，
 * 读写成对且只在数据层内部可见。
 *
 * 每一项都必须写明谁写、谁读 —— 白名单是**例外**，不是方便入口。
 */
type BuffDynamicFields =
  /** `buffs.ts#summoned` 的 `willRemove` 读它；`skills.ts` 在召唤物复活时写 `true` 以跳过 `kill()`。 */
  | 'stopped'
  /** `buffs.ts#fishzilla.focus` 在 `didAppear` 写、`willRemove` 读并 `removeBuff`。 */
  | 'targetBuff';

/**
 * 视图上存在、内核上不存在、且不在白名单里的成员（正常必须为 `never`）。
 *
 * ⚠️ `Keys` 必须是**成员名的并集**。第一版写成 `keyof (Unit | PlayerUnit | EnemyUnit)`，
 * 而 `keyof (A | B)` 是**交集** —— 于是子类独有的 `str` / `player` / `transformType` 等
 * 全被误报为缺失。多类目标一律传 `keyof A | keyof B | …`。
 */
type MissingOn<View, Keys extends PropertyKey, Allowed extends PropertyKey = never> = Exclude<
  keyof View,
  Keys | Allowed
>;

/** 只有 `T` 为 `never` 才成立；否则 `tsc` 会把缺的成员名**打印在错误里**。 */
type AssertNoMissing<T extends never> = T;

// ───────────────────────── 编译期断言（无运行期开销） ─────────────────────────
// 任何一行变红 = 视图类型正在对内核撒谎，请按文件头注释处理。

/**
 * `UnitLike` 的成员必须真实存在于 `Unit` / `PlayerUnit` / `EnemyUnit` 上。
 *
 * 三个类取**并集**：数据层的 `self` 在运行期必然是 `PlayerUnit` 或 `EnemyUnit`
 * （`EnemyUnit.transformType` / `setCleanTimer`、`PlayerUnit.useExtraSkill` 等只存在于子类）。
 */
export type UnitShapeGate = AssertNoMissing<
  MissingOn<UnitLike, keyof Unit | keyof PlayerUnit | keyof EnemyUnit>
>;
/** `BuffStateLike` → `BuffState`（`stopped` / `targetBuff` 是数据层动态挂载）。 */
export type BuffShapeGate = AssertNoMissing<
  MissingOn<BuffStateLike, keyof BuffState, BuffDynamicFields>
>;
/** `SkillStateLike` → `SkillState`（`summoner` 曾在这里造成静默失效）。 */
export type SkillShapeGate = AssertNoMissing<MissingOn<SkillStateLike, keyof SkillState>>;
/** `WorldLike` → `BattleWorld`（`sendGeneralMsg` 曾在这里造成 26 处死调用）。 */
export type WorldShapeGate = AssertNoMissing<MissingOn<WorldLike, keyof BattleWorld>>;
/** `PlayerView` → `PlayerLike`（`Unit.player` 是角色对象，不是 `Unit`）。 */
export type PlayerShapeGate = AssertNoMissing<MissingOn<PlayerView, keyof PlayerLike>>;

// ── 嵌套视图：只查外层成员抓不到 `unit.clock.pause()` / `world.rng.skill()` 这类穿透 ──

/** `TimelineLike`（`unit.clock`）→ `Clock`：`timeline.pause()` 曾是事故现场。 */
export type TimelineShapeGate = AssertNoMissing<MissingOn<TimelineLike, keyof Clock>>;
/** `DataRngStreams`（`world.rng`）→ `CombatRngStreams`：`world.rng.skill` 必须真实存在。 */
export type RngShapeGate = AssertNoMissing<MissingOn<DataRngStreams, keyof CombatRngStreams>>;

/** 汇总导出：仅为让上述断言成为「被使用的导出」，避免将来开启 `noUnusedLocals` 时被误删。 */
export type ShapeGates = [
  UnitShapeGate,
  BuffShapeGate,
  SkillShapeGate,
  WorldShapeGate,
  PlayerShapeGate,
  TimelineShapeGate,
  RngShapeGate,
];
