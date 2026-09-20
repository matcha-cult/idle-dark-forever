// @vitest-environment node
/**
 * ui-kit 源码红线门禁（**可执行的门禁，不是注释里的纪律**）。
 *
 * 这些规则是本 package 的存在意义：任何一条被破坏，`pnpm test` 立刻失败。
 * 因此本文件必须跑在 Node 环境（用 `node:fs` 扫源码；jsdom 下 `import.meta.url`
 * 不是 file: URL，`new URL(..., import.meta.url)` 会抛 ERR_INVALID_URL_SCHEME）。
 *
 * 覆盖的约束：
 * 1. 依赖面：只允许 `antd` / `antd/*` / `react` / `react-dom` 与相对路径；
 *    `@idle-dark/protocol` **只允许 `import type`**（运行时零依赖）；禁止 mobx / node:* /
 *    任何其他裸包（含 `@ant-design/icons` —— 它不是 peer 依赖）；
 * 2. 目录纪律：相对 import 必须带 `.js` 后缀（`verbatimModuleSyntax` + ESM 输出）；
 * 3. 颜色纪律：源码（去注释后）零内联 hex；
 * 4. 样式纪律：零 `!important`、零组件内 `<style>`；
 * 5. 反馈纪律：禁止静态 `message.*` / `notification.*` / `Modal.confirm`（须走 `App.useApp()`）；
 * 6. 结构纪律：单文件 ≤200 行、`.tsx` 只导出一个组件、禁止 `export default`。
 *
 * 品质 3 档与 protocol `QUALITY_NAMES` 的一致性断言在 `game/quality.test.ts`
 * （它是那条规则的天然归属地，也避免本文件膨胀）。
 *
 * 测试文件（`*.test.ts(x)`）自身**不在扫描范围内**：它们允许 import `node:`、
 * 允许出现用于比对的 hex 正则字面量，且不受行数上限约束（上限针对会被拆分的组件源码）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectImports, isAllowedBare, stripComments } from './testing/hygiene-scan.js';

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PKG_ROOT = join(SRC_ROOT, '..');

/** 单文件行数上限（用户硬约束）。 */
const MAX_LINES = 200;

/** 组件文件必须落在约定分组内。 */
const GROUPS = ['theme/', 'layout/', 'game/', 'data/', 'feedback/', 'form/', 'format/', 'testing/'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** 相对 src 的 POSIX 路径（断言信息可读）。 */
const ALL = walk(SRC_ROOT).map((file) => relative(SRC_ROOT, file).split(sep).join('/'));
const SOURCE = ALL.filter((file) => !/\.test\.tsx?$/.test(file));
const TSX = SOURCE.filter((file) => file.endsWith('.tsx'));

const read = (file: string): string => readFileSync(join(SRC_ROOT, file), 'utf8');
const lineCount = (file: string): number => read(file).split('\n').length;

/** 去注释后的源码（字符串字面量保留，因此字符串里的 hex 依然会被抓到）。 */
const CODE = new Map(SOURCE.map((file) => [file, stripComments(read(file))]));
const IMPORTS = SOURCE.flatMap((file) => collectImports(file, CODE.get(file) ?? ''));

describe('红线 1 · 依赖面（只允许 antd + react）', () => {
  it('src 下不存在被禁依赖（mobx / node: / @ant-design/icons / 任何第三方裸包）', () => {
    const offenders = IMPORTS.filter(
      (record) =>
        !record.specifier.startsWith('.') &&
        !isAllowedBare(record.specifier) &&
        !record.specifier.startsWith('@idle-dark/'),
    ).map((record) => `${record.file} → ${record.specifier}`);
    expect(offenders).toEqual([]);
  });

  it('@idle-dark/protocol 只以 `import type` 形式出现（运行时零依赖）', () => {
    const protocolImports = IMPORTS.filter((record) => record.specifier.startsWith('@idle-dark/'));
    const valueImports = protocolImports
      .filter((record) => !record.typeOnly)
      .map((record) => `${record.file} → ${record.specifier}`);
    expect(valueImports).toEqual([]);
    // 正向断言：确实存在 type-only 引用，否则「协议是类型唯一真相」名存实亡
    expect(protocolImports.length).toBeGreaterThan(0);
  });

  it('不存在运行时动态 import / require', () => {
    const offenders = SOURCE.filter((file) => /\bimport\s*\(|\brequire\s*\(/.test(CODE.get(file) ?? ''));
    expect(offenders).toEqual([]);
  });

  it('package.json 的 dependencies / peerDependencies 只有 antd + react', () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    expect(Object.keys(pkg.peerDependencies ?? {}).sort()).toEqual(['antd', 'react', 'react-dom']);
  });

  it('相对 import 必须带 .js 后缀', () => {
    const offenders = IMPORTS.filter(
      (record) => record.specifier.startsWith('.') && !record.specifier.endsWith('.js'),
    ).map((record) => `${record.file} → ${record.specifier}`);
    expect(offenders).toEqual([]);
  });
});

describe('红线 2 · 颜色不得内联 hex', () => {
  const HEX = /#[0-9a-fA-F]{3,8}\b/;

  it('源码（去注释后）零 hex 颜色', () => {
    const offenders = SOURCE.filter((file) => HEX.test(CODE.get(file) ?? '')).map((file) => {
      const line = (CODE.get(file) ?? '').split('\n').findIndex((text) => HEX.test(text)) + 1;
      return `${file}:${line}`;
    });
    expect(offenders).toEqual([]);
  });

  it('主题缺省主色来自 antd seed token，而不是本仓写死的色值', () => {
    expect(read('theme/build-theme-config.ts')).toContain('theme.defaultSeed.colorPrimary');
  });

  it('组件取色一律经 theme.useToken()', () => {
    const colorUsers = TSX.filter((file) => /color[A-Z]|color:|background:/.test(CODE.get(file) ?? ''));
    const missing = colorUsers.filter((file) => !(CODE.get(file) ?? '').includes('theme.useToken()'));
    expect(missing).toEqual([]);
  });
});

describe('红线 3 · 样式与反馈 API 纪律', () => {
  it('不得使用 !important', () => {
    expect(SOURCE.filter((file) => (CODE.get(file) ?? '').includes('!important'))).toEqual([]);
  });

  it('不得在组件里注入 <style>', () => {
    expect(SOURCE.filter((file) => /<style[\s>]/.test(CODE.get(file) ?? ''))).toEqual([]);
  });

  it('不得静态导入 message / notification（必须走 App.useApp()）', () => {
    const STATIC_IMPORT = /import\s*\{[^}]*\b(?:message|notification)\b[^}]*\}\s*from\s*['"]antd['"]/;
    expect(SOURCE.filter((file) => STATIC_IMPORT.test(CODE.get(file) ?? ''))).toEqual([]);
  });

  it('不得调用 Modal 静态方法（Modal.confirm 等）', () => {
    const MODAL_STATIC = /\bModal\.(?:confirm|info|success|error|warning)\s*\(/;
    expect(SOURCE.filter((file) => MODAL_STATIC.test(CODE.get(file) ?? ''))).toEqual([]);
  });
});

describe('红线 4 · 结构与规模', () => {
  it(`单文件 ≤${MAX_LINES} 行`, () => {
    const tooLong = SOURCE.filter((file) => lineCount(file) > MAX_LINES).map(
      (file) => `${file}:${lineCount(file)}`,
    );
    expect(tooLong).toEqual([]);
  });

  it('一个 .tsx 只导出一个组件', () => {
    const offenders = TSX.filter((file) => (read(file).match(/^export function [A-Z]\w*/gm) ?? []).length > 1);
    expect(offenders).toEqual([]);
    expect(TSX.length).toBeGreaterThan(0);
  });

  it('禁止 export default（统一具名导出）', () => {
    expect(SOURCE.filter((file) => /^export default/m.test(read(file)))).toEqual([]);
  });

  it('组件文件落在约定分组内', () => {
    expect(TSX.filter((file) => !GROUPS.some((group) => file.startsWith(group)))).toEqual([]);
  });

  it('子路径 barrel 不导出 testing 工具（testing 只走 ./testing 子路径）', () => {
    expect(read('index.ts')).not.toContain('testing/');
  });
});
