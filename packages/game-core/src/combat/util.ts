/**
 * combat 内部工具。
 *
 * ⚠️ 本文件不在任务书列出的交付清单里，但 combat 的多个模块（unit / enemy-unit /
 * battle-world）都需要同一份 `camelCase` 与 `transformEquipLevel`，因此单独抽出避免复制。
 * 它只依赖 `contracts/data.ts` 的类型，不引入任何运行时依赖。
 */

/**
 * 原版使用 npm `camelcase` 包把 `'melee-absorb'` / `'postCost-hp'` 变成属性名。
 *
 * 真实用法只出现在 `damageType + '-absorb'` / `damageType + '-resist'` / `'postCost-' + k`
 * 三种形式，全部是「小写单词 + 连字符」，因此这里实现等价的严格子集。
 */
export function camelCase(input: string): string {
  return input.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** 资源/属性读取：把任意值规整为有限数（NaN / undefined / 非数字 → `fallback`）。 */
export function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

/**
 * 原版 `to[camelCase(damageType + '-absorb')] || 0` 的等价读取。
 *
 * 走 `Record<string, unknown>` 索引，getter 依旧会被触发（PlayerUnit / EnemyUnit
 * 用 getter 暴露 `fireAbsorb` 等），同时避免 `noUncheckedIndexedAccess` 报错。
 */
export function readAttr(target: object, key: string, fallback = 0): number {
  const value = (target as unknown as Record<string, unknown>)[key];
  // 对应原版 `|| 0`：0 / NaN / undefined / null 都落回 fallback。
  return toNumber(value, fallback);
}

/**
 * `EnemyData` 契约里没有声明 `maxMp` / `maxRp` / `critRate` / `allResist` 等
 * 原版实际存在的字段（见契约 `contracts/data.ts`）。为不修改冻结契约，这里统一
 * 用宽松读取。
 *
 * `TODO(port-uncertain)`：若数据表任务后续把这些字段补进 `EnemyData`（可选字段），
 * 应把这些读取替换为直接字段访问，以获得类型安全。
 */
export function readNumField(target: object, key: string, fallback = 0): number {
  return readAttr(target, key, fallback);
}

/** 宽松布尔读取（原版很多数据字段没有进契约）。 */
export function readBoolField(target: object, key: string, fallback = false): boolean {
  const value = (target as unknown as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : fallback;
}

/** 装备等级换算（原版 `src/logics/player.js` 第 106–117 行，逐字照抄）。 */
export function transformEquipLevel(level: number): number {
  if (level <= 120) {
    return Math.ceil(level / 2);
  }
  if (level <= 180) {
    return 60;
  }
  if (level <= 210) {
    return Math.ceil(level / 3);
  }
  return 70;
}

/** 原版 `src/logics/player.js` 第 119–127 行，逐字照抄。 */
export function untransformEquipLevel(level: number): number {
  if (level < 60) {
    return level * 2;
  } else if (level < 70) {
    return level * 3;
  } else {
    return 250;
  }
}

/**
 * `Math.max(0, Math.min(v, max))` 的资源夹取。
 *
 * 与原版 setter 的差异（有意）：`max` 非有限值时原版会产生 NaN；这里保持原样，
 * 不做额外兜底，以免掩盖数据错误（单测里专门覆盖 `maxHp === 0` 的边界）。
 */
export function clampResource(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}
