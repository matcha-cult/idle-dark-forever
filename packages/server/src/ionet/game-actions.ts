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
import { HealthModule } from '../modules/health/health.module.js';
import { AuthModule } from '../modules/auth/auth.module.js';

/** 已登记的 Action 类（`actions` 列表；后续任务在此追加）。 */
export const GAME_ACTION_CLASSES = [HealthAction, AuthAction] as const;

/** 提供上述 Action 的 Nest 模块（app.module.ts 导入；后续任务在此追加）。 */
export const GAME_ACTION_MODULES = [HealthModule, AuthModule] as const;
