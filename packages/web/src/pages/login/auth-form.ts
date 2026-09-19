/**
 * 认证表单的**纯校验逻辑**（登录 / 注册共用）。
 *
 * 为什么单独抽出来：
 * - antd `Form.Item` 的 `rules` 只负责**行内提示**，`onFinish` 仍可能拿到未过校验的值
 *   （例如 `disabled`、受控回填、程序化 `submit()`），所以提交前必须再校验一次；
 * - 两处若各写一份文案/阈值，迟早漂移。这里让 `rules` 与提交校验**共用同一组常量**，
 *   并且本文件是纯函数 —— 可以直接单测边界，不必渲染组件。
 */

export type AuthMode = 'login' | 'register';

export const AUTH_MODE_LOGIN: AuthMode = 'login';
export const AUTH_MODE_REGISTER: AuthMode = 'register';

/**
 * 与后端 `AuthService` 的校验保持一致（服务端仍是最终裁判）。
 *
 * ⚠️ `usernameMax` 必须与 `packages/server/src/modules/auth/auth.service.ts` 的
 * `USERNAME_MAX_LENGTH` 同步 —— 前端放宽会让 33–50 字符的账号「本地通过、服务端拒绝」，
 * 用户看到的是提交后才冒出来的错误。
 */
export const AUTH_LIMITS = {
  usernameMin: 3,
  usernameMax: 32,
  passwordMin: 6,
} as const;

export const AUTH_MESSAGES = {
  username: `账号长度 ${AUTH_LIMITS.usernameMin}–${AUTH_LIMITS.usernameMax} 字符`,
  password: `口令至少 ${AUTH_LIMITS.passwordMin} 位`,
  confirm: '两次输入的口令不一致',
  confirmRequired: '请再次输入口令',
} as const;

export interface AuthFormValues {
  username?: string;
  password?: string;
  /** 仅注册模式使用。 */
  confirm?: string;
}

/** 账号归一化：去首尾空白（服务端也会 trim，这里先做以免把空白算进长度）。 */
export function normalizeUsername(raw: string | undefined): string {
  return (raw ?? '').trim();
}

/**
 * 提交前的整体校验。
 *
 * @returns 第一条错误文案；`null` 表示可以提交。
 *
 * 边界语义：
 * - `username` 缺失 / 全是空白 → 长度校验失败（不是"非空"特例）
 * - 长度按**归一化后**的字符数算（`'  ab  '` 视为 2 字符 → 不合法）
 * - 注册模式才校验 `confirm`；登录模式传了 `confirm` 也忽略
 * - 口令不做 trim（前后空格是合法口令的一部分）
 */
export function validateAuthForm(mode: AuthMode, values: AuthFormValues): string | null {
  const username = normalizeUsername(values.username);
  if (username.length < AUTH_LIMITS.usernameMin || username.length > AUTH_LIMITS.usernameMax) {
    return AUTH_MESSAGES.username;
  }

  const password = values.password ?? '';
  if (password.length < AUTH_LIMITS.passwordMin) {
    return AUTH_MESSAGES.password;
  }

  if (mode === AUTH_MODE_REGISTER) {
    const confirm = values.confirm ?? '';
    if (confirm.length === 0) return AUTH_MESSAGES.confirmRequired;
    if (confirm !== password) return AUTH_MESSAGES.confirm;
  }

  return null;
}
