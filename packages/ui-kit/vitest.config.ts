import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

// vitest 1.6 的 worker 数两个坑（沿用参考实现的经验）：
//   1. `maxWorkers` 只接受数字，百分比字符串是 2.x 语法（NaN → RangeError）；
//   2. `minWorkers` 缺省为 numCpus - 1，任何小于它的 maxWorkers 都会撞
//      「minThreads and maxThreads must not conflict」。
// 因此两个一起钉死为「一半核数」，对核数不同的机器自适应。
const maxWorkers = Math.max(1, Math.floor(availableParallelism() / 2));

/**
 * ui-kit 测试配置。
 *
 * 本包**未安装 jsdom / @testing-library**（不允许新增依赖），因此所有渲染测试
 * 统一走 `react-dom/server` 的 `renderToString`（见 `src/testing/index.ts` 的
 * `renderToHtml`），运行在 vitest 默认的 node 环境。
 * `installViewportMock` 仍随 `@idle-dark/ui-kit/testing` 导出，供安装了 jsdom 的
 * 消费方（web 包）在 setup 里安装 matchMedia 桩。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers,
    minWorkers: maxWorkers,
  },
});
