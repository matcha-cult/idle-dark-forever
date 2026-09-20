/**
 * ionet 路由常量 —— **从 @idle-dark/protocol 原样再导出**。
 *
 * 唯一真相是 `packages/protocol/src/cmd.ts`（前端经 `@idle-dark/ionet-transport`
 * 直接依赖同一包，不存在手工镜像）。本文件**只做再导出，不重新定义任何常量**；
 * 服务端内部一律 `import { WORLD_CMD } from '../../ionet/cmd.js'` 走这里，
 * 便于后续单点新增段位而不改 import 图。
 *
 * 依赖方向：`protocol（纯常量/类型） ← ionet/cmd.ts ← Action`。
 */
export {
  CMD_SEGMENTS,
  SYSTEM_CMD,
  AUTH_CMD,
  PLAYER_CMD,
  WORLD_CMD,
  BATTLE_CMD,
  INVENTORY_CMD,
  BANK_CMD,
  LOOTRULE_CMD,
  CAREER_CMD,
  PRODUCE_CMD,
  SHOP_CMD,
  IDLE_CMD,
  cmdMerge,
  PUBLIC_ACTION_KEYS,
} from '@idle-dark/protocol';

export { PROTOCOL_VERSION, WS_PATH, HEARTBEAT_ROUTE } from '@idle-dark/protocol';

export type { CmdSegment } from '@idle-dark/protocol';
