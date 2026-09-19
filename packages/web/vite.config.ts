import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
// 本地调试默认值（前端端口 / 后端端口与地址）的唯一真相。
import devConfig from '../../dev.config.json';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * 被 alias 到源码、但**位于 vite root 之外**的工作区包。
 *
 * ⚠️ 为什么必须显式加进 watcher：
 * vite 的 root 是 `packages/web`，而 `packages/ui-kit/src`、`packages/ionet-transport/src`
 * 在 root 之外（由 `resolve.alias` 指过去）。**新增文件**总是从磁盘首读，不受影响；
 * 但**改写老文件**时 dev server 可能不 invalidate 模块图，一直重放旧版，甚至在文件写一半时
 * 读到撕裂内容并长期缓存 —— 表现为「磁盘对、单测绿、浏览器就是看不到新东西」。
 * 这不是可选优化，是必需项。
 */
const WORKSPACE_SRC = [
  path.resolve(here, '../ui-kit/src'),
  path.resolve(here, '../ionet-transport/src'),
  path.resolve(here, '../protocol/src'),
];

function watchWorkspaceSrc(): Plugin {
  return {
    name: 'idle-dark:watch-workspace-src',
    configureServer(server: ViteDevServer): void {
      server.watcher.add(WORKSPACE_SRC);
    },
  };
}

/**
 * 同源代理：REST `/api` 与 WS `/ws` 都打到后端，免 CORS。
 *
 * 默认值来自仓库根的 `dev.config.json`（与后端 `pnpm dev:server` 共用一份）；
 * `VITE_BACKEND_ORIGIN` 仍可临时覆盖。
 */
const backendHost = devConfig.backendHost;
const backendPort = devConfig.backendPort;
const target = process.env.VITE_BACKEND_ORIGIN ?? `http://${backendHost}:${backendPort}`;

/** 前端端口：`VITE_DEV_PORT` 优先，其次是 `dev.config.json`。 */
const frontendPort = ((): number => {
  const raw = Number(process.env.VITE_DEV_PORT ?? devConfig.frontendPort);
  return Number.isInteger(raw) && raw > 0 && raw < 65_536 ? raw : devConfig.frontendPort;
})();

export default defineConfig({
  plugins: [react(), watchWorkspaceSrc()],
  resolve: {
    alias: [
      // 子路径必须先于主入口匹配（字符串 alias 是前缀替换，顺序反了会拼错路径）
      {
        find: '@idle-dark/ionet-transport/testing',
        replacement: path.resolve(here, '../ionet-transport/src/testing/index.ts'),
      },
      {
        find: '@idle-dark/ionet-transport',
        replacement: path.resolve(here, '../ionet-transport/src/index.ts'),
      },
      {
        find: '@idle-dark/ui-kit/testing',
        replacement: path.resolve(here, '../ui-kit/src/testing/index.ts'),
      },
      {
        find: '@idle-dark/ui-kit',
        replacement: path.resolve(here, '../ui-kit/src/index.ts'),
      },
      {
        find: '@idle-dark/protocol',
        replacement: path.resolve(here, '../protocol/src/index.ts'),
      },
    ],
    // antd / react 必须单实例：ui-kit 与 web 都声明了它们，两份会导致 React context 不互通
    // （主题/语言不生效）。只列 web 自己声明了依赖的包。
    dedupe: ['react', 'react-dom', 'antd', '@ant-design/icons'],
  },
  server: {
    port: frontendPort,
    // 端口被占用时**直接失败**，不要静默换号 ——
    // 否则代理/收藏夹里那个地址会指向一个不存在的 dev server（曾因此误判"改了没生效"）。
    strictPort: true,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/ws': { target, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
