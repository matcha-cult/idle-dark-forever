/**
 * WorldStore —— 战斗世界（地图列表 / 单位快照 / 挑战队列 / 战斗日志）。
 *
 * 推送纪律（硬约束）：`(world, tick)` 推送**只存帧**：
 * - 用服务端下发的 `units` 整体替换单位列表（不做插值、不本地推进）；
 * - `events` 原样追加到日志（渲染时才格式化文案）；
 * - `gainedExp` / `gainedGold` 只转给 `PlayerStore` 做增量角标，**不改**任何权威数值。
 */
import { makeAutoObservable, observable, runInAction } from 'mobx';
import {
  BATTLE_CMD,
  WORLD_CMD,
  type BattleEventDto,
  type LootDto,
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

export class WorldStore {
  snapshot: WorldSnapshotDto | null = null;
  units: WorldSnapshotDto['units'] = [];
  maps: WorldSnapshotDto['maps'] = [];
  pendingMaps: WorldSnapshotDto['pendingMaps'] = [];
  updateRate = 0;
  paused = false;
  /** 战斗日志（服务端事件流，最新在前）。 */
  log: BattleLogEntry[] = [];
  loading = false;
  error: string | null = null;

  private readonly guard = new LoadGuard();
  private logSeq = 0;

  constructor(private readonly ctx: StoreContext) {
    makeAutoObservable<this, 'ctx' | 'guard' | 'logSeq'>(
      this,
      {
        ctx: false,
        guard: false,
        logSeq: false,
        units: observable.shallow,
        maps: observable.shallow,
        pendingMaps: observable.shallow,
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

  /** 进入地图（含挑战队列项）。成功后以服务端返回的快照为准并再刷新一次。 */
  async enterMap(map: string, endlessLevel?: number): Promise<boolean> {
    try {
      const result = await this.ctx.api.world.enterMap({
        map,
        ...(endlessLevel === undefined ? {} : { endlessLevel }),
      });
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
      if (tick === undefined || !Array.isArray(tick.units)) return;
      runInAction(() => {
        this.units = tick.units;
        this.log = appendEvents(this.log, tick.events ?? [], tick.serverTime, () => (this.logSeq += 1));
      });
      this.ctx.root().player.noteTickGain(tick.gainedExp ?? 0, tick.gainedGold ?? 0, tick.serverTime);
      return;
    }
    if (notification.cmd === BATTLE_CMD.cmd && notification.subCmd === BATTLE_CMD.log) {
      const payload = notification.data as { serverTime?: number; events?: BattleEventDto[] } | undefined;
      const events = payload?.events;
      if (!Array.isArray(events)) return;
      runInAction(() => {
        this.log = appendEvents(this.log, events, payload?.serverTime ?? Date.now(), () => (this.logSeq += 1));
      });
      return;
    }
    if (notification.cmd === BATTLE_CMD.cmd && notification.subCmd === BATTLE_CMD.loot) {
      const loot = notification.data as LootDto | undefined;
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
  }

  /** 应用世界快照（同时接管单位列表与地图列表）。 */
  private applySnapshot(snapshot: WorldSnapshotDto): void {
    this.snapshot = snapshot;
    this.units = snapshot.units;
    this.maps = snapshot.maps;
    this.pendingMaps = snapshot.pendingMaps;
    this.updateRate = snapshot.updateRate;
    this.paused = snapshot.paused;
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
