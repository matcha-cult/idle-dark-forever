/**
 * 应用实例持有者
 *
 * `IonetModule.forRoot({ resolveAction })` 的回调在 `AppModule` 的**模块定义期**就要给出，
 * 而那时 `NestFactory.create(AppModule)` 还没返回。框架把 Action 实例解析推迟到
 * `onModuleInit`（app 就绪后）执行，因此这里提供一个可变引用：
 *
 * - `main.ts` 在 `app.init()` **之前**写入；
 * - 框架在 `onModuleInit` 读取并 `app.get(ActionClass)`。
 */
import { type INestApplication } from '@nestjs/common';

export const appRef: { app?: INestApplication } = {};
