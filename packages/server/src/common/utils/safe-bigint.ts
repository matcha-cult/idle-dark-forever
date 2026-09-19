/**
 * BIGINT → Number 精度边界（定精度策略，唯一收口）
 *
 * 策略：
 * - PostgreSQL BIGINT 列经 pg 驱动以**字符串**返回；本模块是业务读取它们的唯一入口。
 * - 值在安全整数范围 ±(2^53-1) 内 → 精确转 number（游戏数值量级内无精度损失）。
 * - 超出安全整数范围 → **立即抛 RangeError（fail-fast）**，绝不静默丢精度。
 *   若未来量级需要突破 2^53，应把输出边界迁移为 string（DTO 同步为 string），
 *   而不是放宽这里——放宽等于把精度债重新放回无人区。
 *
 * 调用点纪律：业务读取任何 BIGINT 列（users.id / account_state.user_id /
 * characters.user_id / COUNT(*) …）时一律经 bigintToSafeNumber，禁止裸 Number(row.x)。
 */

/** 2^53 - 1 */
export const MAX_SAFE_BIGINT = 9_007_199_254_740_991n;
/** -(2^53 - 1) */
export const MIN_SAFE_BIGINT = -9_007_199_254_740_991n;

/** pg 返回的 BIGINT 十进制字符串 */
const DECIMAL_RE = /^-?\d+$/;

function formatField(field: string, raw: unknown): string {
  const shown = typeof raw === 'bigint' ? `${raw}n` : JSON.stringify(raw);
  return (
    `BIGINT 列 ${field} 值 ${shown} 超出安全整数范围 ±(2^53-1)；` +
    '若要支持更大值请将输出边界迁移为 string（见 common/utils/safe-bigint.ts 定精度策略）'
  );
}

/**
 * BIGINT 列值 → 安全整数 number。
 *
 * @param raw pg 行值：十进制字符串（最常见）、number、bigint 或 null | undefined
 * @param field 字段名（错误信息用）
 * @returns 精确 number（已断言在安全整数范围内）
 * @throws RangeError 非十进制字符串 / 非整数 / 超出 ±(2^53-1) / 不支持的类型
 */
export function bigintToSafeNumber(
  raw: string | number | bigint | null | undefined,
  field: string,
): number {
  if (raw === null || raw === undefined) {
    // 列值缺省（LEFT JOIN 未命中 / 兼容假行）：按 0 处理，但绝不参与精度运算
    return 0;
  }
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) {
      throw new RangeError(formatField(field, raw));
    }
    return raw;
  }
  if (typeof raw === 'bigint') {
    if (raw > MAX_SAFE_BIGINT || raw < MIN_SAFE_BIGINT) {
      throw new RangeError(formatField(field, raw));
    }
    return Number(raw);
  }
  if (typeof raw !== 'string') {
    throw new RangeError(`BIGINT 列 ${field} 值类型不受支持：${typeof raw}`);
  }
  const text = raw.trim();
  if (!DECIMAL_RE.test(text)) {
    throw new RangeError(`BIGINT 列 ${field} 值不是十进制整数：${JSON.stringify(raw)}`);
  }
  const big = BigInt(text);
  if (big > MAX_SAFE_BIGINT || big < MIN_SAFE_BIGINT) {
    throw new RangeError(formatField(field, raw));
  }
  return Number(big);
}
