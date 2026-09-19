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
 */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { IonetModule } from '@nbb-ionet/extension-nestjs';
import { verifyBearerHeader, tokenFromUrl, verifyJwt } from './common/auth/jwt.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { appRef } from './ionet/app-ref.js';
import { GAME_ACTION_CLASSES, GAME_ACTION_MODULES } from './ionet/game-actions.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CharacterModule } from './modules/character/character.module.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { EdgeModule } from './modules/edge/edge.module.js';
import { GameModule } from './modules/game/game.module.js';
import { OnlineModule } from './modules/online/online.module.js';

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
          return payload ? { userId: BigInt(payload.id) } : null;
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
