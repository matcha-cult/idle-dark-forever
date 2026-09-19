/**
 * main.tsx —— 挂载入口。
 *
 * 顺序有讲究：
 * 1. 先构造组合根（`RootStore`）—— 构造函数零副作用，不读存储、不连 WS；
 * 2. `theme.hydrate()` 在**首次渲染前**恢复主题（`index.html` 的内联脚本已写好
 *    `data-theme`，这里只把同一份状态读进 store，避免闪烁与状态不一致）；
 * 3. `void bootstrap()` 恢复会话并（有 token 时）连 WS —— 不阻塞首帧。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { RootStore } from './app/root-store.js';
import { RootStoreProvider } from './app/root-context.js';
import { ThemeRoot } from './theme/theme-root.js';

const rootStore = new RootStore();
rootStore.theme.hydrate();
void rootStore.bootstrap();

const container = document.getElementById('root');
if (container === null) throw new Error('缺少 #root 容器');

createRoot(container).render(
  <React.StrictMode>
    <RootStoreProvider value={rootStore}>
      <ThemeRoot>
        <App />
      </ThemeRoot>
    </RootStoreProvider>
  </React.StrictMode>,
);
