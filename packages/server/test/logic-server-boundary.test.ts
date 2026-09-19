/**
 * 逻辑服架构边界门禁（08 §3；R1-b）
 *
 * 这是**会失败的测试**，不是文档约定。四类断言：
 * 1. **无环**：文件级 SCC = 0；逻辑服级图无环（含 world/story/inventory 三条已知环的回归）；
 * 2. **禁止跨服深路径 import**：只允许过渡白名单（`TRANSITIONAL_DEEP_IMPORTS`，禁止增长），
 *    且共享层不得反向依赖任何逻辑服；
 * 3. **cmd 段唯一归属**：`CMD_SEGMENTS` 的每一段恰好属于一个服；
 * 4. **逻辑服根下的 logic-server.ts 无业务**：导出 `XxxLogicServer` 且不得出现 `@ActionMethod`。
 *
 * 扫描器自身的边界（空集合 / 无法解析 / 自环 / 动态 import / 注释里的示例）单测覆盖。
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CMD_SEGMENTS } from '@idle-dark/protocol';
import {
  ALL_SERVER_DEFINITIONS,
  SERVER_DEFINITIONS,
  SHARED_ROOTS,
  TRANSITIONAL_DEEP_IMPORTS,
} from '../src/logic-servers/registry.js';
import {
  buildGraph,
  findCycles,
  ownersOf,
  parseImports,
  readSourceFiles,
  resolveCandidates,
  stripComments,
  type SourceFile,
} from './helpers/logic-server-boundary-scan.js';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

const SERVER_ROOTS = ALL_SERVER_DEFINITIONS.map((d) => ({ name: d.name, roots: [...d.roots] }));
const SERVER_NAMES = ALL_SERVER_DEFINITIONS.map((d) => d.name);

function ownerOf(file: string): string {
  const owners = ownersOf(file, SERVER_ROOTS, SHARED_ROOTS);
  if (owners.length !== 1) throw new Error(`文件归属不唯一：${file} → ${JSON.stringify(owners)}`);
  return owners[0] as string;
}

/** 判定一个逻辑服根下的 `logic-server.ts` 是否违反「不得写业务」（先剥注释）。 */
function logicServerViolations(files: readonly SourceFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!/^logic-servers\/[^/]+\/logic-server\.ts$/.test(f.path)) continue;
    const code = stripComments(f.source);
    if (code.includes('@ActionMethod')) out.push(`${f.path}: 含 @ActionMethod`);
    if (!/export class \w+LogicServer\b/.test(code)) out.push(`${f.path}: 未导出 XxxLogicServer`);
  }
  return out;
}

const realFiles = readSourceFiles(SRC_DIR);
const graph = buildGraph(realFiles);

describe('逻辑服边界门禁 · 真实源码', () => {
  it('扫描器覆盖全部源码且无未解析 / 不透明 import', () => {
    expect(graph.files.length).toBeGreaterThan(50);
    expect(graph.unresolved).toEqual([]);
    expect(graph.opaque).toEqual([]);
    // 每条相对 import 都能落到一个真实文件
    expect(graph.edges.length).toBeGreaterThan(100);
  });

  it('每个源码文件恰好归属一个逻辑服或共享层（无游离文件）', () => {
    const unknown: string[] = [];
    for (const file of graph.files) {
      const owners = ownersOf(file, SERVER_ROOTS, SHARED_ROOTS);
      if (owners.length !== 1) unknown.push(`${file} → ${JSON.stringify(owners)}`);
    }
    expect(unknown).toEqual([]);
  });

  it('文件级无环：SCC（>1）= 0', () => {
    const cycles = findCycles(graph.files, graph.edges);
    expect(cycles.map((c) => c.join(' <-> '))).toEqual([]);
  });

  it('逻辑服级无环（含 world/story/inventory 三条环的回归）', () => {
    const nodes = [...SERVER_NAMES, 'shared'];
    const edges = graph.edges.map((e) => ({ from: ownerOf(e.from), to: ownerOf(e.to) }));
    expect(findCycles(nodes, edges).map((c) => c.join(' <-> '))).toEqual([]);
  });

  it('三条已知环的边确实已消失（回归）', () => {
    const pairs = new Set(graph.edges.map((e) => `${e.from} -> ${e.to}`));
    expect(pairs.has('modules/logic/world/world.service.ts -> modules/logic/story/internal/story-ops.ts')).toBe(false);
    expect(pairs.has('modules/logic/story/story.logic.service.ts -> modules/logic/world/world.service.ts')).toBe(false);
    expect(pairs.has('modules/logic/inventory/inventory.logic.service.ts -> modules/logic/world/world.service.ts')).toBe(false);
    expect(pairs.has('modules/logic/career/career.logic.service.ts -> modules/logic/world/world.service.ts')).toBe(false);
    expect(pairs.has('modules/logic/produce/produce.logic.service.ts -> modules/logic/world/world.service.ts')).toBe(false);
  });

  it('共享层不反向依赖任何逻辑服', () => {
    const bad: string[] = [];
    for (const e of graph.edges) {
      if (ownerOf(e.from) !== 'shared') continue;
      const to = ownerOf(e.to);
      if (to !== 'shared') bad.push(`${e.from} (shared) -> ${e.to} (${to})`);
    }
    expect(bad).toEqual([]);
  });

  it('跨服深路径 import 恰好等于过渡白名单（禁止增长）', () => {
    const observed = new Set<string>();
    const detail: string[] = [];
    for (const e of graph.edges) {
      const from = ownerOf(e.from);
      const to = ownerOf(e.to);
      if (from === 'shared' || from === 'external' || to === 'shared' || from === to) continue;
      observed.add(`${from} -> ${to}`);
      detail.push(`${from} -> ${to}  (${e.from} → ${e.to})`);
    }
    const allowed = new Set(TRANSITIONAL_DEEP_IMPORTS.map((d) => `${d.from} -> ${d.to}`));
    expect([...observed].sort()).toEqual([...allowed].sort());
    // 白名单里的每条都必须真有依据（防止过期条目滞留）
    for (const d of TRANSITIONAL_DEEP_IMPORTS) {
      expect(d.reason.length).toBeGreaterThan(0);
      expect(observed.has(`${d.from} -> ${d.to}`)).toBe(true);
    }
    if (detail.length > 0) {
      // 帮助定位：把实际边打出来（失败时才有意义）
      expect(detail.length).toBeGreaterThan(0);
    }
  });

  it('cmd 段唯一归属且全覆盖', () => {
    const assigned = new Map<number, string>();
    for (const def of ALL_SERVER_DEFINITIONS) {
      for (const seg of def.cmdSegments) {
        expect(assigned.has(seg)).toBe(false);
        assigned.set(seg, def.name);
      }
    }
    const all = Object.values(CMD_SEGMENTS);
    expect([...assigned.keys()].sort((a, b) => a - b)).toEqual([...all].sort((a, b) => a - b));
  });

  it('每个 */logic-server.ts 导出 XxxLogicServer 且无 @ActionMethod', () => {
    const serverFiles = realFiles.filter((f) => /^logic-servers\/[^/]+\/logic-server\.ts$/.test(f.path));
    expect(serverFiles.map((f) => f.path).sort()).toEqual(
      SERVER_NAMES.map((n) => `logic-servers/${n}/logic-server.ts`).sort(),
    );
    expect(logicServerViolations(realFiles)).toEqual([]);
  });
});

describe('逻辑服边界门禁 · 扫描器边界', () => {
  it('stripComments：块注释 / 行注释被剥离，字符串与模板保留', () => {
    const src = [
      "import { a } from './real.js'; // import x from './fake-line.js'",
      "/* import y from './fake-block.js' */",
      "const url = 'http://x/y';",
      'const t = `a//b`;',
    ].join('\n');
    const out = stripComments(src);
    expect(out).toContain("'./real.js'");
    expect(out).not.toContain('fake-line');
    expect(out).not.toContain('fake-block');
    expect(out).toContain("'http://x/y'");
  });

  it('parseImports：JSDoc 里的示例 import 不计入真实依赖', () => {
    const src = `/**\n * import { X } from './modules/logic/panel-actions.js';\n */\nimport { real } from './real.js';`;
    const specs = parseImports(src).map((p) => p.specifier);
    expect(specs).toEqual(['./real.js']);
  });

  it('parseImports：动态 import（字面量 / 变量）与 require 都被识别', () => {
    const src = [
      "const a = await import('./lazy.js');",
      'const b = await import(someVar);',
      "const c = require('./legacy.js');",
    ].join('\n');
    const parsed = parseImports(src);
    expect(parsed.some((p) => p.kind === 'dynamic' && p.specifier === './lazy.js')).toBe(true);
    expect(parsed.some((p) => p.kind === 'dynamic' && p.specifier === null)).toBe(true);
    expect(parsed.some((p) => p.kind === 'require' && p.specifier === './legacy.js')).toBe(true);
  });

  it('buildGraph：空集合 / 无法解析 / 自环 / 不透明动态 import 均被显式记录', () => {
    expect(buildGraph([])).toEqual({ files: [], edges: [], unresolved: [], opaque: [] });

    const files: SourceFile[] = [
      { path: 'a.ts', source: "import './missing.js';\nimport './a.js';" },
      { path: 'b.ts', source: 'const m = await import(dynamicName);' },
    ];
    const g = buildGraph(files);
    expect(g.unresolved.map((u) => u.specifier)).toEqual(['./missing.js']);
    expect(g.edges.some((e) => e.from === 'a.ts' && e.to === 'a.ts')).toBe(true); // 自环被记录
    expect(g.opaque).toEqual([{ from: 'b.ts', kind: 'dynamic' }]);
  });

  it('findCycles：二元环 / 自环 / 无环 / 空图', () => {
    expect(findCycles([], [])).toEqual([]);
    expect(findCycles(['a', 'b'], [{ from: 'a', to: 'b' }])).toEqual([]);
    expect(findCycles(['a'], [{ from: 'a', to: 'a' }])).toEqual([]); // 单节点自环不计入 >1
    const cyc = findCycles(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]);
    expect(cyc).toHaveLength(1);
    expect(cyc[0]?.sort()).toEqual(['a', 'b']);
  });

  it('ownersOf：共享层优先且重叠根会全部返回（调用方须断言唯一）', () => {
    expect(ownersOf('common/x.ts', SERVER_ROOTS, SHARED_ROOTS)).toEqual(['shared']);
    expect(ownersOf('nope/x.ts', SERVER_ROOTS, SHARED_ROOTS)).toEqual([]);
    const owners = ownersOf('modules/logic/world/world.service.ts', SERVER_ROOTS, SHARED_ROOTS);
    expect(owners).toEqual(['battle']);
  });

  it('resolveCandidates：.js → .ts / index.ts / 越界 .. 归一', () => {
    expect(resolveCandidates('a/b.ts', '../c.js')).toContain('c.ts');
    expect(resolveCandidates('a/b.ts', './d/e.js')).toContain('a/d/e.ts');
    expect(resolveCandidates('a.ts', '@idle-dark/protocol')).toEqual([]);
  });

  it('logicServerViolations：检出 @ActionMethod / 缺少类导出（不静默通过）', () => {
    const bad: SourceFile[] = [
      { path: 'logic-servers/battle/logic-server.ts', source: 'export class BattleLogicServer { @ActionMethod() x() {} }' },
      { path: 'logic-servers/item/logic-server.ts', source: 'export const ItemLogicServer = 1;' },
    ];
    const issues = logicServerViolations(bad);
    expect(issues).toHaveLength(2);
    expect(issues.join('\n')).toContain('@ActionMethod');
    expect(issues.join('\n')).toContain('未导出');
  });
});

// 让 SERVER_DEFINITIONS 的键与 SERVER_NAMES 对齐（防止 hand-edit 漂移）
describe('registry 自洽', () => {
  it('registry 的键与 name 字段一致', () => {
    for (const [key, def] of Object.entries(SERVER_DEFINITIONS)) {
      expect(def.name).toBe(key);
    }
  });
});
