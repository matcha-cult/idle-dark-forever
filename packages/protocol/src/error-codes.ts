/**
 * 业务错误码表（前后端共用）。
 *
 * 与传输层 errorCode（400/404/500，见 PROTOCOL.md §8）是**两个层级**：
 * 业务错误一律以 errorCode=0 送达，靠 `ActionResult.success === false` + 本表判定。
 *
 * 命名：DOMAIN_REASON，全大写下划线。新增码必须同时在前端 `businessErrorMessage` 补文案。
 */

export const BusinessErrorCode = {
  /** 未鉴权 / 会话失效 */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** 参数非法 */
  INVALID_PARAM: 'INVALID_PARAM',
  /** 通用：服务端内部业务异常 */
  INTERNAL: 'INTERNAL',

  /** 角色 */
  PLAYER_NOT_FOUND: 'PLAYER_NOT_FOUND',
  PLAYER_SLOT_FULL: 'PLAYER_SLOT_FULL',
  PLAYER_NAME_TAKEN: 'PLAYER_NAME_TAKEN',
  SAVE_IMPORT_INVALID: 'SAVE_IMPORT_INVALID',
  SAVE_IMPORT_UNSUPPORTED: 'SAVE_IMPORT_UNSUPPORTED',

  /** 物品 */
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  ITEM_NOT_ENOUGH: 'ITEM_NOT_ENOUGH',
  INVENTORY_FULL: 'INVENTORY_FULL',
  ITEM_LOCKED: 'ITEM_LOCKED',
  ITEM_NOT_EQUIPPABLE: 'ITEM_NOT_EQUIPPABLE',
  LEVEL_TOO_LOW: 'LEVEL_TOO_LOW',
  CLASS_NOT_ALLOWED: 'CLASS_NOT_ALLOWED',

  /** 经济 */
  NOT_ENOUGH_GOLD: 'NOT_ENOUGH_GOLD',
  NOT_ENOUGH_DIAMONDS: 'NOT_ENOUGH_DIAMONDS',
  NOT_ENOUGH_MATERIAL: 'NOT_ENOUGH_MATERIAL',

  /** 职业 / 技能 */
  CAREER_LOCKED: 'CAREER_LOCKED',
  SKILL_LOCKED: 'SKILL_LOCKED',
  SKILL_SLOT_FULL: 'SKILL_SLOT_FULL',
  ENHANCE_SLOT_FULL: 'ENHANCE_SLOT_FULL',
  ENHANCE_LOCKED: 'ENHANCE_LOCKED',

  /** 地图 / 战斗 */
  MAP_LOCKED: 'MAP_LOCKED',
  NO_TICKET: 'NO_TICKET',
  ALREADY_IN_MAP: 'ALREADY_IN_MAP',
  NOT_IN_MAP: 'NOT_IN_MAP',

  /** 故事 */
  STORY_NOT_FOUND: 'STORY_NOT_FOUND',
  STORY_LOCKED: 'STORY_LOCKED',
  STORY_ALREADY_DONE: 'STORY_ALREADY_DONE',

  /** 幂等 / 重放 */
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
  /** 触发限流 */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type BusinessErrorCode = (typeof BusinessErrorCode)[keyof typeof BusinessErrorCode];

/** 中文兜底文案（前端优先用服务端 `message`，缺失时用本表）。 */
export const BUSINESS_ERROR_MESSAGE: Record<string, string> = {
  UNAUTHORIZED: '登录已失效，请重新登录',
  INVALID_PARAM: '参数不合法',
  INTERNAL: '服务器开小差了，请稍后再试',
  PLAYER_NOT_FOUND: '角色不存在',
  PLAYER_SLOT_FULL: '角色栏位已满',
  PLAYER_NAME_TAKEN: '角色名已被占用',
  SAVE_IMPORT_INVALID: '存档文件损坏或格式不正确',
  SAVE_IMPORT_UNSUPPORTED: '该存档版本暂不支持导入',
  ITEM_NOT_FOUND: '物品不存在',
  ITEM_NOT_ENOUGH: '物品数量不足',
  INVENTORY_FULL: '包裹已满',
  ITEM_LOCKED: '物品已锁定',
  ITEM_NOT_EQUIPPABLE: '该物品无法装备',
  LEVEL_TOO_LOW: '等级不足',
  CLASS_NOT_ALLOWED: '当前职业无法装备',
  NOT_ENOUGH_GOLD: '金币不足',
  NOT_ENOUGH_DIAMONDS: '神力不足',
  NOT_ENOUGH_MATERIAL: '材料不足',
  CAREER_LOCKED: '职业尚未解锁',
  SKILL_LOCKED: '技能尚未解锁',
  SKILL_SLOT_FULL: '技能栏已满',
  ENHANCE_SLOT_FULL: '强化栏已满',
  ENHANCE_LOCKED: '强化尚未解锁',
  MAP_LOCKED: '地图尚未解锁',
  NO_TICKET: '缺少副本钥匙',
  ALREADY_IN_MAP: '已经在当前地图中',
  NOT_IN_MAP: '当前不在战斗中',
  STORY_NOT_FOUND: '剧情不存在',
  STORY_LOCKED: '剧情条件未满足',
  STORY_ALREADY_DONE: '剧情已完成',
  DUPLICATE_OPERATION: '操作重复提交',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
};

export function businessErrorMessage(code: string): string {
  return BUSINESS_ERROR_MESSAGE[code] ?? '操作失败';
}
