/**
 * 面板 Action 的公共参数解析（Action 只做校验 + 转发，业务在 logic service）。
 *
 * 线协议只保证 `data` 是调用方给的任意 JSON，因此所有取值必须防御式。
 */
import type { ActionFail } from '@idle-dark/protocol';
import { ActionError, toNonEmptyString } from '../../../../ionet/action-support.js';

export type Parsed<T> = { ok: true; value: T } | { ok: false; fail: ActionFail };

export function parseOk<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

export function parseFail<T>(message?: string): Parsed<T> {
  return { ok: false, fail: ActionError.invalidParam(message) };
}

/** `opId`：缺失 / 空白 → undefined；非字符串 → 非法。 */
export function parseOpId(body: Record<string, unknown>): Parsed<string | undefined> {
  const raw = body['opId'];
  if (raw === undefined || raw === null) return parseOk(undefined);
  if (typeof raw !== 'string') return parseFail('opId 必须是字符串');
  const trimmed = raw.trim();
  return parseOk(trimmed === '' ? undefined : trimmed);
}

/** 可选 `characterId`（面板扩展字段；缺失时由服务端解析当前角色）。 */
export function parseCharacterId(body: Record<string, unknown>): Parsed<string | undefined> {
  const raw = body['characterId'];
  if (raw === undefined || raw === null) return parseOk(undefined);
  const value = toNonEmptyString(raw);
  if (value === undefined) return parseFail('characterId 非法');
  return parseOk(value);
}

/** 必填非空字符串。 */
export function parseRequiredString(
  body: Record<string, unknown>,
  key: string,
): Parsed<string> {
  const value = toNonEmptyString(body[key]);
  if (value === undefined) return parseFail(`${key} 不能为空`);
  return parseOk(value);
}

/** 可选非空字符串数组（缺失 → []）。 */
export function parseOptionalStringArray(
  body: Record<string, unknown>,
  key: string,
): Parsed<string[]> {
  const raw = body[key];
  if (raw === undefined || raw === null) return parseOk([]);
  if (!Array.isArray(raw)) return parseFail(`${key} 必须是字符串数组`);
  const out: string[] = [];
  for (const item of raw) {
    const value = toNonEmptyString(item);
    if (value === undefined) return parseFail(`${key} 含非法元素`);
    out.push(value);
  }
  return parseOk(out);
}
