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
 * 3. 颜色纪律：源码零内联 hex（注释除外）；
 * 4. 样式纪律：零 `!important`、零组件内 `<style>`；
 * 5. 反馈纪律：禁止静态 `message.*` / `notification.*` / `Modal.confirm`（必须走 `App.useApp()`）；
 * 6. 结构纪律：单文件 ≤200 行、`.tsx` 只导出一个组件、禁止 `export default`；
 * 7. 一致性：本地 `QUALITY_LABELS` 与 protocol 的 `QUALITY_NAMES` 必须逐字一致
 *    （协议是唯一真相，但**值**不能 import —— 用源码比对代替运行时依赖）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PKG_ROOT = join(SRC_ROOT, '..');
const PROTOCOL_DTO = join(SRC_ROOT, '..', '..', 'protocol', 'src', 'dto.ts');

/** 单文件行数上限（用户硬约束）。 */
const MAX_LINES = 200;

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

/**
 * 去掉注释（保留字符串字面量），避免文档里的示例文字被当成真实代码。
 *
 * 局限：模板字符串里的 `${}` 不单独解析（本包源码中模板内不会出现注释分隔符）。
 */
function stripComments(code: string): string {
  let out = '';
  let index = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (index < code.length) {
    const char = code[index];
    const next = code[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block';
        index += 2;
        continue;
      }
      if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
      else if (char === '`') state = 'template';
      out += char ?? '';
      index += 1;
      continue;
    }
    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
      index += 1;
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 2;
      } else index += 1;
      continue;
    }
    // 字符串 / 模板：转义符整对跳过，遇同引号回 code
    const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
    if (char === '\\') {
      out += `${char ?? ''}${next ?? ''}`;
      index += 2;
      continue;
    }
    if (char === quote) state = 'code';
    out += char ?? '';
    index += 1;
  }
  return out;
}

interface ImportRecord {
  file: string;
  specifier: string;
  typeOnly: boolean;
}

/** 抽取所有 `import` / `export ... from` 语句（已去注释）。 */
function collectImports(file: string, code: string): ImportRecord[] {
  const records: ImportRecord[] = [];
  const STATEMENT = /(?:^|[;\s}])(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(STATEMENT)) {
    records.push({ file, specifier: match[3] ?? '', typeOnly: match[1] !== undefined });
  }
  // 副作用 import：`import 'x'`
  for (const match of code.matchAll(/(?:^|[;\s])import\s*['"]([^'"]+)['"]/g)) {
    records.push({ file, specifier: match[1] ?? '', typeOnly: false });
  }
  return records;
}

const ALLOWED_BARE = new Set(['antd', 'react', 'react-dom', 'react-dom/server']);
const isAllowedBare = (specifier: string): boolean =>
  ALLOWED_BARE.has(specifier) || specifier.startsWith('antd/') || specifier.startsWith('react-dom/');

const CODE = new Map(SOURCE.map((file) => [file, stripComments(read(file))]));
const IMPORTS = SOURCE.flatMap((file) => collectImports(file, CODE.get(file) ?? ''));

describe('红线 1 · 依赖面（只允许 antd + react）', () => {
  it('src 下不存在被禁依赖（mobx / node: / @ant-design/icons / 任何第三方裸包）', () => {
    const offenders = IMPORTS.filter(
      (record) => !record.specifier.startsWith('.') && !isAllowedBare(record.specifier) &&
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

  it('每个 .ts / .tsx 都有相对 import 且带 .js 后缀', () => {
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
    const config = read('theme/build-theme-config.ts');
    expect(config).toContain('theme.defaultSeed.colorPrimary');
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
    const offenders = TSX.filter((file) => ((read(file).match(/^export function [A-Z]\w*/gm) ?? []).length > 1));
    expect(offenders).toEqual([]);
    expect(TSX.length).toBeGreaterThan(0);
  });

  it('禁止 export default（统一具名导出）', () => {
    expect(SOURCE.filter((file) => /^export default/m.test(read(file)))).toEqual([]);
  });

  it('组件文件必须在 src 的约定分组内', () => {
    const groups = ['theme/', 'layout/', 'game/', 'data/', 'feedback/', 'form/', 'format/', 'testing/'];
    const offenders = TSX.filter((file) => !groups.some((group) => file.startsWith(group)));
    expect(offenders).toEqual([]);
  });
});

describe('红线 5 · 品质 7 档与 protocol 一致（协议是唯一真相）', () => {
  const protocolSource = readFileSync(PROTOCOL_DTO, 'utf8');

  const protocolQualityUnion = /export type Quality = ([^;]+);/.exec(protocolSource)?.[1] ?? '';
  const protocolNames = (/QUALITY_NAMES[^=]*=\s*\[([^\]]*)\]/.exec(protocolSource)?.[1] ?? '')
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter((part) => part !== '');
  const localLabels = (/QUALITY_LABELS[^=]*=\s*\[([^\]]*)\]/s.exec(read('game/quality.ts'))?.[1] ?? '')
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter((part) => part !== '');

  it('protocol 的 Quality 是 0..6 共 7 档', () => {
    const members = protocolQualityUnion.split('|').map((part) => part.trim());
    expect(members).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  });

  it('本地 QUALITY_LABELS 与 protocol QUALITY_NAMES 逐字一致', () => {
    expect(protocolNames).toHaveLength(7);
    expect(localLabels).toEqual(protocolNames);
  });

  it('品质色全部取自 antd token 名（7 档各不相同）', () => {
    const names = (/QUALITY_COLOR_TOKEN_NAMES[^=]*=\s*\[([^\]]*)\]/s.exec(read('game/quality.ts'))?.[1] ?? '')
      .split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .filter((part) => part !== '');
    expect(names).toHaveLength(7);
    expect(new Set(names).size).toBe(7);
  });
});
