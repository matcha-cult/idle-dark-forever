/**
 * 根模块
 *
 * 通道划分：
 * - HTTP `/api/*`：基础能力（auth / characters / health），NestJS REST；
 * - WS   `/ws`   ：全部游戏交互，ionet 外部服 attach 到同一个 http.Server（单端口三合一）。
 *
 * ionet 装配要点（每一项都有硬性理由，改动前先读注释）：
 * - `actions: [...GAME_ACTION_CLASSES]` + `resolveAction`：框架把 Action 实例解析推迟到
 *   `onModuleInit`（app 就绪后）从 NestJS 容器取，Action 因此具备 DI；
 * - `resolveAction` **由应用侧显式实现**（`appRef.app.get(Cls)`）：跨仓库 workspace 链接下
 *   框架侧注入 `@nestjs/core` 类令牌可能解析到另一个副本而静默 undefined；
 * - `httpServer: false`：游戏 HTTP 由 NestJS 承担（ionet 自带 HTTP fallback 的默认前缀
 *   是 `/api`，会与 NestJS REST 冲突）；
 * - `wsServer.attachNestServer: true` + `path: '/ws'`：握手鉴权在 upgrade 阶段完成，
 *   失败返回 null → HTTP 401；
 * - `redis: false`：本工程不接 Redis（在线状态用 OnlineSessionService 内存实现）；
 * - `allowProduction`：框架默认在 `NODE_ENV=production` 下拒绝启动，需显式放行。
 *
 * ⚠️ 握手成功时还会**重置该账号的「当前角色」**（`resetActiveCharacterFor`）：新连接 = 未选角色。
 * 不这样做的话，刷新页面后旧角色仍被当作"在线"，`(world, tick)` 会继续推给停在选角页的页面
 * （详见 `WorldService.resetActiveCharacter`）。
 */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IonetModule } from '@nbb-ionet/extension-nestjs';
import { verifyBearerHeader, tokenFromUrl, verifyJwt } from './common/auth/jwt.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { appRef } from './ionet/app-ref.js';
import { WorldService } from './modules/logic/world/world.service.js';
import { GAME_ACTION_CLASSES, GAME_ACTION_MODULES } from './ionet/game-actions.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CharacterModule } from './modules/character/character.module.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { EdgeModule } from './modules/edge/edge.module.js';
import { GameModule } from './modules/game/game.module.js';
import { OnlineModule } from './modules/online/online.module.js';

/** 重置最长等待时间：DB 卡住也不能把握手挂死（超时后放行，重置继续在后台跑）。 */
const RESET_TIMEOUT_MS = 2_000;

/**
 * 握手成功后的账号级清理：停掉该账号的活跃角色会话（新连接 = 回到未选角色）。
 *
 * 用 `appRef.app.get(..., { strict: false })` 而不是构造注入 —— 本回调是模块装饰器里的普通函数，
 * 拿不到 DI；且首次握手时 Nest 容器已就绪（`main.ts` 在 `app.init()` 之前设置 `appRef.app`）。
 * **失败只记日志**：握手不能因为清理失败而把连接拒掉。
 */
async function resetActiveCharacterFor(rawUserId: unknown): Promise<void> {
  const userId = Number(rawUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return;
  const app = appRef.app;
  if (!app) return;
  let world: WorldService;
  try {
    world = app.get(WorldService, { strict: false });
  } catch (error) {
    console.warn(
      `[idle-dark] 握手后无法解析 WorldService（跳过当前角色重置）: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }
  const reset = world
    .resetActiveCharacter(userId)
    .catch((error: unknown) =>
      console.warn(
        `[idle-dark] 握手后重置当前角色失败 userId=${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[idle-dark] 握手后重置当前角色超时（>${RESET_TIMEOUT_MS}ms），已放行连接`);
      resolve();
    }, RESET_TIMEOUT_MS);
  });
  await Promise.race([reset, timeout]);
  if (timer !== null) clearTimeout(timer);
}

@Module({
  imports: [
    IonetModule.forRoot({
      actions: [...GAME_ACTION_CLASSES],
      resolveAction: (ActionClass) => {
        const app = appRef.app;
        if (!app) {
          throw new Error(
            '[ionet] resolveAction 需要 NestJS app 引用：请在 main.ts 中于 app.init() 之前设置 appRef.app',
          );
        }
        return app.get(ActionClass);
      },
      httpServer: false,
      wsServer: {
        attachNestServer: true,
        path: '/ws',
        // 握手鉴权：凭据二选一
        //   · Authorization: Bearer <jwt>（Node 客户端可设握手头）
        //   · ?token=<jwt>（浏览器 WebSocket 无法设请求头）
        // 通过 → 整条连接绑定 userId，之后每次 execute 的 FlowContext 预置该 userId；
        // 失败/缺失 → null → 以 HTTP 401 拒绝升级（PROTOCOL §6）。
        authenticate: async ({ headers, url }) => {
          const payload = verifyBearerHeader(headers['authorization']) ?? verifyJwt(tokenFromUrl(url));
          if (!payload) return null;
          // ⚠️ **必须 await**：握手被接受后这条连接马上就能收推送，而重置是「停掉旧角色会话」
          // 这件事本身。fire-and-forget 会留下一个几百毫秒的窗口，此时旧会话还在 tick，
          // 新页面（停在选角页）会收到最后一两帧 `(world, tick)`。
          await resetActiveCharacterFor(payload.id);
          return { userId: BigInt(payload.id) };
        },
      },
      redis: false,
      allowProduction: process.env.IONET_ALLOW_PRODUCTION === 'true',
    }),
    // 基础设施
    DatabaseModule,
    GameModule,
    // 对外服 / 在线会话（@Global）
    EdgeModule,
    OnlineModule,
    // Action 模块（system + auth；后续任务在 ionet/game-actions.ts 追加）
    ...GAME_ACTION_MODULES,
    // 本批不带 WS Action 的 HTTP 模块
    CharacterModule,
  ],
  providers: [
    // 全局 HTTP 鉴权；WS 通道由握手 authenticate 承担（不经过本 Guard）
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
