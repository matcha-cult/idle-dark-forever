/**
 * `@idle-dark/ionet-transport` 公共入口。
 *
 * 分层（依赖单向）：
 * - `transport/`：`SocketAdapter` 接口 + 浏览器实现（平台差异唯一收敛点）；
 * - `client/`：`IonetClient` 状态机 / 关联策略 / 生命周期 / 通知总线 / 错误模型；
 * - `api/`：typed Action API（`GameApi`）+ HTTP fallback；
 * - `./testing`：`FakeSocketAdapter` + `MemoryIonetServer`（零后端开发/测试）。
 *
 * 协议层不在本包：
 * - **线协议信封**（请求/响应/推送、codec、reqId 关联算法）来自
 *   `@nbb-ionet/client-protocol`（PROTOCOL.md 唯一真相）；
 * - **业务协议**（cmd 段常量、DTO 类型、业务错误码）来自 `@idle-dark/protocol`。
 *
 * ⚠️ 本包**不 import** 任何其他 `@nbb-ionet/*`：其核心运行时依赖 Node `async_hooks`，
 * 浏览器加载即炸（只有 `client-protocol` 是浏览器安全的）。
 */

// ===== 线协议层再导出（唯一真相仍是 @nbb-ionet/client-protocol）=====
export {
  classifyFrame,
  isNotificationFrame,
  envelopeCodec,
  EnvelopeCodec,
  createRequestMessage,
  createResponseMessage,
  createNotificationMessage,
  isSuccess,
  RequestResponseAssociator,
  type PendingRequest,
  type AssociateBy,
  type AssociateOk,
  type AssociateMiss,
  type ResponseKind,
  type FrameKind,
  type WireFrame,
  type EnvelopeMessage,
  type RequestMessage,
  type ResponseMessage,
  type NotificationMessage,
  type NotificationMessageInput,
  type DecodedEnvelope,
} from '@nbb-ionet/client-protocol';

// ===== 共享业务协议：cmd 段常量与工具 =====
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
  CHAOS_CMD,
  cmdMerge,
  PUBLIC_ACTION_KEYS,
  HEARTBEAT_ROUTE,
  WS_PATH,
  PROTOCOL_VERSION,
  type CmdSegment,
} from '@idle-dark/protocol';

// ===== 共享业务协议：结果约定与业务错误码 =====
export {
  BusinessErrorCode,
  BUSINESS_ERROR_MESSAGE,
  businessErrorMessage,
  fail,
  ok,
  isOk,
  type BusinessErrorPayload,
  type ActionResult,
  type ActionOk,
  type ActionFail,
} from '@idle-dark/protocol';

// ===== 共享业务协议：DTO 类型 =====
export type {
  Quality,
  GoodType,
  EquipPosition,
  ItemPosition,
  LootRuleAction,
  SlotLimits,
  AffixDto,
  InventorySlotDto,
  EquipmentsDto,
  PlayerMetaDto,
  CareerProgressDto,
  SkillDto,
  EnhanceDto,
  PlayerStateDto,
  UnitStateDto,
  MapDto,
  WorldSnapshotDto,
  BattleEventDto,
  WorldTickDto,
  LootDto,
  CostDto,
  EnchantCostsDto,
  RebuildCostsDto,
  DecomposeResultDto,
  MedicineStateDto,
  ShopStateDto,
  OfflineReportDto,
  ChaosFailMode,
  ChaosTierDto,
  ChaosStateDto,
  ChaosSequenceInput,
  ChaosFailModeInput,
  LoginRequestDto,
  LoginResponseDto,
  MeDto,
} from '@idle-dark/protocol';
export { QUALITY_NAMES } from '@idle-dark/protocol';

// ===== transport =====
export type {
  SocketAdapter,
  SocketAdapterFactory,
  SocketCloseEvent,
  SocketReadyState,
  Unsubscribe,
} from './transport/socket-adapter.js';
export {
  BrowserSocketAdapter,
  resolveWebSocketCtor,
  type WebSocketCtor,
  type WebSocketLike,
} from './transport/browser-socket-adapter.js';

// ===== client =====
export {
  IonetClient,
  withToken,
  computeBackoffDelay,
  extractServerTime,
  type ConnectionState,
  type HeartbeatOptions,
  type ReconnectOptions,
  type SendOptions,
  type IonetClientOptions,
} from './client/ionet-client.js';
export {
  Correlation,
  defaultReqIdGenerator,
  type CorrelationStrategy,
  type CorrelationBeginResult,
} from './client/correlation.js';
export {
  assertBusinessOk,
  assertResponseOk,
  assertTransportOk,
  businessCodeOf,
  businessMessageOf,
  classifyResponse,
  isBusinessFailure,
  BusinessError,
  ConnectionError,
  HandshakeError,
  ProtocolError,
  RequestTimeoutError,
  TransportError,
  UNKNOWN_BUSINESS_CODE,
  type ClassifiedResponse,
  type ActionOkOf,
} from './client/errors.js';
export {
  BrowserLifecycleAdapter,
  ManualLifecycleAdapter,
  NoopLifecycleAdapter,
  defaultLifecycleAdapter,
  type LifecycleAdapter,
} from './client/lifecycle.js';
export {
  NotificationBus,
  type NotificationHandler,
  type NotificationErrorHandler,
} from './client/notification-bus.js';

// ===== api：HTTP fallback =====
export {
  HttpFallback,
  httpActionPath,
  wrapHttpBody,
  type FetchLike,
  type HttpFallbackOptions,
} from './api/http-fallback.js';

// ===== api：typed Action API =====
export {
  GameApi,
  SystemApi,
  AuthApi,
  PlayerApi,
  WorldApi,
  BattleApi,
  InventoryApi,
  BankApi,
  LootRuleApi,
  CareerApi,
  ProduceApi,
  ShopApi,
  IdleApi,
  ChaosApi,
  type GameApiTransport,
  type GameApiRequestOptions,
  type SystemPingDto,
  type SystemVersionDto,
  type SystemNoticeDto,
  type PlayerCreateInput,
  type PlayerKeyInput,
  type PlayerImportSaveInput,
  type PlayerExportSaveDto,
  type WorldEnterMapInput,
  type BattleFocusInput,
  type InventoryItemRef,
  type InventorySellInput,
  type InventoryLockInput,
  type BankMoveInput,
  type LootRuleEntryDto,
  type LootRuleStateDto,
  type LootRuleUpdateInput,
  type CareerPanelDto,
  type EnchantInput,
  type RebuildInput,
  type DecomposeInput,
  type MedicineUseInput,
} from './api/game-api.js';
