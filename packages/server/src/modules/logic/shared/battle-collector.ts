/**
 * 战斗事件采集器（`BattleSink` 实现）
 *
 * **推送风暴防线**：战斗内核每次伤害都会 `sink.damage(...)`，绝不逐条推送。
 * 采集器只做内存累积，由调用方（world tick / 离线结算）按帧或按报告 drain。
 */
import type {
  BattleSink,
  BuffEvent,
  DamageEvent,
  DeathEvent,
  DodgeEvent,
  ExpEvent,
  GeneralEvent,
  HealEvent,
  LootEvent,
} from '@idle-dark/game-core';
import type { BattleEventDto, Quality } from '@idle-dark/protocol';

export interface CollectedLoot {
  key: string;
  count: number;
  quality: number;
  handled: 'pickup' | 'sell' | 'decompose';
  gold: number;
  materials?: Array<{ key: string; count: number }>;
}

export interface CollectedFrame {
  events: BattleEventDto[];
  gainedExp: number;
  gainedGold: number;
  kills: number;
}

/** 采集 + 聚合。单实例非线程安全（Node 单线程，无妨）。 */
export class BattleCollector implements BattleSink {
  private events: BattleEventDto[] = [];
  private gainedExp = 0;
  private gainedGold = 0;
  private kills = 0;
  private readonly loots = new Map<string, CollectedLoot>();
  private readonly materials = new Map<string, number>();

  damage(e: DamageEvent): void {
    this.events.push({
      kind: 'damage',
      fromId: e.fromId,
      toId: e.toId,
      damageType: e.damageType,
      skill: e.skill,
      ...(typeof e.skillName === 'string' && e.skillName !== '' ? { skillName: e.skillName } : {}),
      value: finite(e.value),
      crit: e.crit === true,
      absorbed: finite(e.absorbed),
    });
  }

  heal(e: HealEvent): void {
    this.events.push({
      kind: 'heal',
      fromId: e.fromId,
      toId: e.toId,
      skill: e.skill,
      ...(typeof e.skillName === 'string' && e.skillName !== '' ? { skillName: e.skillName } : {}),
      value: finite(e.value),
    });
  }

  dodge(e: DodgeEvent): void {
    this.events.push({
      kind: 'dodge',
      fromId: e.fromId,
      toId: e.toId,
      skill: e.skill,
      ...(typeof e.skillName === 'string' && e.skillName !== '' ? { skillName: e.skillName } : {}),
    });
  }

  death(e: DeathEvent): void {
    this.kills += 1;
    this.events.push({ kind: 'death', unitId: e.unitId, name: e.name, camp: e.camp });
  }

  buff(e: BuffEvent): void {
    this.events.push({
      kind: 'buff',
      unitId: e.unitId,
      buffKey: e.buffKey,
      name: e.name,
      on: e.on === true,
    });
  }

  exp(e: ExpEvent): void {
    this.gainedExp += finite(e.amount);
    this.events.push({
      kind: 'exp',
      amount: finite(e.amount),
      level: finite(e.level),
    });
  }

  general(e: GeneralEvent): void {
    this.events.push({ kind: 'general', text: String(e.text ?? '') });
  }

  loot(e: LootEvent): void {
    // 包裹已满被丢弃的部分**不算获得**：不进战利品清单、不算金币/材料，也不进离线报告。
    if (e.handled === 'lost') {
      return;
    }
    const count = finite(e.count);
    const gold = finite(e.gold ?? (e.handled === 'sell' && e.key === 'gold' ? count : 0));
    this.gainedGold += gold;
    if (e.handled === 'decompose' || e.materials) {
      this.materials.set(e.key, (this.materials.get(e.key) ?? 0) + count);
    }
    const existing = this.loots.get(`${e.handled}:${e.key}:${e.quality}`);
    if (existing) {
      existing.count += count;
      existing.gold += gold;
    } else {
      const entry: CollectedLoot = {
        key: e.key,
        count,
        quality: finite(e.quality),
        handled: e.handled,
        gold,
      };
      if (e.materials) entry.materials = e.materials.map((m) => ({ key: m.key, count: finite(m.count) }));
      this.loots.set(`${e.handled}:${e.key}:${e.quality}`, entry);
    }
  }

  mapEnter(mapKey: string, name: string): void {
    this.events.push({ kind: 'general', text: `map.enter:${mapKey}:${name}` });
  }

  /** 取出并清空事件帧（tick 用）。 */
  drain(): CollectedFrame {
    const frame: CollectedFrame = {
      events: this.events,
      gainedExp: this.gainedExp,
      gainedGold: this.gainedGold,
      kills: this.kills,
    };
    this.events = [];
    this.gainedExp = 0;
    this.gainedGold = 0;
    this.kills = 0;
    return frame;
  }

  /** 只取事件（不清累计量；离线报告用 `snapshot`）。 */
  peekEvents(): readonly BattleEventDto[] {
    return this.events;
  }

  /** 累计快照（离线报告用；不清空）。 */
  snapshot(): {
    gainedExp: number;
    gainedGold: number;
    kills: number;
    loots: CollectedLoot[];
    materials: Array<{ key: string; count: number }>;
    events: readonly BattleEventDto[];
  } {
    return {
      gainedExp: this.gainedExp,
      gainedGold: this.gainedGold,
      kills: this.kills,
      loots: [...this.loots.values()],
      materials: [...this.materials].map(([key, count]) => ({ key, count })),
      events: this.events,
    };
  }

  reset(): void {
    this.events = [];
    this.gainedExp = 0;
    this.gainedGold = 0;
    this.kills = 0;
    this.loots.clear();
    this.materials.clear();
  }
}

/** 装备品质夹取到 `Quality`（0..2，P4）。 */
export function qualityOf(value: number): Quality {
  const n = Number.isFinite(value) ? Math.floor(value) : 0;
  if (n < 0) return 0;
  if (n > 2) return 2;
  return n as Quality;
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
