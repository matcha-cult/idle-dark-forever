/**
 * RootStoreContext —— 把 `RootStore` 注入 React 树（唯一的全局依赖入口）。
 *
 * 业务组件只通过 `useRootStore()` 取 store；测试可包一层 Provider 注入替身。
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { RootStore } from './root-store.js';

const RootStoreContext = createContext<RootStore | null>(null);

export interface RootStoreProviderProps {
  value: RootStore;
  children: ReactNode;
}

export function RootStoreProvider({ value, children }: RootStoreProviderProps) {
  return <RootStoreContext.Provider value={value}>{children}</RootStoreContext.Provider>;
}

export function useRootStore(): RootStore {
  const store = useContext(RootStoreContext);
  if (store === null) throw new Error('useRootStore 必须在 <RootStoreProvider> 内使用');
  return store;
}
