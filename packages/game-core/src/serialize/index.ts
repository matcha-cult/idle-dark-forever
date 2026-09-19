/**
 * `serialize/` —— 存档编解码（导入《永夜2016典藏重置版》本地存档）。
 *
 * 导出面：
 * - `worldStop` / `worldStart`     `'save' + base64(secret ‖ [md5(chunk‖secret) ‖ chunk]*)`
 * - `encodeGameSave` / `decodeGameSave`  `game` 存档（JSON / HS256 JWT）
 * - `detectSaveKind`               存档类型判定
 * - `verifyJwtHs256` / `signJwtHs256`   HS256 JWT（纯 TS，无 jsrsasign）
 * - `md5` / `sha256` / `hmacSha256` / base64 / UTF-8 原语
 */

export * from './save-codec.js';
export * from './game-save.js';
