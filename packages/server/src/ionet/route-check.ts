/**
 * Action 路由表检查（纯逻辑，便于单元测试）
 *
 * 同一 `(cmd, subCmd)` 只能注册一个 Action；重复即启动期失败
 * （否则框架后注册者覆盖先注册者，且没有任何提示）。
 */
import { PUBLIC_ACTION_KEYS, cmdMerge } from './cmd.js';

export interface RouteEntry {
  cmd: number;
  subCmd: number;
  /** 人类可读来源，用于报错（通常是 `ClassName.methodName`）。 */
  label: string;
}

export interface DuplicateRoute {
  cmd: number;
  subCmd: number;
  labels: string[];
}

export function findDuplicateRoutes(entries: readonly RouteEntry[]): DuplicateRoute[] {
  const seen = new Map<number, { cmd: number; subCmd: number; labels: string[] }>();
  for (const entry of entries) {
    const key = cmdMerge(entry.cmd, entry.subCmd);
    const bucket = seen.get(key);
    if (bucket) {
      bucket.labels.push(entry.label);
    } else {
      seen.set(key, { cmd: entry.cmd, subCmd: entry.subCmd, labels: [entry.label] });
    }
  }
  return [...seen.values()].filter((bucket) => bucket.labels.length > 1);
}

/** 冲突即 throw（main.ts 在 app.init() 之后、listen 之前调用）。 */
export function assertNoDuplicateRoutes(entries: readonly RouteEntry[]): void {
  const duplicates = findDuplicateRoutes(entries);
  if (duplicates.length === 0) return;
  const detail = duplicates
    .map((item) => `cmd=${item.cmd} subCmd=${item.subCmd}（${item.labels.join(', ')}）`)
    .join('；');
  throw new Error('[ionet] 重复路由：' + detail);
}

function describeKey(key: number): string {
  return `cmd=${key >>> 16} subCmd=${key & 0xffff}`;
}

/**
 * 免鉴权白名单（协议 `PUBLIC_ACTION_KEYS`）中**没有**对应已注册 Action 的路由键。
 *
 * 防的是「协议登记了 public 路由（如 system.ping / system.version / auth.login），
 * 服务端改段位或漏注册」的静默漂移——这类漂移不会报错，只会让客户端拿到 404 或
 * 让本该免鉴权的探测被握手 401 拒掉。
 */
export function findUnregisteredPublicActions(entries: readonly RouteEntry[]): number[] {
  const registered = new Set(entries.map((item) => cmdMerge(item.cmd, item.subCmd)));
  return [...PUBLIC_ACTION_KEYS].filter((key) => !registered.has(key));
}

/** 白名单漂移即 throw（启动期兜底断言）。 */
export function assertPublicActionsRegistered(entries: readonly RouteEntry[]): void {
  const missing = findUnregisteredPublicActions(entries);
  if (missing.length === 0) return;
  throw new Error('[ionet] 免鉴权白名单存在未注册路由：' + missing.map(describeKey).join('；'));
}
