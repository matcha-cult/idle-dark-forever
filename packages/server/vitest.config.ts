import { defineConfig } from 'vitest/config';

/**
 * 单测配置（vitest）
 *
 * - `include`：只跑 test 目录下的 `*.test.ts`（测试不放进 src，避免被
 *   `tsc -p tsconfig.json` 编译进 dist；本工程 tsconfig 只 include src）；
 * - `setupFiles`：`reflect-metadata` —— 被测文件里可能 import 带 `@Injectable()` /
 *   `@Inject()` 装饰器的 Nest provider，`@Inject` 会调用 `Reflect.defineMetadata`；
 * - `test.environment: 'node'`：被测代码用 `node:async_hooks`（FlowContext）与 `node:crypto`。
 *
 * 注意：esbuild（vite 内部）不产出 `design:paramtypes`，因此**不要**在单测里依赖
 * Nest 容器按类型注入；需要构造时直接 `new` 并显式传参（本批测试全部这么做）。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
