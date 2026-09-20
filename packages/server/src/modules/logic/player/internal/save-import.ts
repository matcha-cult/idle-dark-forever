/**
 * 《永夜2016典藏重置版》本地存档解析（导入迁移）
 *
 * 三种编码（原版 `game.load` / `Player.load` 的首字符分派）：
 * - 明文 JSON（开发态）
 * - `'save' + base64(...)`（原版 `world.stop` 的可逆混淆，`worldStart` 解码）
 * - HS256 JWT（生产态 `game` 存档，密钥硬编码在前端 `chapter5.woodElf`）
 *
 * 本文件是**纯函数**，不做 IO；解析失败返回明确业务码
 * （`SAVE_IMPORT_INVALID` / `SAVE_IMPORT_UNSUPPORTED`），由 Action 层转成 `fail(...)`。
 */
import {
  detectSaveKind,
  decodeGameSave,
  LEGACY_JWT_SECRET,
  worldStart,
  type SaveKind,
} from '@idle-dark/game-core';
import { BusinessErrorCode } from '@idle-dark/protocol';

export interface LegacySaveParsed {
  ok: true;
  /** 实际识别到的编码。 */
  kind: SaveKind;
  /** 归一化后的 `Player.fromJSON` 输入。 */
  state: Record<string, unknown>;
  /** 存档里声明的 role（缺省 `null`，由调用方兜底）。 */
  role: string | null;
}

export interface LegacySaveFailed {
  ok: false;
  code:
    | typeof BusinessErrorCode.SAVE_IMPORT_INVALID
    | typeof BusinessErrorCode.SAVE_IMPORT_UNSUPPORTED;
  message: string;
}

export type LegacySaveResult = LegacySaveParsed | LegacySaveFailed;

/** 判定对象是否「像」一份玩家存档。 */
export function looksLikePlayerState(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record['role'] !== undefined || record['currentCareer'] !== undefined) return true;
  if (record['careers'] !== undefined || record['inventory'] !== undefined) return true;
  if (record['skillExp'] !== undefined && record['gold'] !== undefined) return true;
  return false;
}

/** 从可能的包装对象里取出玩家存档本体（支持 `{player}` / `{save}` / `{state}` 包装）。 */
function unwrapState(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  for (const key of ['player', 'save', 'state']) {
    const inner = record[key];
    if (looksLikePlayerState(inner)) return inner;
  }
  return value;
}

/**
 * 解析旧存档文本。
 *
 * @param content 原版导出的存档原文（`localStorage['player-*']` 或 `localStorage['game']`）。
 */
export function parseLegacyPlayerSave(content: unknown): LegacySaveResult {
  if (typeof content !== 'string' || content.trim() === '') {
    return {
      ok: false,
      code: BusinessErrorCode.SAVE_IMPORT_INVALID,
      message: '存档内容为空',
    };
  }
  const text = content.trim();
  const kind = detectSaveKind(text);

  let decoded: unknown;
  try {
    switch (kind) {
      case 'save':
        decoded = worldStart(text);
        break;
      case 'json':
        decoded = JSON.parse(text) as unknown;
        break;
      case 'jwt':
        decoded = decodeGameSave(text, LEGACY_JWT_SECRET);
        break;
      default:
        return {
          ok: false,
          code: BusinessErrorCode.SAVE_IMPORT_INVALID,
          message: '无法识别的存档格式（既不是 JSON，也不是 save/base64 或 JWT）',
        };
    }
  } catch (error) {
    // `worldStart` 会因分片摘要不匹配 / base64 非法抛错；JWT 验签失败也走这里。
    return {
      ok: false,
      code:
        kind === 'jwt'
          ? BusinessErrorCode.SAVE_IMPORT_UNSUPPORTED
          : BusinessErrorCode.SAVE_IMPORT_INVALID,
      message:
        kind === 'jwt'
          ? '存档签名校验失败（可能不是本游戏导出的存档）'
          : `存档解析失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const state = unwrapState(decoded);
  if (!looksLikePlayerState(state)) {
    // 明文 JWT 常见于账号级 `game` 存档（只有神力 / 银行等账号数据，没有角色数据）。
    return {
      ok: false,
      code: kind === 'jwt' ? BusinessErrorCode.SAVE_IMPORT_UNSUPPORTED : BusinessErrorCode.SAVE_IMPORT_INVALID,
      message:
        kind === 'jwt'
          ? '该 JWT 是账号级存档（game），不含角色数据，暂不支持导入'
          : '存档结构不完整（缺少 role/careers/inventory 等角色字段）',
    };
  }

  const role = typeof state['role'] === 'string' && state['role'] !== '' ? state['role'] : null;
  return { ok: true, kind, state, role };
}
