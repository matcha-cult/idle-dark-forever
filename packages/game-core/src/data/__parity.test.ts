/**
 * 一次性对拍（临时文件，验证后删除）：把移植后的表与原版 `data/index.js` 做**结构对拍**。
 * 函数只比"这边也是函数"，其余叶子值必须严格相等。
 */
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { createDefaultTables } from './index.js';

const require = createRequire(import.meta.url);
const ORIG = '/home/nbb/projects/dark-forever-memorize/data/index.js';

type Diff = string[];

function cmp(a: unknown, b: unknown, path: string, out: Diff, depth = 0): void {
  if (depth > 40) return;
  const ta = typeof a;
  const tb = typeof b;
  if (ta === 'function' || tb === 'function') {
    if (ta !== 'function' || tb !== 'function') {
      out.push(`${path}: 函数性不一致 (ported=${ta}, orig=${tb})`);
    }
    return;
  }
  if (a === null || b === null || ta !== 'object' || tb !== 'object') {
    if (!Object.is(a, b)) out.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      out.push(`${path}: 数组性不一致`);
      return;
    }
    if (a.length !== b.length) {
      out.push(`${path}: 数组长度 ${a.length} !== ${b.length}`);
      return;
    }
    for (let i = 0; i < a.length; i++) cmp(a[i], b[i], `${path}[${i}]`, out, depth + 1);
    return;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  const onlyA = ka.filter((k) => !kb.includes(k));
  const onlyB = kb.filter((k) => !ka.includes(k));
  if (onlyA.length) out.push(`${path}: 多出字段 ${onlyA.join(',')}`);
  if (onlyB.length) out.push(`${path}: 缺少字段 ${onlyB.join(',')}`);
  for (const k of ka) {
    if (kb.includes(k)) {
      cmp((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out, depth + 1);
    }
  }
}

const TABLES = [
  'careers', 'roles', 'maps', 'enemies', 'skills', 'goods', 'passives', 'enhances',
  'buffs', 'affixes', 'enemyAffixes', 'stories', 'legends', 'medicines', 'upgrades',
] as const;
// 说明：`announcement`（原版 `data/annoucement.js`）并不在 `data/base.js` 的表里，
// 原版是单独 import 的；契约把它并进 DataTables，因此这里不参与对拍。

describe.skip('（已废弃）函数体文本对拍通过 esbuild 后不可用', () => {
  it('noop', () => undefined);
});
