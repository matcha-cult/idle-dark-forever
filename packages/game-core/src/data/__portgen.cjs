/**
 * 一次性移植脚本（不属于交付物，移植完成后删除）。
 *
 * 做两件事：
 *  1. 逐文件把原版 CommonJS 数据文件包成 IIFE（`module.exports = X` → `return X`），
 *     从而**原样保留函数体、类、模块级辅助函数**，只在返回类型上做上下文化；
 *  2. 对原版里无法直接通过 strict 的少数位置做定点补丁（见 PATCHES）。
 *
 * 用法：node __portgen.cjs [category...]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = '/home/nbb/projects/dark-forever-memorize/data';
const OUT = __dirname;

const HEADER = `/**
 * ⚠️ 由原版 \`data/{DIR}\` 机械移植（数值 / 函数体 / 注释逐字保留，未臆造任何数据）。
 *
 * 移植规则见 \`ai-docs/pending-data-port.md\`：
 *  - 原版 CommonJS 数据文件整体包进 IIFE，\`module.exports = X\` 变为 \`return X\`；
 *  - 函数体的 \`this\` / \`world\` / \`self\` 由 \`_shapes.ts\` 的视图类型提供上下文，契约参数类型不变；
 *  - 词缀 / 传奇的 \`generate(level)\` 改为 \`generate(level, rng)\`，内部 \`Math.random()\` → \`rng()\`。
 */
`;

// ─────────────────────────── 定点补丁 ───────────────────────────

/** @type {Record<string, Array<[RegExp, string]>>} */
const COMMON = [
  // 词缀 / 传奇：随机源改为注入的 Rng
  [/Math\.random\(\)/g, 'rng.next()'],
  [/generate\(level\)\s*\{/g, 'generate(level, rng) {'],
];

/** @type {Record<string, Array<[RegExp, string]>>} */
const PATCHES = {
  'buffs/sorceress.js': [
    // 该 buff 把 arg 当作 [rate, remain] 数组使用（原版 arg 是多态载荷）
    [/this\.arg\[0\]/g, '(this.arg as unknown as number[])[0]'],
    [/this\.arg\[1\]/g, '(this.arg as unknown as number[])[1]'],
    [/function addColdAir\(target\)/g, 'function addColdAir(target: UnitLike)'],
  ],
  'buffs/knight.js': [
    [/function addCombo\(self, count = 1\)/g, 'function addCombo(self: UnitLike, count = 1)'],
  ],
  'enhances/knight.js': [
    [/function addCombo\(self, count = 1\)/g, 'function addCombo(self: UnitLike, count = 1)'],
  ],
  'skills/knight.js': [
    [/function addCombo\(self, count = 1\)/g, 'function addCombo(self: UnitLike, count = 1)'],
    [/function useCombo\(self, count\)/g, 'function useCombo(self: UnitLike, count: number)'],
  ],
  'skills/sorceress.js': [
    [
      /function addFlaming\(self, target, value\)/g,
      'function addFlaming(self: UnitLike, target: UnitLike, value: number)',
    ],
    [/function magicArtist\(self, type\)/g, 'function magicArtist(self: UnitLike, type: string)'],
    [/buff\.arg !== type/g, '(buff.arg as unknown as string) !== type'],
    [/buff\.arg = type;/g, 'buff.arg = type as unknown as number;'],
    [/function addColdAir\(target\)/g, 'function addColdAir(target: UnitLike)'],
    [/function getLevelBonus\(level\)/g, 'function getLevelBonus(level: number)'],
  ],
  'skills/elementSummoner.js': [
    [/function getLevelBonus\(level\)/g, 'function getLevelBonus(level: number)'],
  ],
  'enemies/summon.element.js': [
    [/function getLevelBonus\(level\)/g, 'function getLevelBonus(level: number)'],
    [/^const elements = \[/m, 'const elements: EnemyEntry[] = ['],
    [/\.\.\.v\.v2Skills/g, '...(v.v2Skills ?? [])'],
  ],
  'skills/assassin.js': [
    [/function addCombo\(target, combo\)/g, 'function addCombo(target: UnitLike, combo: ComboLike)'],
    [/function comboCount\(target\)/g, 'function comboCount(target: UnitLike)'],
    [
      /function clearCombo\(world, self, target, limit, finalAttack\)/g,
      'function clearCombo(world: WorldLike, self: UnitLike, target: UnitLike, limit: number, finalAttack: AttackLike)',
    ],
    [/ {2}value;\n {2}constructor\(value\) \{/g, '  value: number;\n  constructor(value: number) {'],
    [
      /\n {2}effect\(world, self, finalAttack\) \{\}/g,
      '\n  effect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void {}',
    ],
    [
      /\n {2}postEffect\(world, self, finalAttack\) \{\}/g,
      '\n  postEffect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void {}',
    ],
    [
      /class MeleeCombo extends Combo \{\n {2}effect\(world, self, finalAttack\) \{/g,
      'class MeleeCombo extends Combo {\n  override effect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void {',
    ],
    [
      /class EnergyCombo extends Combo \{\n {2}effect\(world, self, finalAttack\) \{/g,
      'class EnergyCombo extends Combo {\n  override effect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void {',
    ],
    [
      /class BloodCombo extends Combo \{\n {2}postEffect\(world, self, finalAttack\) \{/g,
      'class BloodCombo extends Combo {\n  override postEffect(world: WorldLike, self: UnitLike, finalAttack: AttackLike): void {',
    ],
  ],
};

const SHAPE_TYPES = [
  'AttackLike',
  'BuffStateLike',
  'ComboLike',
  'SkillRef',
  'UnitLike',
  'WorldLike',
];

function transpile(rel, extraPatches) {
  let text = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const patches = [...(extraPatches || []), ...(PATCHES[rel] || []), ...COMMON];
  for (const [re, rep] of patches) text = text.replace(re, rep);
  if (!/^module\.exports\s*=/m.test(text)) {
    throw new Error(`${rel}: 未找到 module.exports`);
  }
  return text.replace(/^module\.exports\s*=/m, 'return ');
}

// ─────────────────────────── 文件布局（严格照原版 index.js 顺序） ───────────────────────────

const ARRAY = 'array';
const OBJECT = 'object';

const CATEGORIES = {
  roles: {
    out: 'roles.ts',
    constName: 'roles',
    entry: 'RoleEntry',
    dir: 'roles/',
    files: [['eyer.js', OBJECT], ['aleanor.js', OBJECT]],
  },
  careers: {
    out: 'careers.ts',
    constName: 'careers',
    entry: 'CareerEntry',
    dir: 'careers/',
    files: [
      ['warrior.js', OBJECT],
      ['sorceress.js', OBJECT],
      ['assassin.js', OBJECT],
      ['knight.js', OBJECT],
      ['elementSummoner.js', OBJECT],
    ],
  },
  passives: {
    out: 'passives.ts',
    constName: 'passives',
    entry: 'HookAbilityEntry',
    dir: 'passives/',
    files: [['base.js', ARRAY], ['warrior.js', ARRAY], ['sorceress.js', ARRAY], ['assassin.js', ARRAY]],
  },
  enhances: {
    out: 'enhances.ts',
    constName: 'enhances',
    entry: 'HookAbilityEntry',
    dir: 'enhances/',
    files: [
      ['warrior.js', ARRAY],
      ['sorceress.js', ARRAY],
      ['assassin.js', ARRAY],
      ['knight.js', ARRAY],
      ['elementSummoner.js', ARRAY],
    ],
  },
  medicines: {
    out: 'medicines.ts',
    constName: 'medicines',
    entry: 'MedicineEntry',
    dir: '',
    files: [['medicines.js', ARRAY]],
  },
  goods: {
    out: 'goods.ts',
    constName: 'goods',
    entry: 'GoodEntry',
    dir: 'goods/',
    files: [
      ['junks.js', ARRAY],
      ['materials.js', ARRAY],
      ['weapons.js', ARRAY],
      ['armors.js', ARRAY],
      ['jewels.js', ARRAY],
    ],
  },
  affixes: {
    out: 'affixes.ts',
    constName: 'affixes',
    entry: 'AffixEntry',
    dir: 'affixes/',
    files: [['base.js', ARRAY], ['level2.js', ARRAY]],
  },
  'enemy-affixes': {
    out: 'enemy-affixes.ts',
    constName: 'enemyAffixes',
    entry: 'EnemyAffixEntry',
    dir: 'enemyAffixes/',
    files: [['base.js', ARRAY]],
  },
  buffs: {
    out: 'buffs.ts',
    constName: 'buffs',
    entry: 'BuffEntry',
    dir: 'buffs/',
    files: [
      ['warrior.js', ARRAY],
      ['enemies.js', ARRAY],
      ['sorceress.js', ARRAY],
      ['assassin.js', ARRAY],
      ['knight.js', ARRAY],
      ['simba.js', ARRAY],
      ['elementSummoner.js', ARRAY],
      ['shrine.js', ARRAY],
    ],
  },
  legends: {
    out: 'legends.ts',
    constName: 'legends',
    entry: 'LegendEntry',
    dir: 'legends/',
    files: [['s1.js', ARRAY], ['s2.js', ARRAY]],
  },
  enemies: {
    out: 'enemies.ts',
    constName: 'enemies',
    entry: 'EnemyEntry',
    dir: 'enemies/',
    files: [
      ['slime.js', ARRAY], ['wolfs.js', ARRAY], ['kobolds.js', ARRAY], ['fireElements.js', ARRAY],
      ['zombie.js', ARRAY], ['knights.js', ARRAY], ['chapter3.undeads.js', ARRAY],
      ['chapter3.beast.js', ARRAY], ['chapter3.murloc.js', ARRAY], ['chapter3.fishzilla.js', ARRAY],
      ['chapter3.elements.js', ARRAY], ['chapter3.waterElements.js', ARRAY], ['chapter4.orcs.js', ARRAY],
      ['chapter4.humans.js', ARRAY], ['chapter4.humans1.js', ARRAY], ['chapter4.humans2.js', ARRAY],
      ['summon.assassin.js', ARRAY], ['summon.element.js', ARRAY], ['shrine.js', ARRAY],
      ['silver.warrior.js', ARRAY], ['silver.assassin.js', ARRAY], ['silver.sorceress.js', ARRAY],
      ['silver.summoner.js', ARRAY], ['silver.knight.js', ARRAY], ['chapter5.undeads.js', ARRAY],
      ['chapter5.woodElf.js', ARRAY], ['chapter5.daughter.js', ARRAY],
    ],
    extraImports: ['EnemyEntry'],
  },
  skills: {
    out: 'skills.ts',
    constName: 'skills',
    entry: 'SkillEntry',
    dir: 'skills/',
    files: [
      ['base.js', ARRAY], ['warrior.js', ARRAY], ['sorceress.js', ARRAY], ['assassin.js', ARRAY],
      ['knight.js', ARRAY], ['elementSummoner.js', ARRAY], ['enemy.js', ARRAY],
    ],
  },
  maps: {
    out: 'maps.ts',
    constName: 'maps',
    entry: 'MapEntry',
    dir: 'maps/',
    files: [
      ['home.js', OBJECT],
      ['town/street.js', ARRAY], ['town/cave.js', ARRAY], ['town/cave2.js', ARRAY],
      ['town/valley.js', ARRAY], ['town/woods.js', ARRAY], ['town/mine-1.js', ARRAY],
      ['town/mine-2.js', ARRAY], ['town/mine-3.js', ARRAY], ['town/neighbourTown.js', ARRAY],
      ['town/neighbourTown-1.js', ARRAY], ['town/neighbourTown-2.js', ARRAY],
      ['chapter3/road.js', ARRAY], ['chapter3/shelter773.js', ARRAY], ['chapter3/wood.js', ARRAY],
      ['chapter3/wood1.js', ARRAY], ['chapter3/auran.js', ARRAY], ['chapter3/auran1.js', ARRAY],
      ['chapter3/auran2.js', ARRAY], ['chapter3/tower1.js', ARRAY], ['chapter3/tower2.js', ARRAY],
      ['chapter3/auran3.js', ARRAY], ['chapter3/auran4.js', ARRAY],
      ['chapter4/westRolan.js', ARRAY], ['chapter4/westRolan1.js', ARRAY], ['chapter4/westRolan2.js', ARRAY],
      ['chapter4/sanAnthony.js', ARRAY], ['chapter4/sanAnthony1.js', ARRAY], ['chapter4/sanAnthony2.js', ARRAY],
      ['silver/warrior.js', ARRAY], ['silver/assassin.js', ARRAY], ['silver/sorceress.js', ARRAY],
      ['silver/summoner.js', ARRAY], ['silver/knight.js', ARRAY],
      ['chapter5/byer1.js', ARRAY], ['chapter5/byer2.js', ARRAY], ['chapter5/byer3.js', ARRAY],
      ['chapter5/byer4.js', ARRAY], ['chapter5/byer5.js', ARRAY], ['chapter5/byer6.js', ARRAY],
    ],
  },
};

const PLAIN_FILES = {
  upgrades: { out: 'upgrades.ts', constName: 'upgrades', type: 'UpgradesData', src: 'upgrades.js', dir: '' },
  announcement: { out: 'announcement.ts', constName: 'announcement', type: 'AnnouncementData', src: 'annoucement.js', dir: '' },
};

function emitCategory(key) {
  const cfg = CATEGORIES[key];
  const chunks = [];
  const names = [];
  cfg.files.forEach(([file, mode], i) => {
    const varName = `__${key.replace(/[^A-Za-z0-9_]/g, '_')}_${i}`;
    names.push({ varName, mode });
    const body = transpile(cfg.dir + file, null);
    const retType = mode === ARRAY ? `${cfg.entry}[]` : cfg.entry;
    chunks.push(
      `// ── 原 data/${cfg.dir}${file} ──\nconst ${varName} = ((): ${retType} => {\n${body}\n})();\n`,
    );
  });
  const imports = new Set(SHAPE_TYPES.filter((t) => t !== 'SkillRef'));
  imports.add(cfg.entry);
  for (const t of cfg.extraImports || []) imports.add(t);
  const spread = names
    .map(({ varName, mode }) => (mode === ARRAY ? `...${varName}` : varName))
    .join(',\n  ');
  const content = `${HEADER.replace('{DIR}', cfg.dir || '.')}
import type { ${[...imports].sort().join(', ')} } from './_shapes.js';
import { arrayToMap } from './_util.js';

${chunks.join('\n')}
export const ${cfg.constName}: Record<string, ${cfg.entry}> = arrayToMap([
  ${spread},
]);
`;
  fs.writeFileSync(path.join(OUT, cfg.out), content);
  return `${cfg.out}: ${cfg.files.length} 源文件`;
}

function emitPlain(key) {
  const cfg = PLAIN_FILES[key];
  const body = transpile(cfg.src, null);
  const content = `${HEADER.replace('{DIR}', '.')}
import type { ${cfg.type} } from '../contracts/data.js';

const __value = ((): ${cfg.type} => {
${body}
})();

export const ${cfg.constName}: ${cfg.type} = __value;
`;
  fs.writeFileSync(path.join(OUT, cfg.out), content);
  return `${cfg.out}: 1 源文件`;
}

// ─────────────────────────── stories（纯数据，运行时提取最省事且零改写） ───────────────────────────

function tsString(s) {
  return JSON.stringify(s);
}

function serialize(value, key) {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (key === 'script') {
      return '`' + value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
    }
    return tsString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[\n' + value.map((v) => '  ' + serialize(v).replace(/\n/g, '\n  ')).join(',\n') + ',\n]';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return (
      '{\n' +
      keys
        .map((k) => `  ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : tsString(k)}: ${serialize(value[k], k)}`)
        .join(',\n') +
      ',\n}'
    );
  }
  throw new Error('unserializable: ' + typeof value);
}

function emitStories() {
  const stories = require(path.join(SRC, 'stories/index.js'));
  const content = `${HEADER.replace('{DIR}', 'stories/')}
import type { StoryEntry } from './_shapes.js';
import { arrayToMap } from './_util.js';

const __stories: StoryEntry[] = ${serialize(stories)};

export const stories: Record<string, StoryEntry> = arrayToMap(__stories);
`;
  fs.writeFileSync(path.join(OUT, 'stories.ts'), content);
  return `stories.ts: ${stories.length} 条目（运行时提取）`;
}

// ─────────────────────────── packages ───────────────────────────

function transformPackage(rel, extra) {
  let text = fs.readFileSync(path.join(SRC, rel), 'utf8');
  text = text.replace(/^.*require\('\.\/base'\);\n/m, '');
  text = text.replace(/^const \{ define, extend \} = require\('\.\.\/util'\);\n/m, '');
  for (const [re, rep] of extra || []) text = text.replace(re, rep);
  text = text.replace(/\bdefine\(/g, 'define(tables, ').replace(/\bextend\(/g, 'extend(tables, ');
  return text;
}

function emitNightmare() {
  const files = [
    'packages/nightmare/base.js',
    'packages/nightmare/slime.js',
    'packages/nightmare/wolf.js',
    'packages/nightmare/kobold.js',
    'packages/nightmare/undead.js',
    'packages/nightmare/fire.js',
    'packages/nightmare/knight.js',
  ];
  const body = files.map((f) => `// ── ${f} ──\n${transformPackage(f)}`).join('\n');
  const content = `${HEADER.replace('{DIR}', 'packages/nightmare/')}
import type { MutableDataTables } from '../../contracts/data.js';
import { define, extend } from '../_util.js';

/**
 * 原版 \`data/packages/nightmare/index.js\` 的显式化：调用顺序 = require 顺序
 * （base → slime → wolf → kobold → undead → fire → knight）。
 *
 * 注意 \`nightmare/knight.js\` 里的 \`for (i of 1..3)\` 循环原样保留，
 * 其 \`name\` 表与模板字符串 key 都依赖循环变量。
 */
export function registerNightmare(tables: MutableDataTables): void {
${body}
}
`;
  fs.writeFileSync(path.join(OUT, 'packages/nightmare.ts'), content);
  return `packages/nightmare.ts: ${files.length} 源文件`;
}

function emitYear2018() {
  const files = [
    ['packages/year2018/legends.js', null],
    [
      'packages/year2018/redbag.js',
      [
        [
          /const \{ enemies, maps \} = require\('\.\.\/\.\.\/base'\);/,
          'const enemies = tables.enemies;\nconst maps = tables.maps;',
        ],
        [/const enemy = enemies\[key\];\n/, 'const enemy = enemies[key];\n  if (!enemy) continue;\n'],
        [/const map = maps\[key\];\n/, 'const map = maps[key];\n  if (!map) continue;\n'],
      ],
    ],
    ['packages/year2018/dungeon.js', null],
  ];
  const body = files.map(([f, extra]) => `// ── ${f} ──\n${transformPackage(f, extra)}`).join('\n');
  const content = `${HEADER.replace('{DIR}', 'packages/year2018/')}
import type { MutableDataTables } from '../../contracts/data.js';
import { define, extend } from '../_util.js';

/**
 * 原版 \`data/packages/year2018/index.js\` 的显式化：顺序 = require 顺序
 * （legends → redbag → dungeon），且注释明确「活动副本不掉落红包，所以顺序很重要」——
 * redbag 会给**当时已注册的**所有 enemies / maps 追加红包掉落，因此必须在 dungeon 之前。
 */
export function registerYear2018(tables: MutableDataTables): void {
${body}
}
`;
  fs.writeFileSync(path.join(OUT, 'packages/year2018.ts'), content);
  return `packages/year2018.ts: ${files.length} 源文件`;
}

// ─────────────────────────── main ───────────────────────────

const only = process.argv.slice(2);
const want = (k) => only.length === 0 || only.includes(k);
const report = [];
for (const key of Object.keys(CATEGORIES)) if (want(key)) report.push(emitCategory(key));
for (const key of Object.keys(PLAIN_FILES)) if (want(key)) report.push(emitPlain(key));
if (want('stories')) report.push(emitStories());
if (want('nightmare')) report.push(emitNightmare());
if (want('year2018')) report.push(emitYear2018());
console.log(report.join('\n'));
