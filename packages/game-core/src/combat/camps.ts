/**
 * 阵营与阵营关系（原版 `src/logics/unit.js` 第 36–88 行，**逐字照抄**）。
 *
 * 三张表语义不同，不可互换：
 * - `Camps`           阵营枚举本身；
 * - `CampRelation`    「敌对/可攻击」关系：
 *                       `'hate'` = 可以被 `findTarget()` 自动选为攻击目标，
 *                       `true`   = 可以主动攻击，但不会自动选为目标；
 * - `IsAlien`         「可协助（友军）」关系：决定 `willAssist` / 光环类技能的覆盖范围。
 *
 * 原版直接以 `CampRelation[this.camp][target.camp]` 取值；若某个 camp 缺项会得到
 * `undefined`（falsy）。移植后保持相同行为，读取统一走 `relation()` / `canAttack()`
 * 辅助函数，避免下标越界抛错。
 */

export const Camps = {
  ghost: 'ghost', // 不参战
  neutral: 'neutral', // 中立（但可被攻击）
  player: 'player', // 玩家（包括玩家、盟友、召唤生物）
  alien: 'alien', // 联军（盟友/召唤生物，但不可指定目标）
  enemy: 'enemy', // 敌人（野怪，敌人的召唤生物）
  story: 'story', // 剧情角色，不攻击。
  shrine: 'shrine',
} as const;

export type Camp = (typeof Camps)[keyof typeof Camps];

/** `'hate'` = 自动攻击；`true` = 可攻击但不自动。 */
export type CampRelationValue = true | 'hate';

export const CampRelation: Record<Camp, Partial<Record<Camp, CampRelationValue>>> = {
  ghost: {},
  neutral: {
    player: true, // 不自动攻击，但可以攻击玩家
    alien: true,
  },
  player: {
    neutral: true, // 不自动攻击，但可以攻击中立目标
    enemy: 'hate', // 玩家自动攻击敌人
  },
  alien: {
    neutral: true, // 不自动攻击，但可以攻击中立目标
    enemy: 'hate', // 玩家自动攻击敌人
  },
  enemy: {
    player: 'hate', // 敌人自动攻击玩家
    alien: 'hate',
  },
  shrine: {},
  story: {},
};

export const IsAlien: Record<Camp, Partial<Record<Camp, true>>> = {
  ghost: {},
  neutral: {
    neutral: true,
    enemy: true,
  },
  player: {
    player: true,
    alien: true,
  },
  alien: {
    player: true,
    alien: true,
  },
  enemy: {
    neutral: true,
    enemy: true,
  },
  shrine: {},
};

/** 原版 `CampRelation[camp][target]`（可能 undefined）。 */
export function campRelation(from: Camp, to: Camp): CampRelationValue | undefined {
  return CampRelation[from][to];
}

/** 原版 `canAttack`。 */
export function canAttackCamp(from: Camp, to: Camp): boolean {
  return !!CampRelation[from][to];
}

/** 原版 `willAttack` 的关系判定部分（hook 之外）。 */
export function hatesCamp(from: Camp, to: Camp): boolean {
  return CampRelation[from][to] === 'hate';
}

/** 原版 `willAssist`。 */
export function assistsCamp(from: Camp, to: Camp): boolean {
  return !!IsAlien[from][to];
}
