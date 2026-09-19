/**
 * 数据层组装工具。
 *
 * 对应原版 `data/base.js` 的 `arrayToMap` 与 `data/packages/util.js` 的 `define` / `extend` /
 * `mergeObject` —— 但**去掉了模块级副作用**：原版靠 `require('./packages/xxx')` 在 import 时原地改写
 * 全局注册表；现在改成 `packages/*.ts` 导出的 `register*(tables)` 显式函数，由 `index.ts`
 * 按原顺序调用。
 */

import type { DataTables, MutableDataTables } from '../contracts/data.js';
import type { DataEntryMap, DictTableName } from './_shapes.js';

/** 原版 `base.js#arrayToMap`：按 `item.key` 把数组转成记录。 */
export function arrayToMap<T extends { key: string }>(arr: readonly T[]): Record<string, T> {
  const ret: Record<string, T> = {};
  for (const item of arr) {
    ret[item.key] = item;
  }
  return ret;
}

/**
 * 原版 `packages/util.js#mergeObject` 的忠实移植。
 *
 * 语义：对 `updates` 的每个 key——
 *  - 普通对象 → 递归合并；
 *  - 函数 → 作为**变换器**调用 `fn(origin[key], merged)`，用返回值覆盖（原版靠这个把
 *    `canUse` / `effect` 包一层 BOSS 阶段判断）；
 *  - 其它（含数组、`null`）→ 直接覆盖。
 */
export function mergeObject(origin: unknown, updates: unknown): unknown {
  const ret: Record<string, unknown> = { ...(origin as Record<string, unknown> | undefined) };
  for (const key of Object.keys(updates as Record<string, unknown>)) {
    const update = (updates as Record<string, unknown>)[key];
    if (typeof update === 'object' && update !== null && !Array.isArray(update)) {
      ret[key] = mergeObject(ret[key], update);
    } else if (typeof update === 'function') {
      ret[key] = (update as (origin: unknown, merged: unknown) => unknown)(ret[key], ret);
    } else {
      ret[key] = update;
    }
  }
  return ret;
}

/** `define(type, key, info)`：写入一张新表项（原版会补上 `info.key = key`）。 */
export function define<K extends DictTableName>(
  tables: MutableDataTables,
  type: K,
  key: string,
  info: Omit<DataEntryMap[K], 'key'>,
): void {
  const table = tables[type] as unknown as Record<string, unknown>;
  table[key] = { ...info, key } as DataEntryMap[K];
}

/** `extend(type, key, origin, info)`：基于同表已有条目做深合并后覆盖同 key 条目。 */
export function extend<K extends DictTableName>(
  tables: MutableDataTables,
  type: K,
  key: string,
  origin: string,
  info: DeepUpdate<DataEntryMap[K]>,
): void {
  const table = tables[type] as unknown as Record<string, unknown>;
  if (!(origin in table)) {
    throw new Error(`data extend: ${type}.${origin} 不存在（key=${key}）`);
  }
  // 原版 `util.extend` 内部走的是 `define(type, key, merged)`，而 `define` 会把 `key` 覆写成新 key。
  // `mergeObject` 只做浅拷贝，会把 origin 的 `key` 一起带过来，因此这里必须显式覆写。
  table[key] = {
    ...(mergeObject(table[origin], info) as Record<string, unknown>),
    key,
  } as DataEntryMap[K];
}

/**
 * 把函数类型的全部形参变成可选。
 *
 * 原版 `extend` 的变换器经常「少调」原始 hook（`origin.call(this, world, self)` 而不是补上 level），
 * 这里让 `origin` 的形参可选，从而在不放宽**条目本身**签名的前提下兼容原版写法。
 */
export type LooseOrigin<F> = F extends (...args: infer A) => infer R
  ? (...args: Partial<A>) => R
  : never;

/**
 * `extend` 的更新体类型：对象递归、函数退化为「变换器」、数组整体替换。
 *
 * 原版 `extend('skills', 'a', 'b', { canUse(origin) { return function (...) {...} } })` 里的
 * `canUse` 就是这种变换器，因此这里必须把函数叶子重写成 `(origin, merged) => origin类型`。
 */
export type DeepUpdate<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends (...args: never[]) => unknown
    ? (origin: LooseOrigin<NonNullable<T[K]>>, merged: T) => T[K]
    : NonNullable<T[K]> extends readonly unknown[]
      ? T[K]
      : NonNullable<T[K]> extends object
        ? DeepUpdate<NonNullable<T[K]>>
        : T[K];
};

/**
 * 浅拷贝全部表 + 条目，并单独复制会被人为追加的 `loots` 数组。
 *
 * 原版 `createDefaultTables()` 只调用一次，所以可以直接改全局注册表；
 * 这里必须可重入（单测会反复调用），否则 `registerYear2018` 会把红包重复推进 `loots`。
 */
export function cloneTables(tables: DataTables): MutableDataTables {
  const out: Record<string, unknown> = {};
  for (const [tableName, table] of Object.entries(tables)) {
    if (table === null || typeof table !== 'object' || Array.isArray(table)) {
      out[tableName] = table;
      continue;
    }
    const copy: Record<string, unknown> = {};
    for (const [entryKey, entry] of Object.entries(table as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        copy[entryKey] = entry;
        continue;
      }
      const cloned: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
      if (Array.isArray(cloned['loots'])) {
        cloned['loots'] = [...cloned['loots']];
      }
      copy[entryKey] = cloned;
    }
    out[tableName] = copy;
  }
  return out as MutableDataTables;
}
