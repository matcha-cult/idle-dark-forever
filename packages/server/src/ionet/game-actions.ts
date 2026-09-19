/**
 * Action 类与 Nest 模块的**集中登记表**
 *
 * 框架经 `IonetModule.forRoot({ actions, resolveAction })` 在 `onModuleInit`
 * （app 就绪后）从 NestJS 容器解析 Action 实例，因此每个 Action 类**必须是容器 provider**
 * （由下方模块 `providers` 提供；跨模块可见性由模块出口决定）。
 *
 * 后续游戏逻辑任务的接续方式（**只改本文件 + 新增自己的 logic module**）：
 *   1. 在 `packages/protocol/src/cmd.ts` 已登记的段位常量里选 (cmd, subCmd)
 *      （**禁止**在本仓库重新定义 cmd 常量）；
 *   2. 新建 `src/modules/<domain>/<domain>.action.ts`（`@Injectable()` +
 *      `@ActionController(常量.cmd)` + `@ActionMethod(常量.xxx)`，`FlowContext` 值导入）；
 *   3. 新建/复用一个 `@Module` 提供并导出该 Action；
 *   4. 把 Action 类追加进 `GAME_ACTION_CLASSES`，把模块追加进 `GAME_ACTION_MODULES`。
 *
 * 本次只登记 system（health）+ auth；character 的 HTTP 面暂不注册 WS Action。
 *
 * ⚠️ `resolveAction` 必须由**应用侧**显式实现（`appRef.app.get(Cls)`，见 app.module.ts），
 *    不要依赖框架侧注入 `@nestjs/core` 类令牌——跨仓库 workspace 链接下可能解析到
 *    物理独立的 @nestjs/core 副本而静默为 undefined。
 */
import { HealthAction } from '../modules/health/health.action.js';
import { AuthAction } from '../modules/auth/auth.action.js';
import { PlayerAction } from '../modules/logic/player/player.action.js';
import { WorldAction } from '../modules/logic/world/world.action.js';
import { BattleAction } from '../modules/logic/battle/battle.action.js';
import { IdleAction } from '../modules/logic/idle/idle.action.js';
import { InventoryAction } from '../modules/logic/inventory/inventory.action.js';
import { BankAction } from '../modules/logic/bank/bank.action.js';
import { LootRuleAction } from '../modules/logic/lootrule/lootrule.action.js';
import { CareerAction } from '../modules/logic/career/career.action.js';
import { ProduceAction } from '../modules/logic/produce/produce.action.js';
import { HealthModule } from '../modules/health/health.module.js';
import { AuthModule } from '../modules/auth/auth.module.js';
import { LogicSharedModule } from '../modules/logic/shared/logic-shared.module.js';
import { PlayerLogicModule } from '../modules/logic/player/player-logic.module.js';
import { WorldLogicModule } from '../modules/logic/world/world-logic.module.js';
import { BattleLogicModule } from '../modules/logic/battle/battle-logic.module.js';
import { IdleLogicModule } from '../modules/logic/idle/idle-logic.module.js';
import { InventoryLogicModule } from '../modules/logic/inventory/inventory-logic.module.js';
import { BankLogicModule } from '../modules/logic/bank/bank-logic.module.js';
import { LootRuleLogicModule } from '../modules/logic/lootrule/lootrule-logic.module.js';
import { CareerLogicModule } from '../modules/logic/career/career-logic.module.js';
import { ProduceLogicModule } from '../modules/logic/produce/produce-logic.module.js';
import { PanelCharacterModule } from '../modules/logic/inventory/internal/panel-character.module.js';

/** 已登记的 Action 类（`actions` 列表；后续任务在此追加）。 */
export const GAME_ACTION_CLASSES = [
  HealthAction,
  AuthAction,
  PlayerAction,
  WorldAction,
  BattleAction,
  IdleAction,
  InventoryAction,
  BankAction,
  LootRuleAction,
  CareerAction,
  ProduceAction,
] as const;

/**
 * 提供上述 Action 的 Nest 模块（app.module.ts 导入；后续任务在此追加）。
 *
 * 顺序：共享件 → 世界（`@Global`，仍须导入一次）→ 依赖世界的域 → 面板域。
 *
 * ⚠️ `PanelCharacterModule` 是 `@Global()`，但 `@Global()` **不等于自动注册** ——
 * 全局模块必须由根模块导入一次，其 exports 才对整个应用可见
 * （否则面板域注入 `PanelCharacterService` 会 `Nest can't resolve dependencies`）。
 */
export const GAME_ACTION_MODULES = [
  PanelCharacterModule,
  HealthModule,
  AuthModule,
  LogicSharedModule,
  WorldLogicModule,
  PlayerLogicModule,
  BattleLogicModule,
  IdleLogicModule,
  InventoryLogicModule,
  BankLogicModule,
  LootRuleLogicModule,
  CareerLogicModule,
  ProduceLogicModule,
] as const;


