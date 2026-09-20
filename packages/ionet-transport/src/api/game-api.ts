/**
 * typed Action API —— 按后端 `cmd` 段组织的游戏接口层（14 个段）。
 *
 * 设计约束：
 * - 路由 `(cmd, subCmd)` **只引用 `@idle-dark/protocol` 的 `*_CMD` 常量**，
 *   禁止字面量数字、禁止在本包手工镜像 `cmd.ts`（唯一真相在后端共享包）。
 * - 结果类型一律来自 `@idle-dark/protocol` 的 `dto.ts`（**唯一真相**，本文件不再就地声明）。
 * - **业务失败不抛**：所有方法强制 `allowBusinessFailure: true`，业务失败作为
 *   `ActionResult` 的 `success: false` 分支**返回**（预期分支）；传输层失败
 *   （`errorCode !== 0` / 连接 / 超时）仍抛 `TransportError` 等异常。
 * - 本层**不做任何业务判断**（不判 success、不查码表），只做路由 + 类型收口。
 */
import type {
  ActionResult,
  CareerPanelDto,
  CareerProgressDto,
  ChaosFailModeInput,
  ChaosSequenceInput,
  ChaosStateDto,
  DecomposeResultDto,
  EnchantCostsDto,
  EnhanceDto,
  InventorySlotDto,
  LoginRequestDto,
  LoginResponseDto,
  LootRuleEntryDto,
  LootRuleStateDto,
  LootRuleUpdateInput,
  MapDto,
  MeDto,
  MedicineStateDto,
  OfflineReportDto,
  PlayerMetaDto,
  PlayerStateDto,
  RebuildCostsDto,
  ShopStateDto,
  SkillDto,
  SystemNoticeDto,
  SystemPingDto,
  SystemVersionDto,
  WorldSnapshotDto,
} from '@idle-dark/protocol';
import {
  AUTH_CMD,
  BANK_CMD,
  BATTLE_CMD,
  CAREER_CMD,
  CHAOS_CMD,
  IDLE_CMD,
  INVENTORY_CMD,
  LOOTRULE_CMD,
  MAP_CMD,
  PLAYER_CMD,
  PRODUCE_CMD,
  SHOP_CMD,
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

// system / lootrule / career 的响应形状已归位到 `@idle-dark/protocol`（唯一真相）。
// 这里 re-export 以保持 `@idle-dark/ionet-transport` 既有公共出口不变。
export type {
  SystemNoticeDto,
  SystemPingDto,
  SystemVersionDto,
  LootRuleEntryDto,
  LootRuleStateDto,
  LootRuleUpdateInput,
  CareerPanelDto,
};

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

// ===== map（开放世界控制器，cmd 130；09 R2） =====

export interface MapEnterInput {
  map: string;
  /** 幂等键：同 opId 重放不重复切换 / 不重复扣费。 */
  opId?: string;
}

export class MapApi extends SegmentApi {
  /** 地图目录 + 解锁状态。 */
  list(options?: GameApiRequestOptions): Promise<ActionResult<MapDto[]>> {
    return this.call<MapDto[]>(MAP_CMD.cmd, MAP_CMD.list, {}, options);
  }

  snapshot(options?: GameApiRequestOptions): Promise<ActionResult<WorldSnapshotDto>> {
    return this.call<WorldSnapshotDto>(MAP_CMD.cmd, MAP_CMD.snapshot, {}, options);
  }

  /** 进入地图（控制器做解锁判定；`opId` 幂等）。 */
  enter(params: MapEnterInput, options?: GameApiRequestOptions): Promise<ActionResult<WorldSnapshotDto>> {
    return this.call<WorldSnapshotDto>(MAP_CMD.cmd, MAP_CMD.enter, params, options);
  }

  leave(options?: GameApiRequestOptions): Promise<ActionResult<null>> {
    return this.call<null>(MAP_CMD.cmd, MAP_CMD.leave, {}, options);
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

// LootRuleEntryDto / LootRuleStateDto / LootRuleUpdateInput 已归位到 `@idle-dark/protocol`
// （见本文件顶部的 re-export）。

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

// CareerPanelDto 已归位到 `@idle-dark/protocol`（见本文件顶部的 re-export）。

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

// ===== 混沌仪（无尽，W6） =====

export class ChaosApi extends SegmentApi {
  /** 混沌仪状态（解锁 / 16 阶 + 钥石持有 / 序列 / 失败选项 / 进度）。 */
  state(options?: GameApiRequestOptions): Promise<ActionResult<ChaosStateDto>> {
    return this.call<ChaosStateDto>(CHAOS_CMD.cmd, CHAOS_CMD.state, {}, options);
  }

  /** 保存钥石序列（≤16，可重复）。 */
  setSequence(
    params: ChaosSequenceInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<ChaosStateDto>> {
    return this.call<ChaosStateDto>(CHAOS_CMD.cmd, CHAOS_CMD.setSequence, params, options);
  }

  /** 设置失败选项。 */
  setFailMode(
    params: ChaosFailModeInput,
    options?: GameApiRequestOptions,
  ): Promise<ActionResult<ChaosStateDto>> {
    return this.call<ChaosStateDto>(CHAOS_CMD.cmd, CHAOS_CMD.setFailMode, params, options);
  }

  /** 开始运行（消耗首个钥石并进入对应 T 阶）。 */
  start(options?: GameApiRequestOptions): Promise<ActionResult<ChaosStateDto>> {
    return this.call<ChaosStateDto>(CHAOS_CMD.cmd, CHAOS_CMD.start, {}, options);
  }

  /** 停止运行（回到普通地图）。 */
  stop(options?: GameApiRequestOptions): Promise<ActionResult<ChaosStateDto>> {
    return this.call<ChaosStateDto>(CHAOS_CMD.cmd, CHAOS_CMD.stop, {}, options);
  }
}

// ===== 聚合入口 =====

/** 全部 14 个 cmd 段的 typed API 聚合。 */
export class GameApi {
  readonly system: SystemApi;
  readonly auth: AuthApi;
  readonly player: PlayerApi;
  readonly world: WorldApi;
  readonly map: MapApi;
  readonly battle: BattleApi;
  readonly inventory: InventoryApi;
  readonly bank: BankApi;
  readonly lootrule: LootRuleApi;
  readonly career: CareerApi;
  readonly produce: ProduceApi;
  readonly shop: ShopApi;
  readonly idle: IdleApi;
  readonly chaos: ChaosApi;

  constructor(readonly transport: GameApiTransport) {
    this.system = new SystemApi(transport);
    this.auth = new AuthApi(transport);
    this.player = new PlayerApi(transport);
    this.world = new WorldApi(transport);
    this.map = new MapApi(transport);
    this.battle = new BattleApi(transport);
    this.inventory = new InventoryApi(transport);
    this.bank = new BankApi(transport);
    this.lootrule = new LootRuleApi(transport);
    this.career = new CareerApi(transport);
    this.produce = new ProduceApi(transport);
    this.shop = new ShopApi(transport);
    this.idle = new IdleApi(transport);
    this.chaos = new ChaosApi(transport);
  }
}
