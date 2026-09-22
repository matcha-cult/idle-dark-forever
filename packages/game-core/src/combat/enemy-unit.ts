/**
 * 敌人单位（原版 `src/logics/unit.js` 的 `class EnemyUnit`，第 1849–2362 行）。
 *
 * 与原版的对应关系：
 * - `enemies[this.type]` → `world.tables.enemies[this.type]`；
 * - 词缀抽取的 `Math.random()` → `world.rng.affix`（原版第 1876 行）；
 * - `willClean` / `loots` / `gotExp` / `removeUnit` 全部走注入的 `BattleWorld`。
 *
 * ⚠️ 契约 `EnemyData` 只声明了 `maxHp/atk/atkSpeed/exp/level/hpRecovery/...`，
 * 原版实际还会读取 `maxMp/maxRp/maxEp/critRate/def/allResist/fireResist/...` 等字段。
 * 这些字段统一用 `readNumField` 宽松读取（见 `util.ts` 的 `TODO(port-uncertain)`）。
 */

import type { TimerHandle } from '../contracts/ports.js';
import type { EnemyData } from '../contracts/data.js';
import { Camps } from './camps.js';
import { normalizeEnemyQuality } from './enemy-rarity.js';
import type { BattleWorld } from './battle-world.js';
import { SkillState } from './skill-state.js';
import type { Born } from './spawner.js';
import { Unit, type UnitSavedState } from './unit.js';
import { readNumField, transformEquipLevel } from './util.js';

const EMPTY_ENEMY = {} as EnemyData;

/** 原版 `enemyData.buffs` 的元素形状（契约标为 `string[]`，实际是对象数组）。 */
interface EnemyBuffSpec {
  type: string;
  time?: number;
  arg?: unknown;
}

interface EnemySavedState extends UnitSavedState {
  type?: string;
  quality?: number;
  affixes?: string[];
  cleanTimer?: number;
  borner?: number;
  summoner?: number;
  summonSkill?: number;
  /** 野外守关 BOSS 标记（W4）：恢复后仍需可辨识（用于一次性击杀登记）。 */
  worldBoss?: boolean;
  /** 怪物等级覆写（W4）：野外普通/稀有/BOSS 按地图等级生成，恢复后保持同一等级。 */
  levelOverride?: number;
}

export class EnemyUnit extends Unit {
  type: string;
  quality: number;
  affixes: string[] = [];
  /** 刷怪器，用于判断刷怪上限。 */
  borner: Born | null = null;

  /**
   * 野外守关 BOSS 标记（W4，由 `EnemyBorn` 显式置位）。
   *
   * 不用「敌人 key 等于地图 boss」来判定：同一 key（如 `slime.queen`）可能既是某图 BOSS
   * 又是另一图的普通刷怪，key 比较会把普通怪误判成 BOSS。
   */
  worldBoss = false;

  /**
   * 精英怪标记（W11，由 `EnemyBorn.spawnElite` 显式置位）。
   *
   * 精英 = 每 10 波定时刷出的一只 **`quality = 2`** 普通怪（两条词缀 ⇒ `maxHp` / `exp` ×4），
   * 并且**清尸时额外必掉一条通货/精华**（见 `BattleWorld.lootEliteGuaranteed`）。
   *
   * ⚠️ 与 `worldBoss` 一样**不要**用「`quality >= 2`」代替本标记：那是自然刷怪 1% 概率
   * 就能掷到的稀有度（档位 2），而「精英」是**定时保底**，两者语义不同。
   * 展示档位由 `enemyRarityOf()` 统一派生，不要在前端或别处自己拼。
   */
  elite = false;

  /**
   * 等级覆写（W4）。置为有限数时 `level` 直接返回它（野外：普通 = 地图等级 /
   * 稀有 +1 / 精英 +2 / BOSS +2）；未置位时回落到原版公式
   * `enemyData.level + quality * 4`（秘境沿用）。
   */
  levelOverride?: number;

  cleanTimer: TimerHandle | null = null;
  hookRecords: Array<() => void> = [];

  constructor(world: BattleWorld, type: string, quality = 0, savedState?: EnemySavedState | null) {
    super(world, savedState);
    this.type = type;
    // W11：字段级安全化（`Infinity` / `NaN` / 负数 / 超大值 → 0 / 夹到上限）。
    // 不这么做的话，下面的词缀循环会因 `i < Infinity` 一直 push 到
    // `RangeError: Invalid array length`（实测单测挂 14 秒后抛错），
    // 而 `2 ** quality` 也会把 `maxHp` 变成 `Infinity`。
    //
    // ⚠️ 必须**重新赋值给形参**（而不只是 `this.quality`）：下面的词缀循环读的是形参
    // `quality`，只改字段会让 `quality = 99` 时 `affixes.length` 仍是 99 —— 那正是
    // 「字段已安全化、数组却照样撑爆」的假修复。
    quality = normalizeEnemyQuality(quality);
    this.quality = quality;

    const skills = savedState && savedState.skills;

    if (this.enemyData.skills) {
      this.enemyData.skills.forEach(({ key, level }) => {
        this.addSkill(key, level, skills && skills[key]);
      });
    }

    if (savedState && savedState.affixes && savedState.affixes.length === quality) {
      this.affixes = savedState.affixes;
    } else {
      for (let i = 0; i < quality; i++) {
        const affixes = (this.enemyData.affixes ?? {}) as Record<string, number>;
        const keys = Object.keys(affixes);
        const sum = keys.reduce((a, key) => a + affixes[key]!, 0);
        let dice = this.world.rng.affix.next() * sum;
        this.affixes.push(
          keys.find((key) => {
            dice -= affixes[key]!;
            if (dice <= 0) {
              return true;
            }
            return false;
          }) ?? keys[0]!,
        );
      }
    }

    this.hookRecords = [];
    if (this.enemyData.hooks) {
      for (const key in this.enemyData.hooks) {
        this.hookRecords.push(
          this.addAttrHook(key, this.enemyData.hooks[key]!.bind(this, this.world)),
        );
      }
    }

    // test affixes.
    for (const affix of this.affixes) {
      const affixData = this.world.tables.enemyAffixes[affix];
      if (!affixData) {
        continue;
      }
      const { hooks } = affixData;
      for (const key in hooks) {
        this.addAttrHook(key, hooks[key]!.bind(this, this.world));
      }
    }

    if (savedState) {
      this.camp = (savedState.camp as typeof this.camp) ?? this.camp;

      // W4：恢复野外 BOSS 标记与等级覆写（否则读档后 BOSS 击杀不再登记 / 等级回落到旧公式）。
      this.worldBoss = savedState.worldBoss === true;
      if (typeof savedState.levelOverride === 'number' && Number.isFinite(savedState.levelOverride)) {
        this.levelOverride = savedState.levelOverride;
      }

      if (savedState.cleanTimer) {
        this.logicClock.setTimeout(this.clean, savedState.cleanTimer);
      } else if (this.camp === 'ghost') {
        this.logicClock.setTimeout(this.clean, 3000);
      }
      if (typeof savedState.borner === 'number') {
        this.borner = this.world.enemyBorn?.borns?.[savedState.borner] ?? null;
      }

      if (this.borner) {
        this.borner.count++;
        // W12：不再在这里 `testTimer()` 取消定时器 —— 上限改由 `Born.onTimer` 按
        // 「全图存活敌对怪总数」判定，且被挡住时需**保持轮询**（召唤物死亡后自动恢复）。
      }
      if (savedState.buffs) {
        for (const buff of savedState.buffs) {
          // 这里不检查 buff 叠加情况
          if (buff && this.world.tables.buffs[buff.type]) {
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
        if (skill) {
          const castTime = savedState.castingTimer ?? 0;
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
      this.camp = (this.enemyData.camp as typeof this.camp) ?? Camps.ghost;

      if (this.enemyData.buffs) {
        for (const buff of this.enemyData.buffs as unknown as EnemyBuffSpec[]) {
          this.addBuff(buff.type, buff.time, buff.arg);
        }
      }

      this.hp = this.maxHp;
      this.mp = this.maxMp;
      this.ep = this.maxEp;
    }

    this.setAttackCoolDown();

    this.startRecovery();
    this.refreshSpeedRate();
  }

  /** 变形成另一种生物。 */
  transformType(type: string): void {
    this.type = type;
    for (const skill of this.skills.splice(0)) {
      skill.dispose();
    }
    for (const hook of this.hookRecords.splice(0)) {
      hook();
    }
    for (const buff of this.buffs.slice(0)) {
      if (!buff.buffData.notRemoveWhenTransform) {
        this.removeBuff(buff);
      }
    }
    (this.enemyData.skills ?? []).forEach(({ key, level }) => {
      this.addSkill(key, level);
    });
    if (this.enemyData.hooks) {
      for (const key in this.enemyData.hooks) {
        this.hookRecords.push(
          this.addAttrHook(key, this.enemyData.hooks[key]!.bind(this, this.world)),
        );
      }
    }
    if (this.enemyData.buffs) {
      for (const buff of this.enemyData.buffs as unknown as EnemyBuffSpec[]) {
        this.addBuff(buff.type, buff.time, buff.arg);
      }
    }
    this.camp = (this.enemyData.camp as typeof this.camp) ?? this.camp;
    this.findTarget();
    this.world.units.forEach((v) => {
      if (v.target === null && v.willAttack(this)) {
        v.setTarget(this);
      }
    });
    this.setAttackCoolDown();
    this.refreshSpeedRate();
  }

  get enemyData(): EnemyData {
    return this.world.tables.enemies[this.type] ?? EMPTY_ENEMY;
  }

  override get name(): string {
    return this.enemyData.name || '';
  }

  override get displayName(): string {
    const temp = this.affixes.map((v) => this.world.tables.enemyAffixes[v]?.name ?? v);
    temp.push(this.name);
    return this.runAttrHooks(temp.join(''), 'displayName');
  }

  override get maxHp(): number {
    let ret = this.enemyData.maxHp;
    ret = this.runAttrHooks(ret, 'maxHp');
    // 品质提升 100% 生命值
    ret *= 2 ** this.quality;
    ret = this.runAttrHooks(ret, 'maxHpMul');
    return ret;
  }

  override get maxMp(): number {
    return readNumField(this.enemyData, 'maxMp', 0);
  }

  override get mpRecovery(): number {
    return readNumField(this.enemyData, 'mpRecovery', 0);
  }

  override get maxRp(): number {
    return readNumField(this.enemyData, 'maxRp', 0);
  }

  override get rpRecovery(): number {
    return readNumField(this.enemyData, 'rpRecovery', -1);
  }

  override get maxEp(): number {
    return readNumField(this.enemyData, 'maxEp', 0);
  }

  override get epRecovery(): number {
    return readNumField(this.enemyData, 'epRecovery', -1);
  }

  override get rpOnAttack(): number {
    return readNumField(this.enemyData, 'rpOnAttack', 0);
  }

  override get rpOnAttacked(): number {
    return readNumField(this.enemyData, 'rpOnAttacked', 0);
  }

  override get atkSpeed(): number {
    let ret = this.enemyData.atkSpeed || 0;
    ret = this.runAttrHooks(ret, 'atkSpeed');
    ret = this.runAttrHooks(ret, 'atkSpeedMul');
    return ret;
  }

  override get hpRecovery(): number {
    let ret = this.enemyData.hpRecovery || 0;
    ret = this.runAttrHooks(ret, 'hpRecovery');
    return ret;
  }

  override get atk(): number {
    let ret = this.enemyData.atk || 0;
    ret = this.runAttrHooks(ret, 'atk');
    ret *= this.runAttrHooks(1, 'atkAdd');
    ret *= this.runAttrHooks(1, 'atkMulAttr');
    ret = this.runAttrHooks(ret, 'atkMul');
    return ret;
  }

  override get critRate(): number {
    let ret = readNumField(this.enemyData, 'critRate', 0);
    ret = this.runAttrHooks(ret, 'critRate');
    return ret;
  }

  override get critBonus(): number {
    let ret = readNumField(this.enemyData, 'critBonus', 1.5) || 1.5;
    ret = this.runAttrHooks(ret, 'critBonus');
    return ret;
  }

  override get leech(): number {
    let ret = readNumField(this.enemyData, 'leech', 0);
    ret = this.runAttrHooks(ret, 'leech');
    return ret;
  }

  override get def(): number {
    let ret = readNumField(this.enemyData, 'def', 0);
    ret = this.runAttrHooks(ret, 'def');
    ret = this.runAttrHooks(ret, 'defMul');
    ret *= this.runAttrHooks(1, 'defAdd');
    return ret;
  }

  override get fireAbsorb(): number {
    let ret = readNumField(this.enemyData, 'fireAbsorb', 0);
    ret = this.runAttrHooks(ret, 'fireAbsorb');
    return ret;
  }

  override get fireResist(): number {
    let ret = readNumField(this.enemyData, 'fireResist', 0);
    ret += readNumField(this.enemyData, 'allResist', 0);
    ret = this.runAttrHooks(ret, 'fireResist');
    return ret;
  }

  override get chaosAbsorb(): number {
    let ret = readNumField(this.enemyData, 'chaosAbsorb', 0);
    ret = this.runAttrHooks(ret, 'chaosAbsorb');
    return ret;
  }

  override get chaosResist(): number {
    let ret = readNumField(this.enemyData, 'chaosResist', 0);
    ret += readNumField(this.enemyData, 'allResist', 0);
    ret = this.runAttrHooks(ret, 'chaosResist');
    return ret;
  }

  override get coldAbsorb(): number {
    let ret = readNumField(this.enemyData, 'coldAbsorb', 0);
    ret = this.runAttrHooks(ret, 'coldAbsorb');
    return ret;
  }

  override get coldResist(): number {
    let ret = readNumField(this.enemyData, 'coldResist', 0);
    ret += readNumField(this.enemyData, 'allResist', 0);
    ret = this.runAttrHooks(ret, 'coldResist');
    return ret;
  }

  override get lightningAbsorb(): number {
    let ret = readNumField(this.enemyData, 'lightningAbsorb', 0);
    ret = this.runAttrHooks(ret, 'lightningAbsorb');
    return ret;
  }

  override get lightningResist(): number {
    let ret = readNumField(this.enemyData, 'lightningResist', 0);
    ret += readNumField(this.enemyData, 'allResist', 0);
    ret = this.runAttrHooks(ret, 'lightningResist');
    return ret;
  }

  get exp(): number {
    let ret = (this.enemyData.exp || 0) * 2 ** this.quality;
    return ret;
  }

  override get level(): number {
    // W4 野外：普通 = 地图等级 / 稀有 +1 / BOSS +2（由 BattleWorld.addEnemy 置位覆写）。
    if (typeof this.levelOverride === 'number' && Number.isFinite(this.levelOverride)) {
      return this.levelOverride;
    }
    // 每个词缀视作提升了 4 怪物等级
    let ret = (this.enemyData.level || 0) + this.quality * 4;
    return ret;
  }

  override get dmgAdd(): number {
    let ret = readNumField(this.enemyData, 'dmgAdd', 1) || 1;
    ret = this.runAttrHooks(ret, 'dmgAdd');
    ret = this.runAttrHooks(ret, 'dmgMul');
    return ret;
  }

  override get speedRate(): number {
    let ret = readNumField(this.enemyData, 'speedRate', 1) || 1;
    ret = this.runAttrHooks(ret, 'speedRate');
    ret = this.runAttrHooks(ret, 'speedRateMul');
    return ret;
  }

  override get stunResist(): number {
    const realLevel = transformEquipLevel(this.level);
    return this.runAttrHooks(readNumField(this.enemyData, 'stunResist', 0) || realLevel * 10, 'stunResist');
  }

  override addSkill(type: string, level?: number, saved?: { coolDown?: number } | null): void {
    const state = new SkillState(this.world, this, type, saved);
    state.getLevel = () => level ?? 0;
    this.skills.unshift(state);
    this.scheduleSkillEvaluation();
  }

  override kill(shouldWait = true): void {
    if (this.runAttrHooks(1, 'willClean', this, this.world)) {
      this.setCleanTimer(shouldWait ? 3000 : 0);
    }

    // 事件里的 camp 取「死亡前」的阵营；`super.kill()` 会把它改成 ghost。
    const campBefore = this.camp;
    super.kill();

    if (this.summoner) {
      this.summoner.runAttrHooks(this, 'onSummonDeath');
    }

    this.world.sink.death({ unitId: this.id, name: this.displayName, camp: campBefore });
    if (this.exp) {
      // W10：经验**不再做等级差衰减**（唯一实现在 `PlayerUnit.gotExp`，那段窗口已删除）。
      // 这里仍传怪物真实等级（含 W4 的 `levelOverride`），只是为了保住
      // `world.gotExp(exp, level)` 的冻结端口契约；当前该参数不参与计算。
      // `transformEquipLevel` 只用于装备等级口径（如 `stunResist`），不要拿来做经验判定。
      this.world.gotExp(this.exp, this.level);
    }

    // W4：一次性野外 BOSS —— 死亡即登记到角色（幂等），从而解锁下一段。
    // 放在 `kill()`（死亡唯一入口）而不是 `clean()`：清尸定时器可能因换图 / 离线而不再触发。
    // W6：混沌图的守关 BOSS **可重复刷**，只登记本 run 的 `chaosOutcome`，**不写** `worldBossKilled`。
    if (this.worldBoss) {
      if (this.world.isChaosMap) {
        this.world.noteChaosBossKilled();
      } else {
        // W11 / 决策 2：**首通**清算 `map.exp`。必须先读 `hasWorldBossKilled` 再登记，
        // 否则第二次击杀（理论上不该发生，但重连 / 补刷路径下要防御）会重复发奖。
        const firstClear = this.world.player?.hasWorldBossKilled?.(this.world.map) !== true;
        this.world.player?.markWorldBossKilled?.(this.world.map);
        if (firstClear) {
          this.world.grantWorldClearReward();
        }
        // W11 / 决策 3：**通关后自动重新进入当前图**（波数归 0 → 转挂机节拍）。
        // 这里只置位；服务端 tick 会**等本 BOSS 清尸**（掉落结算）后才落实
        // —— 提前重开会 `dispose()` 掉清尸计时器、吞掉 BOSS 掉落。
        this.world.noteWorldCleared();
      }
    }
  }

  clean = (): void => {
    if (this.enemyData.loots) {
      this.world.loots(this.enemyData.loots, this.level, this.quality);
      // TODO: 包裹已满丢弃物品
      // W11 / 决策 3：精英**必掉**一条通货/精华（`quality` 对掉落已无影响，必须显式补）。
      if (this.elite) {
        this.world.lootEliteGuaranteed(this.enemyData.loots, this.level, this.quality);
      }
    }
    // W5：85+ 区域掉落混沌钥石（与掉落表无关，独立判定；只用 W4 覆写后的 `this.level`）。
    this.world.rollKeystoneDrop(this.level);
    this.world.onEnemyKilled(this.type, 1);
    this.world.removeUnit(this);
  };

  setCleanTimer(time = 3000): void {
    if (!this.cleanTimer) {
      this.cleanTimerStart = this.logicClock.getTime();
      this.cleanTimer = this.logicClock.setTimeout(this.clean, time);
    }
  }

  override setTarget(target: Unit | null): void {
    super.setTarget(target);
    if (this.enemyData.camp === Camps.neutral) {
      this.camp = target ? Camps.enemy : Camps.neutral;
    }
  }

  override dispose(): void {
    super.dispose();
    if (this.cleanTimer) {
      this.logicClock.clearTimeout(this.cleanTimer);
      this.cleanTimer = null;
    }

    if (this.borner) {
      this.borner.onEnemyKilled();
    }
  }

  override dumpState(): Record<string, unknown> {
    const ret = super.dumpState();
    ret.type = this.type;
    ret.quality = this.quality;
    ret.affixes = this.affixes.slice();
    if (this.worldBoss) {
      ret.worldBoss = true;
    }
    if (typeof this.levelOverride === 'number' && Number.isFinite(this.levelOverride)) {
      ret.levelOverride = this.levelOverride;
    }
    if (this.cleanTimer) {
      ret.cleanTimer = this.cleanTimerStart !== null ? this.cleanTimerStart - this.logicClock.getTime() : undefined;
    }
    if (this.borner) {
      const borns = this.world.enemyBorn?.borns ?? null;
      if (borns && borns.indexOf(this.borner) >= 0) {
        ret.borner = borns.indexOf(this.borner);
      }
    }
    if (this.summoner) {
      const summoner = this.world.units.indexOf(this.summoner);
      if (summoner > -1) {
        ret.summoner = summoner;
        if (this.summonSkill) {
          const skill = this.summoner.skills.indexOf(this.summonSkill);
          if (skill > -1) {
            ret.summonSkill = skill;
          }
        }
      }
    }
    return ret;
  }

  /** `dumpState` 需要的 clean 计时起点（`TimerHandle` 契约不含 `at`）。 */
  cleanTimerStart: number | null = null;
}
