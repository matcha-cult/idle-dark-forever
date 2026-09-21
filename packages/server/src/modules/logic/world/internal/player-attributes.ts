/**
 * `PlayerUnit` → `PlayerAttributesDto` 投影（原版 `battle/components/PlayerPanel.js` 的那张表）
 *
 * ## 为什么放在服务端而不是内核
 *
 * 这是**视图投影**，不是游戏规则：它只把内核已有的 getter 读出来、**换单位、按显示精度取整**，
 * 不参与任何战斗公式。同类的「`Unit` → DTO」投影已经收在 `unit-state.ts`，本文件与之并列。
 *
 * ## 三条硬约定
 *
 * 1. **换算在服务端**：比率 ×100、每 5 秒回复 ×5、`(x - 1) × 100` 全部在这里做掉，
 *    前端只拼 `%` / `次/秒` 后缀（AGENTS §1.6 前端零推导）。
 * 2. **取整也在服务端**：对齐原版 `components/Field.js` —— 默认 1 位小数（`FixedField.toFixed(1)`），
 *    整数项截断（`IntField` 的 `| 0`）。取整不只是好看：内核浮点原值每帧都可能抖出无意义的
 *    差分（`0.1 + 0.2`），按显示精度取整后 `unit-state-diff` 的内容比较才是稳定的。
 * 3. **永远有限**：`runAttrHooks` 由数据层的 183 个文件驱动，任何一处写错都可能返回
 *    `NaN` / `Infinity` / 负数。这里一律用 `finite()` 兜底 —— 一个坏 hook 只应让某一行显示 0，
 *    **不允许**把 `NaN` 送上线协议（`NaN` 在 JSON 里会变成 `null`，前端再算就是 `NaN`）。
 *
 * ## 与原版的三处刻意偏离（内核差异，见 `PlayerAttributesDto` 的表格）
 *
 * - 耐力 `sta`：已删除（E1 属性三化），**不提供也不填 0**；
 * - 巅峰等级：已删除（Q8），因此只有「等级上限」没有 `(巅峰)`；
 * - 暗影 → 混沌：`chaosResist` / `chaosAbsorb`（P7：混沌非元素，智力全抗不作用于它）。
 */
import type { PlayerAttributesDto } from '@idle-dark/protocol';
import type { PlayerUnit } from '@idle-dark/game-core';

/** 任意入参（含 `undefined` / `null` / `NaN` / `Infinity`）→ 有限数；非法回落 `fallback`。 */
function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 1 位小数（原版 `FixedField` 的 `toFixed(1)` 语义）。
 *
 * 提前在服务端取到同样精度，前端 `toFixed(1)` 只是补零，不再产生新数值。
 *
 * ⚠️ **乘 10 之后要再判一次有限性**：`finite()` 只挡住了入参，`1e308 × 10` 仍然溢出成
 * `Infinity`，`Math.round(Infinity) / 10` 也是 `Infinity` —— 于是「有限入参」也能产出
 * 非有限值并写进协议（单测 `超大值` 一条就是钉这个的）。
 */
function fixed1(value: unknown): number {
  const times10 = finite(value) * 10;
  return Number.isFinite(times10) ? Math.round(times10) / 10 : 0;
}

/** 整数（原版 `IntField` 的 `value | 0` 语义 = 向零截断；这里用 `Math.trunc` 避免 32 位回绕）。 */
function int(value: unknown): number {
  return Math.trunc(finite(value));
}

/**
 * 百分比项：`(值 + inc) × mul`，1 位小数。
 *
 * 原版 `FixedField` 的 `mul` / `inc` 只有两种用法，这里直接固化成这两个参数，
 * 调用处一眼能看出「这是 ×100 的比率」还是「×5 的每 5 秒量」。
 */
function scaled(value: unknown, inc = 0, mul = 100): number {
  return fixed1((finite(value) + inc) * mul);
}

/**
 * 玩家单位 → 属性面板 DTO。
 *
 * 只接受 `PlayerUnit`（`unit-state.ts` 已按 `instanceof` 过滤），因此 `unit.player`
 * 缺失只可能是「世界存在但角色没挂上」的异常态 —— 此时数值全部回落 0，**不抛错**：
 * 属性面板少几行远好过整个 tick 崩掉。
 */
export function playerAttributesOf(unit: PlayerUnit): PlayerAttributesDto {
  const player = unit.player;
  // 职业显示名：优先 `careerName`（`Player extends PlayerMeta`），测试替身缺失时回落职业 key。
  const careerName =
    typeof player?.careerName === 'string' && player.careerName !== ''
      ? player.careerName
      : (player?.careerData.key ?? '');

  return {
    careerName,
    maxLevel: int(player?.maxLevel),
    // 三维（原版还有耐力，本仓 E1 删除）
    str: int(unit.str),
    dex: int(unit.dex),
    int: int(unit.int),
    // 输出
    atk: fixed1(unit.atk),
    atkSpeed: fixed1(unit.atkSpeed),
    speedBonusPct: scaled(unit.speedRate, -1),
    critRatePct: scaled(unit.critRate),
    critBonusPct: scaled(unit.critBonus),
    dmgBonusPct: scaled(unit.dmgAdd, -1),
    // 收益
    hpFromKill: fixed1(unit.hpFromKill),
    mpFromKill: fixed1(unit.mpFromKill),
    expBonusPct: scaled(unit.expInc, -1),
    skillExpBonusPct: scaled(unit.skillExpInc, -1),
    magicFindPct: scaled(unit.mf, -1),
    goldFindPct: scaled(unit.gf, -1),
    // 防御
    dodgeRatePct: scaled(unit.dodgeRate),
    def: int(unit.def),
    fireResist: int(unit.fireResist),
    coldResist: int(unit.coldResist),
    lightningResist: int(unit.lightningResist),
    chaosResist: int(unit.chaosResist),
    fireAbsorbPct: scaled(unit.fireAbsorb),
    coldAbsorbPct: scaled(unit.coldAbsorb),
    lightningAbsorbPct: scaled(unit.lightningAbsorb),
    chaosAbsorbPct: scaled(unit.chaosAbsorb),
    meleeAbsorbPct: scaled(unit.meleeAbsorb),
    // 回复（原版面板按「每 5 秒」展示，故 ×5）
    hpRecovery5s: fixed1(finite(unit.hpRecovery) * 5),
    mpRecovery5s: fixed1(finite(unit.mpRecovery) * 5),
    rpRecovery5s: fixed1(finite(unit.rpRecovery) * 5),
    epRecovery5s: fixed1(finite(unit.epRecovery) * 5),
    rpRecHp: fixed1(unit.rpRecHp),
    leech: fixed1(unit.leech),
  };
}
