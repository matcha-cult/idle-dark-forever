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
  WORLD_CMD,
  type BattleEventDto,
  type WorldSnapshotDto,
  type WorldTickDto,
} from '@idle-dark/protocol';
import { LoadGuard } from './load-guard.js';
import type { StoreContext } from './store-context.js';

/** 一条战斗日志（服务端事件 + 本地序号，序号只用于 React key）。 */
export interface BattleLogEntry {
  seq: number;
  serverTime: number;
  event: BattleEventDto;
}

/** 日志保留上限（避免长时间挂机把内存吃满）。 */
const MAX_LOG_ENTRIES = 200;

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

  /** 敌方单位。 */
  get enemies(): WorldSnapshotDto['units'] {
    return this.units.filter((unit) => unit.camp === 'enemy');
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
        const code = typeof result.data?.code === 'string' ? result.data.code : undefined;
        const message = typeof result.message === 'string' ? result.message : undefined;
        this.ctx.toast.fromFailure(code, message, '世界快照加载失败');
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

  /** 进入地图（含挑战队列项）。成功后刷新快照。 */
  async enterMap(map: string, endlessLevel?: number): Promise<boolean> {
    try {
      const result = await this.ctx.api.world.enterMap({
        map,
        ...(endlessLevel === undefined ? {} : { endlessLevel }),
      });
      if (result.success === false) {
        const code = typeof result.data?.code === 'string' ? result.data.code : undefined;
        const message = typeof result.message === 'string' ? result.message : undefined;
        this.ctx.toast.fromFailure(code, message, '进入地图失败');
        return false;
      }
      if (result.data?.snapshot !== undefined) {
        runInAction(() => {
          this.applySnapshot(result.data!.snapshot!);
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
        const code = typeof result.data?.code === 'string' ? result.data.code : undefined;
        const message = typeof result.message === 'string' ? result.message : undefined;
        this.ctx.toast.fromFailure(code, message, '离开地图失败');
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
        const code = typeof result.data?.code === 'string' ? result.data.code : undefined;
        const message = typeof result.message === 'string' ? result.message : undefined;
        this.ctx.toast.fromFailure(code, message, '跳过离线收益失败');
        return false;
      }
      await this.ctx.root().player.load();
      return true;
    } catch (error) {
      this.ctx.toast.fromError(error, '跳过离线收益失败');
      return false;
    }
  }

  /** 切换攻击目标（服务端判定合法性）。 */
  async focus(unitId: string, targetId: string | null): Promise<void> {
    try {
      const result = await this.ctx.api.battle.focus({ unitId, targetId });
      if (result.success === false) {
        const code = typeof result.data?.code === 'string' ? result.data.code : undefined;
        const message = typeof result.message === 'string' ? result.message : undefined;
        this.ctx.toast.fromFailure(code, message, '切换目标失败');
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
   * 推送入口：`(world, tick)`。
   * **只存帧**：整体替换单位、追加事件、转发增量角标；不做任何本地推进。
   */
  handleNotification(frame: unknown): void {
    const notification = frame as { cmd?: number; subCmd?: number; data?: unknown };
    if (notification.cmd !== WORLD_CMD.cmd || notification.subCmd !== WORLD_CMD.tick) return;
    const tick = notification.data as WorldTickDto | undefined;
    if (tick === undefined || !Array.isArray(tick.units)) return;

    runInAction(() => {
      this.units = tick.units;
      const appended = appendEvents(this.log, tick.events ?? [], tick.serverTime, () => (this.logSeq += 1));
      this.log = appended;
    });
    this.ctx.root().player.noteTickGain(tick.gainedExp ?? 0, tick.gainedGold ?? 0, tick.serverTime);
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
