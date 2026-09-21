/**
 * WorldStore —— 战斗世界（地图列表 / 单位状态 / 战斗日志 / 掉落提示）。
 *
 * 推送纪律（硬约束）：`(world, tick)` 推送**只存帧**，不做任何本地推进：
 * - P2 起状态走 `patch`（**有序**的单位补丁流）：`reset` 重建、`add` 新增、
 *   `chg` 只带变化字段、`del` 移除（= 清尸，不是死亡；死亡是 `alive:false`）；
 * - `log` 原样追加到日志（渲染时才格式化文案）；`loot` 只弹提示 + 刷新背包；
 * - `gainedExp` / `gainedGold` 只转给 `PlayerStore` 做增量角标，**不改**任何权威数值；
 * - 服务端**无变化时不推送**，因此「长时间没有帧」是正常状态，不是卡死；
 * - 若收到指向未知单位的 `chg`（说明基线不一致），主动重拉一次快照自愈。
 */
import { makeAutoObservable, observable, runInAction } from 'mobx';
import {
  BATTLE_CMD,
  WORLD_CMD,
  type BattleEventDto,
  type LootDto,
  type UnitPatchOpDto,
  type UnitStateDto,
  type WorldSnapshotDto,
  type WorldTickDto,
} from '@idle-dark/protocol';
import { LoadGuard } from './load-guard.js';
import { toastFailure } from '../services/game-client.js';
import type { StoreContext } from './store-context.js';

/** 一条战斗日志（服务端事件 + 本地序号，序号只用于 React key）。 */
export interface BattleLogEntry {
  seq: number;
  serverTime: number;
  event: BattleEventDto;
}

/** 日志保留上限（避免长时间挂机把内存吃满）。 */
const MAX_LOG_ENTRIES = 200;

/**
 * `单位 id → 显示名` 注册表的上限。
 *
 * ⚠️ 这张表必须**比单位本身活得久**：日志保留 200 条（可能跨越数十次清尸），
 * 而单位死亡后 3s 就会被清出单位表。若渲染时只查「当前单位」，历史行就会退化成
 * 原始 id（实测 39% 的引用查不到名字）。
 */
const MAX_UNIT_NAMES = 512;

/** 守关 BOSS 刷新间隔的兜底（服务端 `bossEvery` 缺失 / 非法时使用）。 */
export const DEFAULT_BOSS_EVERY = 20;

/**
 * 该阵营是否**允许被玩家点选为攻击目标**。
 *
 * 原版 `CampRelation.player.neutral === true`（可攻击但不自动选为目标）——
 * 即黄名中立怪不主动打你、也不会被溅射命中，但**可以**被指定集火，
 * 一旦被攻击就 `enemy-unit` 把 `camp` 翻成 `enemy` 开始反击。
 * 幽灵 / 剧情 / 神龛 / 友军一律不可选。
 */
export function isAttackableCamp(camp: string): boolean {
  return camp === 'enemy' || camp === 'neutral';
}

/**
 * 单位是否已阵亡（唯一入口：不要在组件里各写一份）。
 *
 * ⚠️ 引擎里**死亡不等于移除**：`Unit.kill()` 只把 `camp` 翻成 `ghost`，
 * `EnemyUnit.clean()` 才真正移除（默认 3s 后）。所以尸体仍会留在单位表里，
 * 必须靠 `alive` 判定，而不是「从表里消失」。
 * `alive` 缺失（旧服务端 / 旧帧）时才回落：`camp === 'ghost'` **或** `hp <= 0`
 * （两者取或 —— 任何一条成立都按死亡渲染，宁可多判死也不要把尸体画成活的）。
 */
export function isDead(unit: Pick<UnitStateDto, 'alive' | 'camp' | 'hp'>): boolean {
  if (typeof unit.alive === 'boolean') return !unit.alive;
  return unit.camp === 'ghost' || unit.hp <= 0;
}

export class WorldStore {
  snapshot: WorldSnapshotDto | null = null;
  units: WorldSnapshotDto['units'] = [];
  maps: WorldSnapshotDto['maps'] = [];
  updateRate = 0;
  paused = false;
  /** 战斗日志（服务端事件流，最新在前）。 */
  log: BattleLogEntry[] = [];
  loading = false;
  error: string | null = null;

  /** 服务端下发的当前波数（observable 源；对外经只读 `wave` getter 暴露）。 */
  private waveValue = 0;
  /** 服务端下发的守关 BOSS 刷新间隔（observable 源；对外经只读 `bossEvery` getter）。 */
  private bossEveryValue = DEFAULT_BOSS_EVERY;

  private readonly guard = new LoadGuard();
  private logSeq = 0;
  /** 单位表（`id → 状态`）。对外仍以 `units` 数组暴露，避免下游大面积改动。 */
  private readonly unitMap = new Map<string, UnitStateDto>();
  /** 自愈重拉是否在进行中（避免基线不一致时反复重拉）。 */
  private resyncPending = false;
  /**
   * `单位 id → 显示名` 的**历史注册表**（只增不减，超出上限按插入序淘汰最旧）。
   *
   * 用途：日志是「历史」，单位表是「当下」——用当下查历史必然有名字缺失。
   * 名字是服务端下发的**不可变标识**（`add`/`reset`/快照里都有），这里只做缓存，
   * 不做任何推导。
   */
  private readonly unitNames = new Map<string, string>();

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard' | 'logSeq' | 'unitMap' | 'unitNames' | 'resyncPending'>(
      this,
      {
        ctx: false,
        guard: false,
        logSeq: false,
        unitMap: false,
        unitNames: false,
        resyncPending: false,
        units: observable.shallow,
        maps: observable.shallow,
        log: observable.shallow,
      },
      { autoBind: true },
    );
  }

  /** 我方单位（服务端 `camp` 字段的只读筛选，不是数值推导）。 */
  get allies(): WorldSnapshotDto['units'] {
    return this.units.filter((unit) => unit.camp === 'player' || unit.camp === 'ally');
  }

  /** 敌方单位（会自动攻击玩家）。 */
  get enemies(): WorldSnapshotDto['units'] {
    return this.units.filter((unit) => unit.camp === 'enemy');
  }

  /** 中立单位（黄名：不会主动攻击，但**可以被点选攻击**）。 */
  get neutrals(): WorldSnapshotDto['units'] {
    return this.units.filter((unit) => unit.camp === 'neutral');
  }

  /**
   * 可被指定为攻击目标的单位 = 敌方 + 中立。
   *
   * ⚠️ 为什么必须含中立：原版设定明确「黄色名字的魔物不会主动攻击英雄们，
   * 溅射和群体伤害也不会攻击他们。但如果英雄主动攻击他们，他们就会加入战斗」。
   * 早期前端只列 `camp === 'enemy'`，中立怪既看不到也点不动。
   */
  get attackables(): WorldSnapshotDto['units'] {
    return this.units.filter((unit) => isAttackableCamp(unit.camp));
  }

  get currentMap(): string {
    return this.snapshot?.map ?? this.ctx.root().player.map;
  }

  /** 当前已完成的波数（服务端权威）。 */
  get wave(): number {
    return this.waveValue;
  }

  /** 守关 BOSS 刷新间隔（波；服务端缺失 / 非法时缺省 20）。 */
  get bossEvery(): number {
    const n = this.bossEveryValue;
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_BOSS_EVERY;
  }

  /**
   * 距下一个守关 BOSS 还有多少波。
   *
   * 刚刷新过 BOSS（`wave % bossEvery === 0`）时按**一整轮**算，即 0 波显示「距 BOSS 20 波」。
   */
  get wavesToBoss(): number {
    return this.bossEvery - (this.wave % this.bossEvery);
  }

  /** 当前是否正好是守关 BOSS 波（0 波不算）。 */
  get bossWave(): boolean {
    return this.wave > 0 && this.wave % this.bossEvery === 0;
  }

  /** 拉取世界快照。 */
  async load(): Promise<void> {
    const token = this.guard.next();
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    try {
      const result = await this.ctx.api.world.snapshot();
      if (!this.guard.isCurrent(token)) return;
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '世界快照加载失败');
        return;
      }
      const data = result.data;
      if (data === undefined) throw new Error('世界快照响应缺少 data');
      runInAction(() => {
        this.applySnapshot(data);
      });
    } catch (error) {
      if (!this.guard.isCurrent(token)) return;
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      this.ctx.toast.fromError(error, '世界快照加载失败');
    } finally {
      if (this.guard.isCurrent(token)) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  /** 进入地图。成功后以服务端返回的快照为准并再刷新一次。 */
  async enterMap(map: string): Promise<boolean> {
    try {
      const result = await this.ctx.api.world.enterMap({ map });
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '进入地图失败');
        return false;
      }
      if (result.data !== undefined) {
        runInAction(() => {
          this.applySnapshot(result.data as WorldSnapshotDto);
        });
      }
      await this.load();
      return true;
    } catch (error) {
      this.ctx.toast.fromError(error, '进入地图失败');
      return false;
    }
  }

  /** 离开当前地图。 */
  async leave(): Promise<boolean> {
    try {
      const result = await this.ctx.api.world.leave();
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '离开地图失败');
        return false;
      }
      await this.load();
      return true;
    } catch (error) {
      this.ctx.toast.fromError(error, '离开地图失败');
      return false;
    }
  }

  /** 放弃离线收益（原版「跳过」按钮）。 */
  async skipOffline(): Promise<boolean> {
    try {
      const result = await this.ctx.api.world.skipOffline();
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '跳过离线收益失败');
        return false;
      }
      await this.ctx.root().player.load();
      return true;
    } catch (error) {
      this.ctx.toast.fromError(error, '跳过离线收益失败');
      return false;
    }
  }

  /** 切换攻击目标（服务端判定合法性；`targetId: null` 表示取消目标）。 */
  async focus(targetId: string | null): Promise<void> {
    try {
      const result = await this.ctx.api.battle.focus({ targetId });
      if (result.success === false) {
        toastFailure(this.ctx.toast, result, '切换目标失败');
      }
    } catch (error) {
      this.ctx.toast.fromError(error, '切换目标失败');
    }
  }

  /**
   * 单位 id → 显示名（日志渲染用）。
   *
   * 查不到时回落**原始 id**（不猜、不省略），这样缺名字是可见的而不是静默变成空串。
   */
  nameOf(id: string): string {
    return this.unitNames.get(id) ?? id;
  }

  /** 清空本地战斗日志（纯展示态）。 */
  clearLog(): void {
    runInAction(() => {
      this.log = [];
    });
  }

  /**
   * 推送入口：**只存帧**，不做任何本地推进。
   * - `(world, tick)`：整体替换单位、追加事件、转发增量角标；
   * - `(battle, log)`：追加战斗日志；
   * - `(battle, loot)`：一次性提示 + 刷新背包（掉落已被服务端写库）。
   */
  handleNotification(frame: unknown): void {
    const notification = frame as { cmd?: number; subCmd?: number; data?: unknown };
    if (notification.cmd === WORLD_CMD.cmd && notification.subCmd === WORLD_CMD.tick) {
      const tick = notification.data as WorldTickDto | undefined;
      if (tick === undefined) return;
      const serverTime = typeof tick.serverTime === 'number' ? tick.serverTime : 0;
      runInAction(() => {
        if (Array.isArray(tick.patch)) this.applyPatch(tick.patch);
        if (Array.isArray(tick.log)) {
          this.log = appendEvents(this.log, tick.log, serverTime, () => (this.logSeq += 1));
        }
        this.applyWave(tick.wave, tick.bossEvery);
      });
      if (Array.isArray(tick.loot)) {
        for (const loot of tick.loot) this.applyLoot(loot);
      }
      this.ctx.root().player.noteTickGain(tick.gainedExp ?? 0, tick.gainedGold ?? 0, serverTime);
      return;
    }
    // 以下两条是 P2 之前的旧推送路由：服务端已并帧，保留仅为兼容回滚期的旧服务端。
    if (notification.cmd === BATTLE_CMD.cmd && notification.subCmd === BATTLE_CMD.log) {
      const payload = notification.data as { serverTime?: number; events?: BattleEventDto[] } | undefined;
      const events = payload?.events;
      if (!Array.isArray(events)) return;
      const serverTime = typeof payload?.serverTime === 'number' ? payload.serverTime : 0;
      runInAction(() => {
        this.log = appendEvents(this.log, events, serverTime, () => (this.logSeq += 1));
      });
      return;
    }
    if (notification.cmd === BATTLE_CMD.cmd && notification.subCmd === BATTLE_CMD.loot) {
      this.applyLoot(notification.data as LootDto | undefined);
    }
  }

  /**
   * 按序应用一帧单位补丁。
   *
   * ⚠️ **必须按序**：`add` 之后可能紧跟同一 id 的 `chg`/`del`（服务端同批次合并过的帧）。
   * ⚠️ 指向未知 id 的 `chg` 说明基线不一致（快照与差分错位）——此时**不能静默丢弃**，
   * 主动重拉一次快照自愈（I3：不允许静默降级）。
   */
  private applyPatch(patch: readonly UnitPatchOpDto[]): void {
    let desynced = false;
    for (const op of patch) {
      if (op.op === 'reset') {
        this.unitMap.clear();
        for (const unit of op.units ?? []) {
          this.unitMap.set(unit.id, unit);
          this.rememberUnitName(unit);
        }
        continue;
      }
      if (op.op === 'add') {
        if (op.unit !== undefined && typeof op.unit.id === 'string') {
          this.unitMap.set(op.unit.id, op.unit);
          this.rememberUnitName(op.unit);
        }
        continue;
      }
      if (op.op === 'del') {
        this.unitMap.delete(op.id);
        continue;
      }
      const existing = this.unitMap.get(op.id);
      if (existing === undefined) {
        desynced = true;
        continue;
      }
      this.unitMap.set(op.id, { ...existing, ...op.fields });
    }
    this.units = [...this.unitMap.values()];
    if (desynced && !this.resyncPending) {
      this.resyncPending = true;
      void this.load().finally(() => {
        runInAction(() => {
          this.resyncPending = false;
        });
      });
    }
  }

  /** 记入名字注册表（幂等；超出上限淘汰最旧，保证长时间挂机内存有界）。 */
  private rememberUnitName(unit: { id?: unknown; name?: unknown }): void {
    const id = unit?.id;
    const name = unit?.name;
    if (typeof id !== 'string' || id === '' || typeof name !== 'string' || name === '') return;
    if (this.unitNames.has(id)) return;
    this.unitNames.set(id, name);
    while (this.unitNames.size > MAX_UNIT_NAMES) {
      const oldest = this.unitNames.keys().next();
      if (oldest.done === true) break;
      this.unitNames.delete(oldest.value);
    }
  }

  /** 掉落提示（`loot` 分区与旧的 `(battle, loot)` 路由共用）。 */
  private applyLoot(loot: LootDto | undefined): void {
    if (loot?.slot === undefined) return;
    if (loot.handled === 'pickup') this.ctx.toast.info('获得战利品', loot.slot.name);
    else if (loot.handled === 'sell') this.ctx.toast.info('自动出售', `${loot.slot.name} +${loot.gold ?? 0} 金币`);
    else if (loot.handled === 'lost') {
      // 包裹已满：服务端已丢弃，这里如实提示（不再谎报「获得战利品」）。
      const count = loot.slot.count > 1 ? ` ×${loot.slot.count}` : '';
      this.ctx.toast.error('包裹已满', `丢弃了 ${loot.slot.name}${count}`);
      return;
    } else this.ctx.toast.info('自动分解', loot.slot.name);
    void this.ctx.root().inventory.load();
  }

  /** 应用世界快照（同时接管单位列表与地图列表）。 */
  private applySnapshot(snapshot: WorldSnapshotDto): void {
    this.snapshot = snapshot;
    // 快照 = 差分基线：重建单位表，后续补丁都相对它。
    this.unitMap.clear();
    for (const unit of snapshot.units ?? []) {
      this.unitMap.set(unit.id, unit);
      this.rememberUnitName(unit);
    }
    this.units = [...this.unitMap.values()];
    this.maps = snapshot.maps;
    this.updateRate = snapshot.updateRate;
    this.paused = snapshot.paused;
    this.applyWave(snapshot.wave, snapshot.bossEvery);
  }

  /**
   * 应用服务端下发的波次状态（tick / snapshot 共用）。
   *
   * 只做**防御性校验**，不做任何数值推导：非法值保留上一份权威值。
   */
  private applyWave(wave: unknown, bossEvery: unknown): void {
    if (typeof wave === 'number' && Number.isFinite(wave) && wave >= 0) {
      this.waveValue = Math.trunc(wave);
    }
    if (typeof bossEvery === 'number' && Number.isFinite(bossEvery) && bossEvery > 0) {
      this.bossEveryValue = Math.trunc(bossEvery);
    }
  }
}

/** 新事件插到队首，并裁剪到上限（纯函数，便于单测）。 */
export function appendEvents(
  existing: readonly BattleLogEntry[],
  events: readonly BattleEventDto[],
  serverTime: number,
  nextSeq: () => number,
): BattleLogEntry[] {
  if (events.length === 0) return existing as BattleLogEntry[];
  const appended = events.map((event) => ({ seq: nextSeq(), serverTime, event }));
  // 最新在最前：本批次事件按发生顺序反序插入，避免日志倒着读。
  return [...appended.reverse(), ...existing].slice(0, MAX_LOG_ENTRIES);
}
