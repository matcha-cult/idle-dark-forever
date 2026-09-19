/**
 * idle-dark-forever 线协议 —— cmd 段规划（唯一真相）
 *
 * 约定（沿用 ionet-ts / idle-path-of-xiuxian 的工程约定）：
 * - 一个业务域占一个 cmd 段；段间留 10 的间隔，便于同域扩容；
 * - 段内 subCmd 从 1 起，0 保留；
 * - 新增 Action 只能落在已登记的段与 subCmd 上，禁止跨段乱用；
 * - **前端不再手工镜像本文件**：`@idle-dark/ionet-transport` 直接依赖本包，消除漂移。
 *
 * 推送（kind='notification'）与请求共用 (cmd, subCmd) 命名空间，靠 kind 区分；
 * 带 `(push)` 注释的 subCmd 同时是服务端主动推送路由。
 */

export const CMD_SEGMENTS = {
  /** 系统 / 健康 */
  system: 1,
  /** 认证：登录 / 登出 / 会话 */
  auth: 10,
  /** 角色：列表 / 创建 / 删除 / 存档导入导出 */
  player: 20,
  /** 战斗世界：快照 / 进出地图 / 离线 */
  world: 30,
  /** 战斗事件：日志 / 掉落 / 目标切换 */
  battle: 40,
  /** 背包与装备 */
  inventory: 50,
  /** 储藏箱 */
  bank: 60,
  /** 自动拾取规则 */
  lootrule: 70,
  /** 职业 / 技能 / 被动（强化） */
  career: 80,
  /** 生产：附魔 / 重铸 / 炼金 / 分解 */
  produce: 90,
  /** 故事与剧情 */
  story: 100,
  /** 神力商店与兑换（原内购页） */
  shop: 110,
  /** 离线结算 */
  idle: 120,
  /**
   * 地图 / 开放世界控制器（09 R2；cmd 段 130）
   *
   * 与 battle 的 `world`(30) 段分工：`map.*` 是**控制器**（地图目录、解锁判定、
   * 位置/种子、进图决策），`world.*`(30) 是 battle **会话宿主**的入口；
   * 控制器决定"进哪张图"，battle 执行会话切换。
   */
  map: 130,
} as const;

export type CmdSegment = (typeof CMD_SEGMENTS)[keyof typeof CMD_SEGMENTS];

/** 系统段 */
export const SYSTEM_CMD = {
  cmd: CMD_SEGMENTS.system,
  /** WS 应用层心跳（PROTOCOL §7 建议复用 system ping） */
  ping: 1,
  /** 服务端版本与公告版本 */
  version: 2,
  /** (push) 系统通知 / 公告 */
  notice: 3,
} as const;

/** 认证段 */
export const AUTH_CMD = {
  cmd: CMD_SEGMENTS.auth,
  login: 1,
  logout: 2,
  me: 3,
} as const;

/** 角色段 */
export const PLAYER_CMD = {
  cmd: CMD_SEGMENTS.player,
  /** 角色列表（轻量元数据） */
  list: 1,
  create: 2,
  remove: 3,
  /** 导入《永夜2016典藏重置版》本地存档 */
  importSave: 4,
  /** 导出服务端存档（保留原版「存档下载」能力） */
  exportSave: 5,
  /** 选择并进入某个角色（返回完整角色态） */
  select: 6,
} as const;

/** 战斗世界段 */
export const WORLD_CMD = {
  cmd: CMD_SEGMENTS.world,
  /** 当前世界快照（单位列表 / 地图 / 离线待结算） */
  snapshot: 1,
  enterMap: 2,
  leave: 3,
  /** 放弃离线收益（原版「跳过」按钮） */
  skipOffline: 4,
  /** (push) 世界 tick：单位快照增量 */
  tick: 5,
} as const;

/** 战斗事件段 */
export const BATTLE_CMD = {
  cmd: CMD_SEGMENTS.battle,
  /** (push) 战斗日志批次 */
  log: 1,
  /** (push) 掉落获得 */
  loot: 2,
  /** 切换攻击目标 */
  focus: 3,
} as const;

/** 背包段 */
export const INVENTORY_CMD = {
  cmd: CMD_SEGMENTS.inventory,
  list: 1,
  equip: 2,
  unequip: 3,
  sell: 4,
  /** 锁定 / 解锁 */
  lock: 5,
  sort: 6,
  /** 打开包裹类道具 */
  usePackage: 7,
  /** 用神力扩容背包 */
  expand: 8,
  /** (push) 背包变更 */
  changed: 9,
} as const;

/** 储藏箱段 */
export const BANK_CMD = {
  cmd: CMD_SEGMENTS.bank,
  list: 1,
  deposit: 2,
  withdraw: 3,
  expand: 4,
} as const;

/** 拾取规则段 */
export const LOOTRULE_CMD = {
  cmd: CMD_SEGMENTS.lootrule,
  get: 1,
  update: 2,
  setMinLevel: 3,
} as const;

/** 职业与技能段 */
export const CAREER_CMD = {
  cmd: CMD_SEGMENTS.career,
  /** 职业 / 技能 / 被动 / 强化 汇总面板 */
  list: 1,
  switchCareer: 2,
  selectSkill: 3,
  unselectSkill: 4,
  selectEnhance: 5,
  unselectEnhance: 6,
  /** (push) 升级 / 巅峰 / 技能升级 */
  levelup: 7,
} as const;

/** 生产段 */
export const PRODUCE_CMD = {
  cmd: CMD_SEGMENTS.produce,
  /** 附魔费用预览（含锁定词缀的神力消耗） */
  enchantCosts: 1,
  enchant: 2,
  /** 重铸单条词缀（费用预览与执行同参） */
  rebuild: 3,
  /** 分解（单件或 build 背包整批） */
  decompose: 4,
  /** 炼金状态（药剂等级 / 经验 / 坩埚） */
  medicineState: 5,
  /** 投入能量材料 */
  medicineUse: 6,
  /** 药剂重置（金币 / 神力） */
  medicineReset: 7,
} as const;

/** 故事段 */
export const STORY_CMD = {
  cmd: CMD_SEGMENTS.story,
  list: 1,
  /** 剧情脚本（DSL 原文 + 解析结果） */
  play: 2,
  /** 完成击杀 / 购买类任务 */
  finish: 3,
  /** (push) 可开启新剧情 */
  unlock: 4,
} as const;

/** 神力商店段 */
export const SHOP_CMD = {
  cmd: CMD_SEGMENTS.shop,
  state: 1,
  /** 购买角色栏位 */
  buyPlayerSlot: 2,
  /** 神力 ↔ 金币 / 药剂等级搬运 */
  exchange: 3,
} as const;

/** 离线结算段 */
export const IDLE_CMD = {
  cmd: CMD_SEGMENTS.idle,
  /** 上次离线结算报告 */
  report: 1,
  /** 领取离线收益 */
  claim: 2,
} as const;

/**
 * 地图 / 开放世界控制器段（09 R2）
 *
 * `continueOpenWorld` 供 dungeon 队列耗尽后转入非秘境战斗图（RD3/RD4），
 * 不经客户端，由控制器间调用。`enter` 幂等（`opId`）。
 */
export const MAP_CMD = {
  cmd: CMD_SEGMENTS.map,
  /** 地图目录 + 解锁状态（`MapDto[]`） */
  list: 1,
  /** 当前世界快照（与 `world.snapshot` 同形，便于控制器统一入口） */
  snapshot: 2,
  /** 进入地图（解锁判定 + 幂等 opId；地城票在 R3 由 dungeon 控制器扣） */
  enter: 3,
  /** 离开当前地图（关会话） */
  leave: 4,
  /** 控制器间命令：队列耗尽后转非秘境战斗图（RD3/RD4） */
  continueOpenWorld: 5,
} as const;

/** `(cmd << 16) | subCmd` 路由键（与 ionet-ts CmdInfo.cmdMerge 一致）。 */
export function cmdMerge(cmd: number, subCmd: number): number {
  return (cmd << 16) | subCmd;
}

/**
 * 免鉴权 Action 白名单（cmdMerge 键）。
 * 其余 Action 必须携带合法 token，否则 WS 握手鉴权不会绑定 userId。
 */
export const PUBLIC_ACTION_KEYS: ReadonlySet<number> = new Set<number>([
  cmdMerge(SYSTEM_CMD.cmd, SYSTEM_CMD.ping),
  cmdMerge(SYSTEM_CMD.cmd, SYSTEM_CMD.version),
  cmdMerge(AUTH_CMD.cmd, AUTH_CMD.login),
]);
