/**
 * 逻辑服边界登记表（**声明式**，架构门禁与路由聚合的唯一真相）
 *
 * 08 §2.2 的目标划分（A2 单进程阶段）：
 * ```
 * external ──► battle / item / character / idle / map
 *                                   └────────► shared（协议/时钟/端口/事件总线，无业务）
 * ```
 *
 * 规则：
 * - `roots` 是**源码根**（相对 `packages/server/src`）：目录或单个文件；一个文件必须恰好命中一个服；
 * - `cmdSegments` 是 protocol `CMD_SEGMENTS` 的值 —— **全仓每段恰好归属一个服**；
 * - `map` 段当前为空（09 R2 实装）；`roots` 留空表示「边界已登记、源码尚未迁入」；
 * - 后续物理迁移（08 阶段2 的 `src/logic-servers/<server>/**`）只改本表与 import，不改判定规则。
 */
import { CMD_SEGMENTS } from '@idle-dark/protocol';
import type { LogicServerDefinition } from './logic-server.js';

/**
 * 共享层（**不是**逻辑服）：任何逻辑服都可以依赖它，但它**不得**依赖任何逻辑服。
 *
 * - `common`：纯工具 / 内核 / 端口 / 限流；
 * - `modules/game`：推送 batcher / 幂等 / (Game)Database 胶水；
 * - `modules/database`：连接池与查询；
 * - `modules/online`：在线会话注册表（B4 的「在线集合权威」最终归 external，见下方 TODO）；
 * - `modules/logic/shared`：逻辑域共享件 + 事件总线；
 * - `logic-servers`：边界声明与 `LogicServer` seam 本身。
 *
 * TODO(B4/R4)：`modules/online` 的「在线集合权威」按 08 §2.2 应归 external；当前 battle 仍需
 * 同步查询在线状态，故暂列共享层。R4 改为 external 事件/端口后，把它移出共享层。
 */
export const SHARED_ROOTS: readonly string[] = [
  'common',
  'modules/game',
  'modules/database',
  'modules/online',
  'modules/logic/shared',
  'logic-servers',
];

/** 逻辑服定义（`as const` 便于门禁按名字取用）。 */
export const SERVER_DEFINITIONS = {
  external: {
    name: 'external',
    roots: [
      'ionet',
      'app.module.ts',
      'main.ts',
      'modules/auth',
      'modules/health',
      'modules/metrics',
      'modules/edge',
      'modules/logic/panel-actions.ts',
    ],
    cmdSegments: [CMD_SEGMENTS.system, CMD_SEGMENTS.auth],
  },
  battle: {
    name: 'battle',
    roots: ['modules/logic/world', 'modules/logic/battle'],
    cmdSegments: [CMD_SEGMENTS.world, CMD_SEGMENTS.battle],
  },
  item: {
    name: 'item',
    roots: [
      'modules/logic/inventory',
      'modules/logic/bank',
      'modules/logic/lootrule',
      'modules/logic/produce',
      'modules/logic/shop',
    ],
    cmdSegments: [
      CMD_SEGMENTS.inventory,
      CMD_SEGMENTS.bank,
      CMD_SEGMENTS.lootrule,
      CMD_SEGMENTS.produce,
      CMD_SEGMENTS.shop,
    ],
  },
  character: {
    name: 'character',
    roots: ['modules/character', 'modules/logic/player', 'modules/logic/career'],
    cmdSegments: [CMD_SEGMENTS.player, CMD_SEGMENTS.career],
  },
  idle: {
    name: 'idle',
    // 09 §6.3：离线结算编排（cmd 120）。W6 起旧氪金秘境域（dungeon, cmd 140）已物理删除，
    // 140 段重定义为**混沌仪**（`modules/logic/chaos`）—— 与离线结算同服（同一套状态机）。
    roots: ['modules/logic/idle', 'modules/logic/chaos'],
    cmdSegments: [CMD_SEGMENTS.idle, CMD_SEGMENTS.chaos],
  },
  map: {
    name: 'map',
    // 09 R2：开放世界控制器（地图目录/解锁/位置/种子/map.enter/...）。
    roots: ['modules/logic/map'],
    cmdSegments: [CMD_SEGMENTS.map],
  },
} as const satisfies Record<string, LogicServerDefinition>;

/** 全部逻辑服定义（稳定顺序）。 */
export const ALL_SERVER_DEFINITIONS: readonly LogicServerDefinition[] = Object.values(SERVER_DEFINITIONS);

/**
 * 允许存在的跨服「深路径」import（**过渡债务，禁止增长**）。
 *
 * 08 §2.3 的目标是跨服只走 call/send/事件；下列边缘当前仍是直接调用另一个服的 service，
 * 由 R4（battle 命令/事件对接）改为正式契约后删除。门禁断言**实际边集恰好等于本表**，
 * 因此任何新增跨服深路径都会立刻失败。
 */
export const TRANSITIONAL_DEEP_IMPORTS: readonly { readonly from: string; readonly to: string; readonly reason: string }[] = [];
