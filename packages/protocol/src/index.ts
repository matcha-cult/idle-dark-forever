/**
 * @idle-dark/protocol —— idle-dark-forever 共享线协议（前后端唯一真相）
 *
 * 内容：
 * - `cmd.ts`          cmd 段规划与路由常量（服务端注册 Action 与前端调用共用）
 * - `dto.ts`          线协议载荷类型
 * - `equip.ts`        装备槽 / 武器类别 / 副手判定（前后端共用的唯一真相）
 * - `result.ts`       Action 统一返回形状与两级错误判定
 * - `error-codes.ts`  业务错误码与中文文案
 *
 * 线协议信封（请求/响应/推送）以 ionet-ts 的 `PROTOCOL.md` 为唯一规格，本包不重复定义。
 */

export * from './cmd.js';
export * from './dto.js';
export * from './equip.js';
export * from './result.js';
export * from './error-codes.js';

/** 服务端与前端共同声明的协议版本；不一致时服务端应拒绝或提示刷新。 */
export const PROTOCOL_VERSION = 1;

/** WS 默认路径（PROTOCOL §1）。 */
export const WS_PATH = '/ws';

/** 应用层心跳路由（PROTOCOL §7）。 */
export const HEARTBEAT_ROUTE = { cmd: 1, subCmd: 1 } as const;
