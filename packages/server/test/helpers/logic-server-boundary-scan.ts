/**
 * 逻辑服边界扫描器（纯函数；供 `test/logic-server-boundary.test.ts` 使用）
 *
 * 为什么单独抽出来：架构门禁本身也必须有边界单测 —— 空目录、无法解析的 import、
 * 自环、**动态 import**、注释里的示例 import 都不得"静默通过"。
 *
 * 设计要点：
 * - **先剥注释**再解析：本仓多处 JSDoc 里有示例 `import ... from './modules/logic/panel-actions.js'`，
 *   不剥注释会把文档当成真实依赖（实测过）；
 * - 只解析**相对** import（`./`、`../`）—— 包依赖（`@idle-dark/*`、`@nbb-ionet/*`）不参与边界判定；
 * - ESM `.js` 后缀映射回 `.ts`（本仓 NodeNext 风格）；
 * - 解析不到目标文件的相对 import 记入 `unresolved`（须显式报告，不能忽略）；
 * - 动态 `import(变量)` 记入 `opaque`（无法静态判定 → 必须显式报告）。
 */
import fs from 'node:fs';

export type ImportKind = 'static' | 'dynamic' | 'require';

export interface ParsedImport {
  /** 字面量说明符；`null` = 非字面量（opaque，无法解析）。 */
  readonly specifier: string | null;
  readonly kind: ImportKind;
}

export interface SourceFile {
  /** 相对根目录的 posix 路径（如 `modules/logic/world/world.service.ts`）。 */
  readonly path: string;
  readonly source: string;
}

export interface ImportEdge {
  readonly from: string;
  readonly to: string;
  readonly specifier: string;
  readonly kind: ImportKind;
}

export interface UnresolvedImport {
  readonly from: string;
  readonly specifier: string;
  readonly kind: ImportKind;
}

export interface OpaqueImport {
  readonly from: string;
  readonly kind: ImportKind;
}

export interface ImportGraph {
  readonly files: string[];
  readonly edges: ImportEdge[];
  readonly unresolved: UnresolvedImport[];
  readonly opaque: OpaqueImport[];
}

/** 逐字符剥掉注释，保留字符串字面量（长度不变，便于定位）。 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (i < n) {
    const ch = source[i] as string;
    const next = i + 1 < n ? (source[i + 1] as string) : '';
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
      out += ch;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += ch;
      } else out += ' ';
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // 字符串内部：保留内容，处理转义与结束
    if (ch === '\\') {
      out += ch + next;
      i += 2;
      continue;
    }
    if (
      (state === 'single' && ch === "'") ||
      (state === 'double' && ch === '"') ||
      (state === 'template' && ch === '`')
    ) {
      state = 'code';
    }
    out += ch;
    i += 1;
  }
  return out;
}

const STATIC_RE = /(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_RE = /(?:^|[^\w$.])import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_OPAQUE_RE = /\bimport\s*\(\s*(?!['"])/g;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** 解析源码里的 import（静态 / 副作用 / 动态 / require）。 */
export function parseImports(source: string): ParsedImport[] {
  const code = stripComments(source);
  const out: ParsedImport[] = [];
  const push = (kind: ImportKind, specifier: string | null): void => {
    out.push({ kind, specifier });
  };
  for (const [kind, re] of [
    ['static', STATIC_RE],
    ['static', SIDE_EFFECT_RE],
    ['dynamic', DYNAMIC_RE],
    ['require', REQUIRE_RE],
  ] as const) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) push(kind, m[1] as string);
  }
  DYNAMIC_OPAQUE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DYNAMIC_OPAQUE_RE.exec(code)) !== null) push('dynamic', null);
  return out;
}

/** `path` → 候选文件（`.js` 映射 `.ts`，目录补 `index.ts`）。 */
export function resolveCandidates(fromPath: string, specifier: string): string[] {
  if (!specifier.startsWith('.')) return [];
  const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const joined = normalizePosix(`${fromDir}/${specifier}`);
  const noExt = joined.replace(/\.(js|ts|mjs|cjs)$/, '');
  return [joined.replace(/\.js$/, '.ts'), `${noExt}.ts`, `${noExt}/index.ts`];
}

function normalizePosix(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** 由内存文件集合构建 import 图。 */
export function buildGraph(files: readonly SourceFile[]): ImportGraph {
  const set = new Set(files.map((f) => f.path));
  const edges: ImportEdge[] = [];
  const unresolved: UnresolvedImport[] = [];
  const opaque: OpaqueImport[] = [];
  for (const file of files) {
    for (const parsed of parseImports(file.source)) {
      if (parsed.specifier === null) {
        opaque.push({ from: file.path, kind: parsed.kind });
        continue;
      }
      if (!parsed.specifier.startsWith('.')) continue;
      const target = resolveCandidates(file.path, parsed.specifier).find((c) => set.has(c));
      if (target === undefined) {
        unresolved.push({ from: file.path, specifier: parsed.specifier, kind: parsed.kind });
        continue;
      }
      edges.push({ from: file.path, to: target, specifier: parsed.specifier, kind: parsed.kind });
    }
  }
  return { files: [...set], edges, unresolved, opaque };
}

/** 从磁盘读取 `rootDir` 下的全部 `.ts`（可排除路径）。 */
export function readSourceFiles(rootDir: string, exclude: readonly string[] = []): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = `${dir}/${entry.name}`;
      const rel = abs.slice(rootDir.length + 1);
      if (exclude.some((e) => rel === e || rel.startsWith(`${e}/`))) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.ts')) {
        out.push({ path: rel, source: fs.readFileSync(abs, 'utf8') });
      }
    }
  };
  walk(rootDir);
  return out;
}

/** 文件 → 归属（逻辑服名 / 'shared' / 'unknown'）。命中多个根会全部返回。 */
export function ownersOf(
  filePath: string,
  serverRoots: readonly { name: string; roots: readonly string[] }[],
  sharedRoots: readonly string[],
): string[] {
  const hits = (root: string): boolean => filePath === root || filePath.startsWith(`${root}/`);
  const out: string[] = [];
  if (sharedRoots.some(hits)) out.push('shared');
  for (const server of serverRoots) {
    if (server.roots.some(hits)) out.push(server.name);
  }
  return out;
}

/** Tarjan SCC（返回长度 >1 的环，按节点数降序）。 */
export function findCycles(nodes: readonly string[], edges: readonly { from: string; to: string }[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list !== undefined && adj.has(e.to)) list.push(e.to);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  let counter = 0;
  const strongconnect = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp);
    }
  };
  for (const n of nodes) if (!index.has(n)) strongconnect(n);
  return out.sort((a, b) => b.length - a.length);
}
