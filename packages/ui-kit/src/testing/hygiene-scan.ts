/**
 * 门禁测试的**纯字符串**工具（无 fs、无 node: 依赖，因此它自己也能通过门禁）。
 *
 * 为什么单独成文件：`hygiene.test.ts` 是 src 里最长的文件，把扫描工具拆出来
 * 既让门禁本身满足「单文件 ≤200 行」，也让工具可被其它门禁测试复用。
 */

/** 一条 import / re-export 记录。 */
export interface ImportRecord {
  /** 相对 src 的文件路径。 */
  file: string;
  /** 模块说明符（`from '...'` 里的内容）。 */
  specifier: string;
  /** 是否 `import type`（运行时会被完全擦除）。 */
  typeOnly: boolean;
}

/**
 * 去掉注释（保留字符串字面量），避免文档里的示例文字被当成真实代码。
 *
 * 逐字符状态机：`//` 行注释、`/* *\/` 块注释、单/双引号、模板串。
 * 局限：模板串里的 `${}` 不单独解析（本包源码的模板内不含注释分隔符）。
 */
export function stripComments(code: string): string {
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
    // 字符串 / 模板：转义符整对跳过，遇同引号回到 code
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

/** 抽取所有 `import` / `export ... from` / 副作用 import 语句（入参须已去注释）。 */
export function collectImports(file: string, code: string): ImportRecord[] {
  const records: ImportRecord[] = [];
  const STATEMENT = /(?:^|[;\s}])(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(STATEMENT)) {
    records.push({ file, specifier: match[3] ?? '', typeOnly: match[1] !== undefined });
  }
  for (const match of code.matchAll(/(?:^|[;\s])import\s*['"]([^'"]+)['"]/g)) {
    records.push({ file, specifier: match[1] ?? '', typeOnly: false });
  }
  return records;
}

/** 允许的裸包说明符（peer 依赖：antd + react + react-dom，含 antd 子路径）。 */
export const ALLOWED_BARE: ReadonlySet<string> = new Set(['antd', 'react', 'react-dom', 'react-dom/server']);

/** 是否属于允许的裸包（`antd/locale/zh_CN` 这类子路径也算）。 */
export function isAllowedBare(specifier: string): boolean {
  return (
    ALLOWED_BARE.has(specifier) || specifier.startsWith('antd/') || specifier.startsWith('react-dom/')
  );
}

/** 抽取 `[a, b, c]` 形式的字符串数组字面量的元素（用于常量一致性比对）。 */
export function parseStringArrayLiteral(source: string, declaration: RegExp): string[] {
  const body = declaration.exec(source)?.[1] ?? '';
  return body
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter((part) => part !== '');
}
