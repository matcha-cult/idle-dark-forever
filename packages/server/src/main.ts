/**
 * idle-dark-forever 权威服务端入口
 *
 * 启动顺序**不可交换**，每一步的理由：
 *
 * 1. `import 'reflect-metadata'`         —— 必须最先：NestJS / ionet 的装饰器元数据依赖它；
 * 2. `import 'dotenv/config'`            —— 必须早于业务模块：`app.module.ts` 在模块定义期
 *                                           就读 `process.env.IONET_ALLOW_PRODUCTION`；
 * 3. `NestFactory.create(AppModule)`     —— 建容器；
 * 4. `app.setGlobalPrefix('api')`        —— REST 统一挂 `/api`（ionet 自带的 HTTP fallback 已关，
 *                                           不会与 `/api/{cmd}/{subCmd}` 冲突）；
 * 5. `appRef.app = app`                  —— **必须在 app.init() 之前**：框架在 `onModuleInit`
 *                                           经 `resolveAction` 从容器解析 Action，需要 app 引用；
 * 6. `attachHttpServer(app.getHttpServer())` —— **必须在 app.init() 之前**：attach 模式要求
 *                                           应用侧先把共享 http.Server 推给框架，`onModuleInit`
 *                                           里 WS upgrade 监听才会挂到同一个 listener（单端口）；
 * 7. `await app.init()`                  —— 触发 `onModuleInit`：框架解析并注册 Action、
 *                                           挂载 `/ws` upgrade 监听；也在此初始化 WS 外部服；
 * 8. 重复路由断言                          —— 注册完成后校验 (cmd, subCmd) 唯一，冲突即启动失败；
 * 9. `app.listen(PORT)`                  —— 单端口承载 REST `/api` + WS `/ws`。
 *
 * 优雅关闭：`enableShutdownHooks()` 让 SIGINT/SIGTERM 触发 `onModuleDestroy`
 * （关闭 WS 外部服、释放 pg 连接池）。
 */
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { IONET_BAR_SKELETON, IonetModule } from '@nbb-ionet/extension-nestjs';
import { type BarSkeleton } from '@nbb-ionet/core-framework';
import { AppModule } from './app.module.js';
import { ActionResultExceptionFilter } from './common/filters/action-result-exception.filter.js';
import { appRef } from './ionet/app-ref.js';
import { assertNoDuplicateRoutes, assertPublicActionsRegistered } from './ionet/route-check.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // REST 统一前缀（WS 走 /ws，不受影响）
  app.setGlobalPrefix('api');

  // 未捕获异常统一成 ActionResult 失败体（避免裸 500 丢机器可读错误码）
  app.useGlobalFilters(new ActionResultExceptionFilter());

  // resolveAction 需要 app 引用；必须早于 init() 触发 onModuleInit
  appRef.app = app;

  // attach 模式：把 NestJS 的 http.Server 交给 ionet 外部服；必须早于 init()
  app.get(IonetModule).attachHttpServer(app.getHttpServer());

  // SIGINT/SIGTERM → onModuleDestroy（关 WS、释放连接池）
  app.enableShutdownHooks();

  // 触发 onModuleInit：框架从容器解析 Action、注册进骨架、挂 /ws upgrade 监听
  await app.init();

  // 注册完成后做全局重复路由断言（同一 cmd/subCmd 只能有一个 Action）
  const skeleton = app.get<BarSkeleton>(IONET_BAR_SKELETON);
  const routes = skeleton.actionCommandRegions.getAllActionCommands().map((command) => ({
    cmd: command.cmdInfo.cmd,
    subCmd: command.cmdInfo.subCmd,
    label: `${command.actionControllerClass.name}.${command.methodName}`,
  }));
  assertNoDuplicateRoutes(routes);
  // 免鉴权白名单（协议 PUBLIC_ACTION_KEYS）必须都已注册，防段位漂移
  assertPublicActionsRegistered(routes);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[idle-dark-forever] HTTP http://localhost:${port}/api`);
  console.log(`[idle-dark-forever] WS   ws://localhost:${port}/ws`);
}

void bootstrap();
