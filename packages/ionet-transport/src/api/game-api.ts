/**
 * typed Action API —— 按后端 `cmd` 段组织的游戏接口层（13 个段）。
 *
 * 设计约束：
 * - 路由 `(cmd, subCmd)` **只引用 `@idle-dark/protocol` 的 `*_CMD` 常量**，
 *   禁止字面量数字、禁止在本包手工镜像 `cmd.ts`（唯一真相在后端共享包）。
 * - 结果类型一律来自 `@idle-dark/protocol` 的 `dto.ts`；协议尚未声明的那几个请求/响应形状
 *   在本文件就地声明并标注「待迁移」。
 * - **业务失败不抛**：所有方法强制 `allowBusinessFailure: true`，业务失败作为
 *   `ActionResult` 的 `success: false` 分支**返回**（预期分支）；传输层失败
 *   （`errorCode !== 0` / 连接 / 超时）仍抛 `TransportError` 等异常。
 * - 本层**不做任何业务判断**（不判 success、不查码表），只做路由 + 类型收口。
 */
import type {
  ActionResult,
  CareerProgressDto,
  DecomposeResultDto,
  EnchantCostsDto,
  EnhanceDto,
  InventorySlotDto,
  LoginRequestDto,
  LoginResponseDto,
  MeDto,
  MedicineStateDto,
  OfflineReportDto,
  PlayerMetaDto,
  PlayerStateDto,
  RebuildCostsDto,
  ShopStateDto,
  SkillDto,
  StoryDto,
  StoryPlayDto,
  WorldSnapshotDto,
} from '@idle-dark/protocol';
import {
  AUTH_CMD,
  BANK_CMD,
  BATTLE_CMD,
  CAREER_CMD,
  IDLE_CMD,
  INVENTORY_CMD,
  LOOTRULE_CMD,
  PLAYER_CMD,
  PRODUCE_CMD,
  SHOP_CMD,
  STORY_CMD,
  SYSTEM_CMD,
  WORLD_CMD,
} from '@idle-dark/protocol';

// ===== 传输面 =====

/** typed API 需要的最小传输面（由 `IonetClient` / `HttpFallback` 结构性满足）。 */
export interface GameApiRequestOptions {
  headers?: Record<string, string>;
  traceId?: string;
  /** 覆盖本次请求超时。 */
  timeoutMs?: number;
  /**
   * 业务失败是否作为异常抛出。**`GameApi` 始终强制为 `true`**（业务失败是预期分支）；
   * 该字段在接口上保留，以便替换实现时语义显式。
   */
  allowBusinessFailure?: boolean;
}

export interface GameApiTransport {
  request<TData = unknown>(
    cmd: number,
    subCmd: number,
    data?: unknown,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<TData>>;
}

/** 强制业务失败不抛（预期分支）。 */
function expectBusinessFailure(options?: GameApiRequestOptions): GameApiRequestOptions {
  return { ...options, allowBusinessFailure: true };
}

/** 各 Api 类的公共基类：只做「路由 + 强制业务失败不抛」。 */
abstract class SegmentApi {
  constructor(protected readonly transport: GameApiTransport) {}

  protected call<TData>(
    cmd: number,
    subCmd: number,
    data?: unknown,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<TData>> {
    return this.transport.request<TData>(cmd, subCmd, data, expectBusinessFailure(options));
  }
}

// ===== system =====

/** 心跳响应（`system.ping`）。 */
export interface SystemPingDto {
  serverTime: number;
}

/** 版本与公告版本（`system.version`）。 */
export interface SystemVersionDto {
  version: number;
  protocolVersion: number;
  serverTime: number;
  noticeVersion?: number;
}

/** 系统公告（`system.notice` 推送载荷）。 */
export interface SystemNoticeDto {
  id: string;
  title: string;
  body: string;
  /** 发布时间（服务端 ms）。 */
  at: number;
}

export class SystemApi extends SegmentApi {
  /** 应用层心跳（PROTOCOL §7）。 */
  ping(options?: GameApiRequestOptions): Promise<ActionResult<SystemPingDto>> {
    return this.call<SystemPingDto>(SYSTEM_CMD.cmd, SYSTEM_CMD.ping, {}, options);
  }

  version(options?: GameApiRequestOptions): Promise<ActionResult<SystemVersionDto>> {
    return this.call<SystemVersionDto>(SYSTEM_CMD.cmd, SYSTEM_CMD.version, {}, options);
  }
}

// ===== auth =====

export class AuthApi extends SegmentApi {
  login(params: LoginRequestDto, options?: GameApiRequestOptions): Promise<ActionResult<LoginResponseDto>> {
    return this.call<LoginResponseDto>(AUTH_CMD.cmd, AUTH_CMD.login, params, options);
  }

  logout(options?: GameApiRequestOptions): Promise<ActionResult<null>> {
    return this.call<null>(AUTH_CMD.cmd, AUTH_CMD.logout, {}, options);
  }

  me(options?: GameApiRequestOptions): Promise<ActionResult<MeDto>> {
    return this.call<MeDto>(AUTH_CMD.cmd, AUTH_CMD.me, {}, options);
  }
}

// ===== player =====

export interface PlayerCreateInput {
  name: string;
  /** 职业 key（`role`），如 'warrior'。 */
  role: string;
}

export interface PlayerKeyInput {
  /** 角色稳定 key（`PlayerMetaDto.key`）。 */
  key: string;
}

export interface PlayerImportSaveInput {
  name: string;
  role: string;
  /** 旧版《永夜2016典藏重置版》导出内容的原文（base64 / 混淆串）。 */
  content: string;
}

export interface PlayerExportSaveDto {
  key: string;
  /** 建议文件名（前端直接触发下载）。 */
  filename: string;
  content: string;
}

export class PlayerApi extends SegmentApi {
  list(options?: GameApiRequestOptions): Promise<ActionResult<PlayerMetaDto[]>> {
    return this.call<PlayerMetaDto[]>(PLAYER_CMD.cmd, PLAYER_CMD.list, {}, options);
  }

  create(
    params: PlayerCreateInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<PlayerMetaDto>> {
    return this.call<PlayerMetaDto>(PLAYER_CMD.cmd, PLAYER_CMD.create, params, options);
  }

  remove(params: PlayerKeyInput, options?: GameApiRequestOptions): Promise<ActionResult<null>> {
    return this.call<null>(PLAYER_CMD.cmd, PLAYER_CMD.remove, params, options);
  }

  importSave(
    params: PlayerImportSaveInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<PlayerMetaDto>> {
    return this.call<PlayerMetaDto>(PLAYER_CMD.cmd, PLAYER_CMD.importSave, params, options);
  }

  exportSave(
    params: PlayerKeyInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<PlayerExportSaveDto>> {
    return this.call<PlayerExportSaveDto>(PLAYER_CMD.cmd, PLAYER_CMD.exportSave, params, options);
  }

  /** 选择并进入某个角色（返回完整角色态）。 */
  select(
    params: PlayerKeyInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<PlayerStateDto>> {
    return this.call<PlayerStateDto>(PLAYER_CMD.cmd, PLAYER_CMD.select, params, options);
  }
}

// ===== world =====

export interface WorldEnterMapInput {
  map: string;
  endlessLevel?: number;
}

export class WorldApi extends SegmentApi {
  snapshot(options?: GameApiRequestOptions): Promise<ActionResult<WorldSnapshotDto>> {
    return this.call<WorldSnapshotDto>(WORLD_CMD.cmd, WORLD_CMD.snapshot, {}, options);
  }

  enterMap(
    params: WorldEnterMapInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<WorldSnapshotDto>> {
    return this.call<WorldSnapshotDto>(WORLD_CMD.cmd, WORLD_CMD.enterMap, params, options);
  }

  leave(options?: GameApiRequestOptions): Promise<ActionResult<null>> {
    return this.call<null>(WORLD_CMD.cmd, WORLD_CMD.leave, {}, options);
  }

  /** 放弃离线收益（原版「跳过」按钮）。 */
  skipOffline(options?: GameApiRequestOptions): Promise<ActionResult<null>> {
    return this.call<null>(WORLD_CMD.cmd, WORLD_CMD.skipOffline, {}, options);
  }
}

// ===== battle =====

export interface BattleFocusInput {
  /** 目标单位 id；null 表示取消目标。 */
  targetId: string | null;
}

export class BattleApi extends SegmentApi {
  /** 切换攻击目标（`battle.log` / `battle.loot` 是推送，不提供请求方法）。 */
  focus(params: BattleFocusInput, options?: GameApiRequestOptions): Promise<ActionResult<null>> {
    return this.call<null>(BATTLE_CMD.cmd, BATTLE_CMD.focus, params, options);
  }
}

// ===== inventory =====

export interface InventoryItemRef {
  /** 物品实例 id（`InventorySlotDto.id`）。 */
  id: string;
}

export interface InventorySellInput extends InventoryItemRef {
  count?: number;
}

export interface InventoryLockInput extends InventoryItemRef {
  locked: boolean;
}

export class InventoryApi extends SegmentApi {
  list(options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(INVENTORY_CMD.cmd, INVENTORY_CMD.list, {}, options);
  }

  equip(params: InventoryItemRef, options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(INVENTORY_CMD.cmd, INVENTORY_CMD.equip, params, options);
  }

  unequip(params: InventoryItemRef, options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(INVENTORY_CMD.cmd, INVENTORY_CMD.unequip, params, options);
  }

  sell(params: InventorySellInput, options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(INVENTORY_CMD.cmd, INVENTORY_CMD.sell, params, options);
  }

  lock(params: InventoryLockInput, options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(INVENTORY_CMD.cmd, INVENTORY_CMD.lock, params, options);
  }

  sort(options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(INVENTORY_CMD.cmd, INVENTORY_CMD.sort, {}, options);
  }

  usePackage(params: InventoryItemRef, options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(INVENTORY_CMD.cmd, INVENTORY_CMD.usePackage, params, options);
  }

  /** 用神力扩容背包。 */
  expand(params: { count: number }, options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(INVENTORY_CMD.cmd, INVENTORY_CMD.expand, params, options);
  }
}

// ===== bank =====

export interface BankMoveInput extends InventoryItemRef {
  count?: number;
}

export class BankApi extends SegmentApi {
  list(options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(BANK_CMD.cmd, BANK_CMD.list, {}, options);
  }

  deposit(params: BankMoveInput, options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(BANK_CMD.cmd, BANK_CMD.deposit, params, options);
  }

  withdraw(params: BankMoveInput, options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(BANK_CMD.cmd, BANK_CMD.withdraw, params, options);
  }

  expand(params: { count: number }, options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto[]>> {
    return this.call<InventorySlotDto[]>(BANK_CMD.cmd, BANK_CMD.expand, params, options);
  }
}

// ===== lootrule =====

/** 单条拾取规则（**待迁移**：后端 `dto.ts` 补齐后应移入 `@idle-dark/protocol`）。 */
export interface LootRuleEntryDto {
  /** 规则 id。 */
  id: string;
  /** 品质下限 0..6。 */
  minQuality: number;
  /** 等级下限。 */
  minLevel: number;
  /** 0 拾取 / 1 出售 / 2 分解。 */
  action: 0 | 1 | 2;
  enabled: boolean;
}

/** 拾取规则面板（**待迁移**）。 */
export interface LootRuleStateDto {
  enabled: boolean;
  minLevel: number;
  rules: LootRuleEntryDto[];
}

export interface LootRuleUpdateInput {
  enabled?: boolean;
  rules?: LootRuleEntryDto[];
}

export class LootRuleApi extends SegmentApi {
  get(options?: GameApiRequestOptions): Promise<ActionResult<LootRuleStateDto>> {
    return this.call<LootRuleStateDto>(LOOTRULE_CMD.cmd, LOOTRULE_CMD.get, {}, options);
  }

  update(
    params: LootRuleUpdateInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<LootRuleStateDto>> {
    return this.call<LootRuleStateDto>(LOOTRULE_CMD.cmd, LOOTRULE_CMD.update, params, options);
  }

  setMinLevel(
    params: { minLevel: number },
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<LootRuleStateDto>> {
    return this.call<LootRuleStateDto>(LOOTRULE_CMD.cmd, LOOTRULE_CMD.setMinLevel, params, options);
  }
}

// ===== career =====

/** 职业面板汇总（**待迁移**：由协议侧补齐）。 */
export interface CareerPanelDto {
  careers: CareerProgressDto[];
  skills: SkillDto[];
  enhances: EnhanceDto[];
  /** 技能/强化槽位上限（服务端算好下发）。 */
  maxSkillCount: number;
  maxEnhanceCount: number;
}

export class CareerApi extends SegmentApi {
  list(options?: GameApiRequestOptions): Promise<ActionResult<CareerPanelDto>> {
    return this.call<CareerPanelDto>(CAREER_CMD.cmd, CAREER_CMD.list, {}, options);
  }

  switchCareer(
    params: { career: string },
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<CareerPanelDto>> {
    return this.call<CareerPanelDto>(CAREER_CMD.cmd, CAREER_CMD.switchCareer, params, options);
  }

  selectSkill(
    params: { skill: string },
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<CareerPanelDto>> {
    return this.call<CareerPanelDto>(CAREER_CMD.cmd, CAREER_CMD.selectSkill, params, options);
  }

  unselectSkill(
    params: { skill: string },
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<CareerPanelDto>> {
    return this.call<CareerPanelDto>(CAREER_CMD.cmd, CAREER_CMD.unselectSkill, params, options);
  }

  selectEnhance(
    params: { enhance: string },
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<CareerPanelDto>> {
    return this.call<CareerPanelDto>(CAREER_CMD.cmd, CAREER_CMD.selectEnhance, params, options);
  }

  unselectEnhance(
    params: { enhance: string },
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<CareerPanelDto>> {
    return this.call<CareerPanelDto>(CAREER_CMD.cmd, CAREER_CMD.unselectEnhance, params, options);
  }
}

// ===== produce =====

export interface EnchantInput extends InventoryItemRef {
  /** 被锁定的词缀 key（锁定需额外神力）。 */
  lockedAffixKeys?: string[];
}

export interface RebuildInput extends InventoryItemRef {
  /** 要重铸的词缀 key。 */
  affixKey: string;
}

export interface DecomposeInput {
  /** 单件分解；与 `ids` 二选一。 */
  id?: string;
  /** 整批分解（如 build 背包全部）。 */
  ids?: string[];
}

export interface MedicineUseInput {
  /** 投入的能量材料 key。 */
  material: string;
  count?: number;
}

export class ProduceApi extends SegmentApi {
  enchantCosts(
    params: InventoryItemRef,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<EnchantCostsDto>> {
    return this.call<EnchantCostsDto>(PRODUCE_CMD.cmd, PRODUCE_CMD.enchantCosts, params, options);
  }

  enchant(
    params: EnchantInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<InventorySlotDto>> {
    return this.call<InventorySlotDto>(PRODUCE_CMD.cmd, PRODUCE_CMD.enchant, params, options);
  }

  rebuild(params: RebuildInput, options?: GameApiRequestOptions): Promise<ActionResult<InventorySlotDto>> {
    return this.call<InventorySlotDto>(PRODUCE_CMD.cmd, PRODUCE_CMD.rebuild, params, options);
  }

  decompose(
    params: DecomposeInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<DecomposeResultDto>> {
    return this.call<DecomposeResultDto>(PRODUCE_CMD.cmd, PRODUCE_CMD.decompose, params, options);
  }

  medicineState(options?: GameApiRequestOptions): Promise<ActionResult<MedicineStateDto>> {
    return this.call<MedicineStateDto>(PRODUCE_CMD.cmd, PRODUCE_CMD.medicineState, {}, options);
  }

  medicineUse(
    params: MedicineUseInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<MedicineStateDto>> {
    return this.call<MedicineStateDto>(PRODUCE_CMD.cmd, PRODUCE_CMD.medicineUse, params, options);
  }

  medicineReset(
    params: { currency: 'gold' | 'diamonds' },
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<MedicineStateDto>> {
    return this.call<MedicineStateDto>(PRODUCE_CMD.cmd, PRODUCE_CMD.medicineReset, params, options);
  }
}

// ===== story =====

export class StoryApi extends SegmentApi {
  list(options?: GameApiRequestOptions): Promise<ActionResult<StoryDto[]>> {
    return this.call<StoryDto[]>(STORY_CMD.cmd, STORY_CMD.list, {}, options);
  }

  /** 剧情脚本（DSL 原文 + 解析结果）。 */
  play(params: { key: string }, options?: GameApiRequestOptions): Promise<ActionResult<StoryPlayDto>> {
    return this.call<StoryPlayDto>(STORY_CMD.cmd, STORY_CMD.play, params, options);
  }

  /** 完成击杀 / 购买类任务。 */
  finish(params: { key: string }, options?: GameApiRequestOptions): Promise<ActionResult<StoryDto>> {
    return this.call<StoryDto>(STORY_CMD.cmd, STORY_CMD.finish, params, options);
  }
}

// ===== shop =====

export class ShopApi extends SegmentApi {
  state(options?: GameApiRequestOptions): Promise<ActionResult<ShopStateDto>> {
    return this.call<ShopStateDto>(SHOP_CMD.cmd, SHOP_CMD.state, {}, options);
  }

  /** 购买角色栏位。 */
  buyPlayerSlot(options?: GameApiRequestOptions): Promise<ActionResult<ShopStateDto>> {
    return this.call<ShopStateDto>(SHOP_CMD.cmd, SHOP_CMD.buyPlayerSlot, {}, options);
  }

  /** 神力 ↔ 金币 / 药剂等级搬运。 */
  exchange(
    params: { from: string; to: string; count?: number },
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<ShopStateDto>> {
    return this.call<ShopStateDto>(SHOP_CMD.cmd, SHOP_CMD.exchange, params, options);
  }
}

// ===== idle =====

export class IdleApi extends SegmentApi {
  /** 上次离线结算报告。 */
  report(options?: GameApiRequestOptions): Promise<ActionResult<OfflineReportDto>> {
    return this.call<OfflineReportDto>(IDLE_CMD.cmd, IDLE_CMD.report, {}, options);
  }

  /** 领取离线收益。 */
  claim(options?: GameApiRequestOptions): Promise<ActionResult<OfflineReportDto>> {
    return this.call<OfflineReportDto>(IDLE_CMD.cmd, IDLE_CMD.claim, {}, options);
  }
}

// ===== 聚合入口 =====

/** 全部 13 个 cmd 段的 typed API 聚合。 */
export class GameApi {
  readonly system: SystemApi;
  readonly auth: AuthApi;
  readonly player: PlayerApi;
  readonly world: WorldApi;
  readonly battle: BattleApi;
  readonly inventory: InventoryApi;
  readonly bank: BankApi;
  readonly lootrule: LootRuleApi;
  readonly career: CareerApi;
  readonly produce: ProduceApi;
  readonly story: StoryApi;
  readonly shop: ShopApi;
  readonly idle: IdleApi;

  constructor(readonly transport: GameApiTransport) {
    this.system = new SystemApi(transport);
    this.auth = new AuthApi(transport);
    this.player = new PlayerApi(transport);
    this.world = new WorldApi(transport);
    this.battle = new BattleApi(transport);
    this.inventory = new InventoryApi(transport);
    this.bank = new BankApi(transport);
    this.lootrule = new LootRuleApi(transport);
    this.career = new CareerApi(transport);
    this.produce = new ProduceApi(transport);
    this.story = new StoryApi(transport);
    this.shop = new ShopApi(transport);
    this.idle = new IdleApi(transport);
  }
}
