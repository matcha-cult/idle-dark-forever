/**
 * 单位状态差分 / 200ms 累计窗口组帧（P2 已切流，本模块是线上路径）
 *
 * **职责**：按「200ms 累计窗口 + 有变化才推 + 只推变化字段」算出这一窗口要发什么。
 * `null` = 本窗口完全无变化 ⇒ 调用方**不发送任何消息**。
 *
 * ## 为什么状态可以用「净差分」
 *
 * 200ms 是一个**累计窗口**：窗口内 hp 掉了又回、单位移动、目标切换，最终只关心
 * 「窗口末状态 vs 上次已发状态」的一次比较。所以**不需要 pending 变更队列** ——
 * 比较本身就完成了累计。
 *
 * ⚠️ **不能**因此认为「单位生了又死 = 什么都没发生」。引擎里对象在死亡后仍留在
 * `world.units` 里（`Unit.kill()` 只把 `camp` 切成 `ghost`，`EnemyUnit.clean()` 才
 * `removeUnit`，默认 3000ms 后），所以窗口末它仍在列表里，差分产出的是
 * `add({ hp<=0, camp:'ghost' })`。详见 `ai-docs/16`。
 *
 * ## 可变字段白名单是唯一真相
 *
 * 只有 `MUTABLE_UNIT_FIELDS` 里的字段会在单位出生后变化；其余字段（`id` / `kind` /
 * `typeKey` / `name` / `quality` / `boss`）出生即固定，**只在 `add` / `reset` 里出现一次**。
 * 实测这部分占单个单位 DTO 的 64%（170B/264B），是本次优化的主要来源。
 *
 * ⚠️ `camp` **必须**算可变字段：① 死亡 `enemy → ghost`（`unit.ts` `kill()`）；
 * ② 中立怪被攻击参战 `neutral → enemy`（`enemy-unit.ts` `setTarget`）。
 *
 * ⚠️ **玩家单位的 `level` / `maxHp` / `maxMp` / `maxRp` / `maxEp` / `exp` / `maxExp` /
 * `attributes` 也必须算可变字段**（属性面板批次补入）。这些字段对**敌人**确实出生即固定，
 * 但玩家单位会因升级 / 换装 / 词缀 / 强化而整体变化 —— 旧白名单把它们当静态，
 * 于是升级后客户端的等级与血条上限**永远停在出生值**（血条被夹到 100%，
 * 看起来像「血一直满的」）。对敌人而言这些值恒定，不会产生任何补丁，因此没有额外流量。
 *
 * ## 预算与超载行为（I2）
 *
 * 本模块是**纯函数**，无 IO、无副作用。单次调用规模 = `O(单位数 × 白名单长度)`；单位数上界由
 * 同屏上限（`max`）+ BOSS 召唤物给出（实测 5 个），调用方每个 200ms 窗口调用一次。
 */
import type { BattleEventDto, LootDto, UnitPatchOpDto, UnitStateDto } from '@idle-dark/protocol';

/** 出生后仍会变化的字段（唯一真相；改动必须同步 `ai-docs/16` 与 AGENTS §20.3）。 */
export const MUTABLE_UNIT_FIELDS = [
  'hp',
  'mp',
  'rp',
  'ep',
  'comboPoint',
  'targetId',
  'castingProgress',
  'buffs',
  'camp',
  // ── 玩家单位专用（对敌人恒定 ⇒ 无额外流量） ──
  'level',
  'maxHp',
  'maxMp',
  'maxRp',
  'maxEp',
  'exp',
  'maxExp',
  'attributes',
] as const satisfies readonly (keyof UnitStateDto)[];

export type MutableUnitField = (typeof MUTABLE_UNIT_FIELDS)[number];

/**
 * 单位补丁操作（**有序**，客户端必须按序应用；合并 = 直接拼接）。
 *
 * 直接复用协议里的 `UnitPatchOpDto`，**不在这里另立一份**：DTO 是线协议的真相，
 * 服务端再造一个同形类型只会让两边漂移。
 */
export type UnitPatchOp = UnitPatchOpDto;

/** 一个累计窗口的推送内容；`worldFrameOf` 返回 `null` = 本窗口完全不发。 */
export interface WorldFrame {
  patch: UnitPatchOpDto[];
  log: BattleEventDto[];
  loot: LootDto[];
  gainedExp: number;
  gainedGold: number;
  wave: number;
  /** 本窗口末「守关 BOSS 是否还会出现」（见 `WorldTickDto.bossPending`）。 */
  bossPending: boolean;
}

/** 单位列表 → `id → DTO` 索引。非法条目（非对象 / 缺 id / 空 id）**跳过**，不抛错。 */
export function unitStateIndexOf(units: readonly UnitStateDto[]): Map<string, UnitStateDto> {
  const index = new Map<string, UnitStateDto>();
  if (!Array.isArray(units)) return index;
  for (const unit of units) {
    if (unit === null || typeof unit !== 'object') continue;
    const id = (unit as { id?: unknown }).id;
    if (typeof id !== 'string' || id === '') continue;
    // 重复 id：后者胜（与 Map 写入语义一致，避免产生两条同 id 的 add）。
    index.set(id, unit);
  }
  return index;
}

/**
 * 值比较。与 `===` 的差别：
 * - `NaN` 与 `NaN` **视为相同** —— 否则每帧都会误报变化（`NaN !== NaN`）；
 * - `+0` / `-0` 视为相同；
 * - 数组 / 普通对象按内容比较（键序无关）。
 */
export function sameFieldValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    // `Object.is` 把 `+0` 与 `-0` 判为不同，但这里是「状态有没有变」，应视为相同。
    if (a === b) return true;
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!sameFieldValue(a[i], b[i])) return false;
    }
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!sameFieldValue(left[key], right[key])) return false;
  }
  return true;
}

/**
 * `buffs` 专用比较：**归一化后再比**。
 *
 * 为什么不能直接用 `sameFieldValue`：Buff 数组的顺序在引擎里不保证稳定，
 * 顺序抖动会被误判成「变化」，从而让静默率归零（表现为「改了但没效果」）。
 * 这里按 `key` 排序 + 只取展示用字段（`key` / `stack` / `remainMs`）做规范化。
 */
export function sameBuffs(a: unknown, b: unknown): boolean {
  const listA = Array.isArray(a) ? a : [];
  const listB = Array.isArray(b) ? b : [];
  if (listA.length !== listB.length) return false;
  const norm = (list: readonly unknown[]): string[] =>
    list
      .map((item) => {
        const record = (item === null || typeof item !== 'object' ? {} : item) as {
          key?: unknown;
          stack?: unknown;
          remainMs?: unknown;
        };
        return `${scalar(record.key)}\u0000${scalar(record.stack)}\u0000${scalar(record.remainMs)}`;
      })
      .sort();
  const left = norm(listA);
  const right = norm(listB);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function scalar(value: unknown): string {
  if (typeof value === 'number') return Number.isNaN(value) ? 'NaN' : String(value);
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * 与上次已发状态求净差分。
 *
 * - `prev` 为空（首帧 / 重同步后）→ 全部 `add`；
 * - `next` 里消失的 id → `del`（**语义是「从 `world.units` 移除」= 清尸后**，不是死亡）；
 * - 同一 id 只出现在 `next` → `add`；只出现在 `prev` → `del`；都有 → 逐字段比 `chg`。
 *
 * 不修改入参（`prev` / `next` 均只读）。
 */
export function diffUnitStates(
  prev: ReadonlyMap<string, UnitStateDto>,
  next: readonly UnitStateDto[],
): UnitPatchOp[] {
  const ops: UnitPatchOp[] = [];
  const current = unitStateIndexOf(next);
  for (const [id, unit] of current) {
    const before = prev.get(id);
    if (before === undefined) {
      ops.push({ op: 'add', unit });
      continue;
    }
    const fields: Record<string, unknown> = {};
    const beforeFields = before as unknown as Record<string, unknown>;
    const afterFields = unit as unknown as Record<string, unknown>;
    for (const field of MUTABLE_UNIT_FIELDS) {
      const a = beforeFields[field];
      const b = afterFields[field];
      const same = field === 'buffs' ? sameBuffs(a, b) : sameFieldValue(a, b);
      if (!same) fields[field] = b;
    }
    if (Object.keys(fields).length > 0) {
      ops.push({ op: 'chg', id, fields: fields as Partial<UnitStateDto> });
    }
  }
  for (const id of prev.keys()) {
    if (!current.has(id)) ops.push({ op: 'del', id });
  }
  return ops;
}

/** 累计窗口组帧输入。 */
export interface WorldFrameInput {
  patch: readonly UnitPatchOpDto[];
  log: readonly BattleEventDto[];
  loot: readonly LootDto[];
  gainedExp: number;
  gainedGold: number;
  /** 本窗口末的波数。 */
  wave: number;
  /** 上次**非静默**窗口末的波数（波数推进本身也是一次变化）。 */
  prevWave: number;
  /** 本窗口末「守关 BOSS 是否还会出现」。 */
  bossPending: boolean;
  /** 上次**非静默**窗口末的同一个值（击杀守关 BOSS 会翻转它）。 */
  prevBossPending: boolean;
}

/**
 * 组装本窗口的推送内容；返回 `null` = **完全无变化** ⇒ 不产生任何 WS 消息。
 *
 * 判定「有变化」的口径（缺一不可，顺序无关）：
 * 单位补丁非空 ∨ 日志非空 ∨ 掉落非空 ∨ 经验非零 ∨ 金币非零 ∨ 波数推进 ∨ 守关 BOSS 可刷状态翻转。
 */
export function worldFrameOf(input: WorldFrameInput): WorldFrame | null {
  const gainedExp = finiteOr0(input.gainedExp);
  const gainedGold = finiteOr0(input.gainedGold);
  const wave = finiteOr0(input.wave);
  const prevWave = finiteOr0(input.prevWave);
  const bossPending = input.bossPending === true;
  const hasContent =
    input.patch.length > 0 ||
    input.log.length > 0 ||
    input.loot.length > 0 ||
    gainedExp !== 0 ||
    gainedGold !== 0 ||
    wave !== prevWave ||
    bossPending !== (input.prevBossPending === true);
  if (!hasContent) return null;
  return {
    patch: [...input.patch],
    log: [...input.log],
    loot: [...input.loot],
    gainedExp,
    gainedGold,
    wave,
    bossPending,
  };
}

/** 帧的线上字节数（JSON 长度）。序列化失败（循环引用等）→ `0`，绝不抛。 */
export function frameByteLength(value: unknown): number {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : 0;
  } catch {
    return 0;
  }
}

function finiteOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
