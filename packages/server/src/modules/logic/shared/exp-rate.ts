/**
 * 角色经验倍率（`EXP_RATE` 环境变量）——**共享层**
 *
 * 放这里的原因：在线（battle 的 `world.service`）与离线（dungeon 的 `idle-logic.service`）
 * 都要用它；放在 battle 的 `world.config` 会让 dungeon 反向 import battle（跨服深路径）。
 * `world/world.config.ts` 仍**再导出**这些符号，保持既有 import 不破坏。
 *
 * ⚠️ 只作用于**角色经验**（在线战斗与离线结算都走 `BattleWorld.gotExp`），
 * 不影响技能经验与掉落数量（掉落数量归 `updateRate`）。
 */

/** 经验倍率允许的上限（防止 env 写成天文数字把数值体系打崩）。 */
export const EXP_RATE_MAX = 1000;

/**
 * 解析角色经验倍率。
 *
 * - 缺省 / 空串 → `1`（原版）；
 * - 只接受**有限、> 0、≤ `EXP_RATE_MAX`** 的数，其余一律回落 `1`
 *   （配错一个 0 或 NaN 不该让全服经验归零或爆炸）；
 * - 本地开发由 `dev.config.json` 的 `expRate` 经 `scripts/dev.mjs` 注入该变量，
 *   **生产不设即为 1**。
 */
export function parseExpRate(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 1;
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value) || value <= 0 || value > EXP_RATE_MAX) return 1;
  return value;
}

/** 当前进程的角色经验倍率（启动时读一次环境变量）。 */
export const EXP_RATE = parseExpRate(process.env.EXP_RATE);
