/**
 * 玩家单位（原版 `src/logics/unit.js` 的 `class PlayerUnit`，第 1073–1847 行）。
 *
 * ## 依赖注入
 *
 * 原版 `PlayerUnit` 直接读单例 `player` / `game` / `world`。这里用 `PlayerLike`
 * 接口把「玩家状态」抽象成注入依赖：
 * - `roleData` / `careerData` / `careerInfo` / `equipments` 等字段与原版逐一对齐；
 * - `game.medicineLevel` → `world.getMedicineLevel(type)`；
 * - `transformEquipLevel` 是原版 `player.js` 的纯函数，已在 `util.ts` 内置一份。
 *
 * ## 四类 hook 来源（原版用 4 个 autorun 自动重绑）
 *
 * | 来源 | 原版 | 本移植 |
 * |---|---|---|
 * | 装备词缀 | `autorun` 监听 `player.equipments[position]` | `rebindEquipmentHooks()` |
 * | 被动 | `autorun` 监听 `careerData.passives` 与 `player.level` | `rebindPassiveHooks()`（升级时自动重绑） |
 * | 强化 | `autorun` 监听 `careerInfo.selectedEnhances` | `rebindEnhanceHooks()` |
 * | 药剂 | 构造时一次性绑定，读取时取 `medicineLevel` | 构造时一次性绑定（同原版） |
 *
 * 换装 / 选强化后**必须**由上层显式调用对应的 `rebind*`（这是去 MobX 后的必要契约，
 * 见交付报告「语义差异清单」）。
 */

import type { TimerHandle } from '../contracts/ports.js';
import type { AttrHooks } from '../contracts/data.js';
import { Camps } from './camps.js';
import type { BattleWorld } from './battle-world.js';
import { SkillState } from './skill-state.js';
import { Unit, type UnitSavedState } from './unit.js';
import { transformEquipLevel } from './util.js';

export type EquipPosition = 'weapon' | 'plastron' | 'gaiter' | 'ornament';

export interface EquipmentSlotLike {
  empty: boolean;
  goodData?: { type?: string; class?: string } | null;
  level: number;
  atk: number;
  atkSpeed: number;
  def: number;
  maxHp: number;
  mpRecovery?: number;
  mpFromKill?: number;
  affixes: Array<{ affixData: { hooks?: AttrHooks }; value: number }>;
}

export interface RoleLike {
  key?: string;
  attrBase: Record<'str' | 'dex' | 'int' | 'sta', number>;
  atk?: number;
  atkSpeed?: number;
}

export interface CareerLike {
  key: string;
  /** 被动 key → 生效所需等级。 */
  passives: Record<string, number>;
  attrGrow: Record<'str' | 'dex' | 'int' | 'sta', number>;
  availableClasses: Record<string, boolean>;
}

export interface PlayerLike {
  key?: number | null;
  name: string;
  level: number;
  peakLevel: number;
  exp: number;
  maxExp: number;
  peakExp: number;
  maxPeakExp: number;
  maxLevel: number;
  roleData: RoleLike;
  careerData: CareerLike;
  careerInfo: { selectedSkills: string[]; selectedEnhances: string[] };
  equipments: Record<EquipPosition, EquipmentSlotLike>;
  getSkillLevel(type: string): number;
  addSkillExp(type: string, inc: number): void;
  selectCareer(career: string): void;
  dispose?(): void;
  // 掉落/门票（原版 `player.js` 的 inventory 侧，任务 A 只消费）：
  /**
   * 拾取规则（扁平编码，见 `rules/loot-rule.ts`）。
   *
   * ⚠️ 这里曾误标为 `Map<string, Record<number, number>>`（原版的 `Map<class, number[]>`），
   * 而 `Player.lootRule` 实际是 `Map<string, number>` —— 类型撒谎直接掩盖了掉落规则的编码错配。
   */
  lootRule?: ReadonlyMap<string, number>;
  minLootLevel?: number;
  loot?(slot: unknown): void;
  countTicket?(type: string): number;
  costTicket?(type: string): void;
}

export interface PlayerSavedState extends UnitSavedState {
  type?: string;
  rebornTimer?: number;
}

export class PlayerUnit extends Unit {
  player: PlayerLike | null = null;

  rebornTimer: TimerHandle | null = null;
  rebornTimerStart: number | null = null;

  private equipmentHookDisposes: Array<() => void> = [];
  private passiveHookDisposes: Array<() => void> = [];
  private enhanceHookDisposes: Array<() => void> = [];

  constructor(world: BattleWorld, player: PlayerLike, savedState?: PlayerSavedState | null) {
    super(world, savedState);

    this.player = player;

    // 装备 / 被动 / 强化三类 hook 的显式绑定（替代原版 autorun）。
    this.rebindEquipmentHooks();
    this.rebindPassiveHooks();
    this.rebindEnhanceHooks();

    // 药剂加成（原版第 1161–1176 行）：构造时绑定一次，数值在调用时读取。
    for (const type of Object.keys(world.tables.medicines)) {
      const hooks = world.tables.medicines[type]?.hooks;
      if (!hooks) {
        continue;
      }
      for (const key of Object.keys(hooks)) {
        this.addAttrHook(key, ((...args: unknown[]) => {
          return (hooks[key] as unknown as (this: PlayerUnit, level: number, ...a: unknown[]) => number).apply(
            this,
            [world.getMedicineLevel(type), ...args],
          );
        }) as never);
      }
    }

    const selectedSkills = player.careerInfo.selectedSkills;
    // 注意：原版 PlayerUnit.addSkill 只接受 `type`，构造器这里传入的 `saved`
    // 被 JS 静默丢弃（玩家技能冷却不会从存档恢复）。移植保持该行为。
    for (let i = selectedSkills.length - 1; i >= 0; i--) {
      this.addSkill(selectedSkills[i]!);
    }

    if (savedState) {
      this.camp = (savedState.camp as typeof this.camp) ?? this.camp;

      if (savedState.rebornTimer) {
        this.world.sink.general({
          text: `player.death:${this.name}:${(savedState.rebornTimer / 1000).toFixed(1)}`,
        });
        this.rebornTimerStart = this.logicClock.getTime();
        this.rebornTimer = this.logicClock.setTimeout(this.reborn, savedState.rebornTimer);
      } else if (this.camp === Camps.ghost) {
        const rebornIn = 10 + player.level * 0.5;
        this.world.sink.general({ text: `player.death:${this.name}:${rebornIn}` });
        this.rebornTimerStart = this.logicClock.getTime();
        this.rebornTimer = this.logicClock.setTimeout(this.reborn, rebornIn * 1000);
      }

      if (savedState.buffs) {
        for (const buff of savedState.buffs) {
          // 这里不检查 buff 叠加情况
          if (buff && buff.time && buff.time > 0) {
            this.addBuff(buff.type, buff.time, buff.arg, buff.group, 99999);
          }
        }
      }

      this.hp = savedState.hp ?? this.hp;
      this.mp = savedState.mp ?? this.mp;
      this.rp = savedState.rp ?? this.rp;
      this.ep = savedState.ep ?? this.ep;

      if (typeof savedState.reading === 'number') {
        this.reading = this.buffs[savedState.reading] ?? null;
      } else if (typeof savedState.casting === 'number') {
        const skill = this.skills[savedState.casting];
        const castTime = savedState.castingTimer ?? 0;
        if (skill) {
          this.castingTimer = this.clock.setTimeout(() => {
            if (skill.canUse) {
              skill.effect();
            }
            this.castingTimer = null;
            this.castingTimerStart = null;
            this.casting = null;
            this.scheduleSkillEvaluation();
          }, castTime);
          this.castingTimerStart = this.clock.getTime();
          this.casting = skill;
        }
      }
    } else {
      this.hp = this.maxHp;
      this.mp = this.maxMp;
      this.camp = Camps.player;
    }

    this.setAttackCoolDown();

    this.startRecovery();
    this.refreshSpeedRate();
  }

  override initKeepAlives(): void {
    super.initKeepAlives();
  }

  // ────────────────────────────── hook 重绑 ──────────────────────────────

  private static disposeAll(list: Array<() => void>): void {
    for (const dispose of list.splice(0)) {
      dispose();
    }
  }

  /** 原版第 1083–1107 行的 autorun：装备词缀 hook。 */
  rebindEquipmentHooks(): void {
    PlayerUnit.disposeAll(this.equipmentHookDisposes);
    const player = this.player;
    if (!player) {
      return;
    }
    (['weapon', 'plastron', 'gaiter', 'ornament'] as EquipPosition[]).forEach((position) => {
      const slot = player.equipments[position];
      if (!slot || slot.empty) {
        return;
      }
      for (const affixInfo of slot.affixes) {
        const hooks = affixInfo.affixData.hooks;
        if (!hooks) {
          continue;
        }
        for (const key of Object.keys(hooks)) {
          this.equipmentHookDisposes.push(
            this.addAttrHook(key, (hooks[key] as unknown as (v: number) => number).bind(this, affixInfo.value) as never),
          );
        }
      }
    });
    this.refreshSpeedRate();
  }

  /** 原版第 1110–1136 行的 autorun：被动技能 hook（依赖玩家等级）。 */
  rebindPassiveHooks(): void {
    PlayerUnit.disposeAll(this.passiveHookDisposes);
    const player = this.player;
    if (!player) {
      return;
    }
    Object.keys(player.careerData.passives).forEach((passive) => {
      const active = (player.careerData.passives[passive] ?? Infinity) <= player.level;
      if (!active) {
        return;
      }
      const hooks = this.world.tables.passives[passive]?.hooks;
      if (!hooks) {
        return;
      }
      for (const key of Object.keys(hooks)) {
        this.passiveHookDisposes.push(
          this.addAttrHook(
            key,
            (hooks[key] as unknown as (w: BattleWorld, v: number) => number).bind(this, this.world),
          ),
        );
      }
    });
    this.refreshSpeedRate();
  }

  /** 原版第 1139–1159 行的 autorun：强化技能 hook。 */
  rebindEnhanceHooks(): void {
    PlayerUnit.disposeAll(this.enhanceHookDisposes);
    const player = this.player;
    if (!player) {
      return;
    }
    player.careerInfo.selectedEnhances.forEach((v) => {
      const hooks = this.world.tables.enhances[v]?.hooks;
      if (!hooks) {
        return;
      }
      for (const key of Object.keys(hooks)) {
        this.enhanceHookDisposes.push(
          this.addAttrHook(
            key,
            (hooks[key] as unknown as (w: BattleWorld, v: number) => number).bind(this, this.world),
          ),
        );
      }
    });
    this.refreshSpeedRate();
  }

  selectCareer(career: string): void {
    for (const state of this.skills.splice(0)) {
      state.dispose();
    }
    this.player?.selectCareer(career);
    const selectedSkills = this.player?.careerInfo.selectedSkills ?? [];
    for (let i = selectedSkills.length - 1; i >= 0; i--) {
      this.addSkill(selectedSkills[i]!);
    }
    this.rebindPassiveHooks();
    this.scheduleSkillEvaluation();
  }

  // ────────────────────────────── 身份 ──────────────────────────────

  override get name(): string {
    if (!this.player) {
      return '';
    }
    return this.player.name;
  }

  override get displayName(): string {
    return this.runAttrHooks(this.name, 'displayName');
  }

  // ────────────────────────────── 四维 ──────────────────────────────

  private attrBase(key: 'str' | 'dex' | 'int' | 'sta'): number {
    let ret = 0;
    if (this.player) {
      ret += this.player.roleData.attrBase[key];
      ret += this.player.careerData.attrGrow[key] * (this.player.level + this.player.peakLevel);
    }
    ret = this.runAttrHooks(ret, key);
    return ret;
  }

  get str(): number {
    return this.attrBase('str');
  }
  get dex(): number {
    return this.attrBase('dex');
  }
  get int(): number {
    return this.attrBase('int');
  }
  get sta(): number {
    return this.attrBase('sta');
  }

  // ────────────────────────────── 生命 / 资源上限 ──────────────────────────────

  override get maxHp(): number {
    let ret = 50 + this.level * 10;
    // 耐力加成
    const ornament = this.player?.equipments.ornament;
    if (ornament && !ornament.empty) {
      ret += ornament.maxHp;
    }
    ret = this.runAttrHooks(ret, 'maxHp');
    ret = this.runAttrHooks(ret, 'maxHpMul');
    ret *= this.sta / 100 + 1;
    ret *= this.runAttrHooks(1, 'maxHpAdd');

    return ret;
  }

  override get maxCombo(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'maxCombo');
    return ret;
  }

  override get hpRecovery(): number {
    let ret = 0;
    // 自宅回血，正常 30 秒回满
    if (this.world.map === 'home') {
      ret += this.maxHp / 30;
    }
    ret = this.runAttrHooks(ret, 'hpRecovery');
    return ret;
  }

  override get maxMp(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'maxMp');
    ret = this.runAttrHooks(ret, 'maxMpMul');

    // 每点智力增加 1% 法力上限
    ret *= 1 + this.int * 0.01;
    return ret;
  }

  override get mpRecovery(): number {
    let ret = 0;
    // 自宅回蓝，正常 20 秒回满
    if (this.world.map === 'home') {
      ret += this.maxMp / 20;
    }
    const weapon = this.player?.equipments.weapon;
    if (weapon && !weapon.empty) {
      ret += weapon.mpRecovery || 0;
    }
    ret = this.runAttrHooks(ret, 'mpRecovery');
    return ret;
  }

  override get mpFromKill(): number {
    let ret = 0;
    const weapon = this.player?.equipments.weapon;
    if (weapon && !weapon.empty) {
      ret += weapon.mpFromKill || 0;
    }
    ret = this.runAttrHooks(ret, 'mpFromKill');
    return ret;
  }

  override get hpFromKill(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'hpFromKill');
    return ret;
  }

  override get maxRp(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'maxRp');
    ret = this.runAttrHooks(ret, 'maxRpMul');
    return ret;
  }

  override get rpRecovery(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'rpRecovery');
    ret = this.runAttrHooks(ret, 'rpReceiveMul');
    ret -= 1; // 固定每秒衰竭 1 点怒气
    return ret;
  }

  override get maxEp(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'maxEp');
    ret = this.runAttrHooks(ret, 'maxEpMul');
    return ret;
  }

  override get epRecovery(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'epRecovery');
    ret = this.runAttrHooks(ret, 'epRecoveryMul');
    return ret;
  }

  override get rpOnAttack(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'rpOnAttack');
    ret = this.runAttrHooks(ret, 'rpReceiveMul');
    return ret;
  }

  override get rpOnAttacked(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'rpOnAttacked');
    ret = this.runAttrHooks(ret, 'rpReceiveMul');
    return ret;
  }

  get exp(): number {
    if (!this.player) {
      return 0;
    }
    if (this.player.level >= this.player.maxLevel) {
      return this.player.peakExp;
    }
    return this.player.exp;
  }

  get maxExp(): number {
    if (!this.player) {
      return 0;
    }
    if (this.player.level >= this.player.maxLevel) {
      return this.player.maxPeakExp;
    }
    return this.player.maxExp;
  }

  // ────────────────────────────── 战斗数值 ──────────────────────────────

  override get atk(): number {
    if (!this.player) {
      return 0;
    }
    let ret: number;
    const weapon = this.player.equipments.weapon;
    if (weapon && !weapon.empty) {
      ret = weapon.atk;
    } else {
      ret = this.player.roleData.atk || 0;
    }
    ret = this.runAttrHooks(ret, 'atk');
    ret *= this.runAttrHooks(1, 'atkAdd');
    ret *= this.runAttrHooks(1, 'atkMulAttr');
    ret = this.runAttrHooks(ret, 'atkMul');
    return ret;
  }

  override get critRate(): number {
    let ret = 0.05;
    ret = this.runAttrHooks(ret, 'critRate');
    return ret;
  }

  override get critBonus(): number {
    let ret = 1.5;
    ret = this.runAttrHooks(ret, 'critBonus');
    return ret;
  }

  override get leech(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'leech');
    return ret;
  }

  override get def(): number {
    let ret = 0;
    const plastron = this.player?.equipments.plastron;
    const gaiter = this.player?.equipments.gaiter;
    // 来自装备的属性
    if (plastron && !plastron.empty) {
      ret += plastron.def;
    }
    if (gaiter && !gaiter.empty) {
      ret += gaiter.def;
    }
    // 来自力量的属性
    ret += this.str;
    ret = this.runAttrHooks(ret, 'def');
    ret *= this.runAttrHooks(1, 'defAdd');
    ret = this.runAttrHooks(ret, 'defMul');
    return ret;
  }

  override get noDodgeRate(): number {
    let ret = 300 / (300 + this.dex);
    ret = this.runAttrHooks(ret, 'noDodgeRate');
    return ret;
  }

  override get allResist(): number {
    let ret = this.int;
    ret = this.runAttrHooks(ret, 'allResist');
    return ret;
  }

  override get meleeAbsorb(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'meleeAbsorb');
    return ret;
  }

  override get fireAbsorb(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'fireAbsorb');
    return ret;
  }

  override get fireResist(): number {
    let ret = this.allResist;
    ret = this.runAttrHooks(ret, 'fireResist');
    return ret;
  }

  override get darkAbsorb(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'darkAbsorb');
    return ret;
  }

  override get darkResist(): number {
    let ret = this.allResist;
    ret = this.runAttrHooks(ret, 'darkResist');
    return ret;
  }

  override get coldAbsorb(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'coldAbsorb');
    return ret;
  }

  override get coldResist(): number {
    let ret = this.allResist;
    ret = this.runAttrHooks(ret, 'coldResist');
    return ret;
  }

  override get lightningAbsorb(): number {
    let ret = 0;
    ret = this.runAttrHooks(ret, 'lightningAbsorb');
    return ret;
  }

  override get lightningResist(): number {
    let ret = this.allResist;
    ret = this.runAttrHooks(ret, 'lightningResist');
    return ret;
  }

  override get atkSpeed(): number {
    if (!this.player) {
      return 0.01;
    }
    let ret: number;
    const weapon = this.player.equipments.weapon;
    if (weapon && !weapon.empty) {
      ret = weapon.atkSpeed || 0.01;
    } else {
      ret = this.player.roleData.atkSpeed || 0.01;
    }
    ret = this.runAttrHooks(ret, 'atkSpeed');
    ret *= this.runAttrHooks(1, 'atkSpeedAdd');

    return ret;
  }

  override damage(type: string, from: Unit | null, v: number): boolean {
    if (!super.damage(type, from, v)) {
      return false;
    }
    if (type !== 'melee') {
      const tmp = this.runAttrHooks(0, 'rpFromNonPhy');
      this.rp += tmp;
    }
    return true;
  }

  override get skillExpInc(): number {
    let value = 1;
    value = this.runAttrHooks(value, 'skillExpInc');
    value = this.runAttrHooks(value, 'skillExpMul');
    return value;
  }

  override addSkill(type: string): void {
    const state = new SkillState(this.world, this, type);
    state.getLevel = () => this.player?.getSkillLevel(type) ?? 0;
    state.addSkillExp = () => this.player?.addSkillExp(type, this.skillExpInc);
    this.skills.unshift(state);
    this.scheduleSkillEvaluation();
  }

  override get canGetExp(): boolean {
    // 活着才能收经验
    return this.camp === Camps.player;
  }

  override get level(): number {
    return this.player?.level ?? 0;
  }

  override get mf(): number {
    let ret = 1 + (this.player?.peakLevel ?? 0) * 0.03;
    ret = this.runAttrHooks(ret, 'mf');
    return ret;
  }

  override get gf(): number {
    let ret = 1 + (this.player?.peakLevel ?? 0) * 0.03;
    ret = this.runAttrHooks(ret, 'gf');
    return ret;
  }

  override get dmgAdd(): number {
    let ret = 1;
    ret = this.runAttrHooks(ret, 'dmgAdd');
    ret = this.runAttrHooks(ret, 'dmgMul');
    return ret;
  }

  override get expInc(): number {
    let value = 1;
    value *= this.runAttrHooks(1, 'expInc');
    value *= this.runAttrHooks(1, 'expMul');
    return value;
  }

  // ────────────────────────────── 经验 / 升级 / 复活 ──────────────────────────────

  override gotExp(v: number, level: number): void {
    const player = this.player;
    if (!player) {
      return;
    }
    let value = v;
    // 计算击杀回复
    const mpFromKill = this.mpFromKill;
    const hpFromKill = this.hpFromKill;
    this.hp += hpFromKill;
    this.mp += mpFromKill;

    // 根据等级差计算经验值衰减
    const dis = Math.min(this.level, 70) - level;
    if (dis >= 10) {
      return;
    } else if (dis > 0) {
      value *= 1 - dis / 10;
    }
    value *= this.runAttrHooks(1, 'expInc');
    value *= this.runAttrHooks(1, 'expMul');
    this.world.sink.exp({ amount: value, level: player.level, peak: false });

    if (player.level >= player.maxLevel) {
      player.peakExp += value;
      if (player.peakExp >= player.maxPeakExp) {
        this.levelUpPeak();
      }
    } else {
      player.exp += value;
      if (player.exp >= player.maxExp) {
        this.levelUp();
        if (player.level >= player.maxLevel) {
          // 经验累加到巅峰等级上
          player.peakExp += player.exp;
          player.exp = 0;
        }
      }
    }
  }

  levelUp(): void {
    const player = this.player;
    if (!player) {
      return;
    }
    player.exp -= player.maxExp;
    player.level += 1;
    // 被动是否生效取决于等级 → 显式重绑（替代 autorun）。
    this.rebindPassiveHooks();
  }

  levelUpPeak(): void {
    const player = this.player;
    if (!player) {
      return;
    }
    player.peakExp -= player.maxPeakExp;
    player.peakLevel += 1;
  }

  reborn = (): void => {
    this.rebornTimer = null;
    this.rebornTimerStart = null;
    this.camp = Camps.player;
    this.hp = this.maxHp / 5;
    this.mp = this.maxMp / 5;
    this.startRecovery();

    for (const unit of this.world.units) {
      if (unit.target === null && unit.willAttack(this)) {
        unit.setTarget(this);
      }
    }
    this.findTarget();
    this.scheduleSkillEvaluation();
  };

  override kill(): void {
    super.kill();
    this.world.enemyBorn?.onPlayerDeath();
    const rebornIn = 10 + this.level * 0.5;
    // 原版 `message.sendPlayerDeath` 没有对应契约事件，用 general 承载（见差异清单）。
    this.world.sink.general({ text: `player.death:${this.displayName}:${rebornIn}` });

    this.rebornTimerStart = this.logicClock.getTime();
    this.rebornTimer = this.logicClock.setTimeout(this.reborn, rebornIn * 1000);
  }

  canEquip(slot: { goodData?: { type?: string; class?: string } | null; level: number }): boolean {
    const { goodData, level } = slot;
    if (!goodData || goodData.type !== 'equip') {
      return false;
    }
    // 装备需求（等级）检查。
    if (this.level < transformEquipLevel(level)) {
      return false;
    }
    // 职业检查
    if (!this.player?.careerData.availableClasses[goodData.class ?? '']) {
      return false;
    }
    return true;
  }

  override dispose(): void {
    super.dispose();
    PlayerUnit.disposeAll(this.equipmentHookDisposes);
    PlayerUnit.disposeAll(this.passiveHookDisposes);
    PlayerUnit.disposeAll(this.enhanceHookDisposes);
    if (this.rebornTimer) {
      this.logicClock.clearTimeout(this.rebornTimer);
      this.rebornTimer = null;
    }

    this.player?.dispose?.();
    if (this.player) {
      this.player.key = null;
    }
  }

  override dumpState(): Record<string, unknown> {
    const ret = super.dumpState();
    ret.type = 'player';
    if (this.rebornTimer && this.rebornTimerStart !== null) {
      ret.rebornTimer = this.rebornTimerStart + (10 + this.level * 0.5) * 1000 - this.logicClock.getTime();
    }
    return ret;
  }

  useExtraSkill(key: string): void {
    const skillData = this.world.tables.skills[key];
    if (!skillData) {
      return;
    }
    skillData.effect.call(
      new SkillState(this.world, this, key, {}),
      this.world,
      this,
      this.player?.getSkillLevel(key) ?? 0,
    );
  }
}
