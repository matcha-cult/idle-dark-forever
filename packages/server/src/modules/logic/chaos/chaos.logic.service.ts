/**
 * 混沌仪门面（cmd 140；W6，§2.3 / §4 W6）
 *
 * 归属 `idle` 逻辑服：混沌仪的**在线推进**与**离线结算**是同一套状态机
 * （纯逻辑在 `internal/chaos-ops.ts`，在线/离线共用），因此与 `IdleService` 同服。
 *
 * 跨服纪律（C3）：
 * - 只经 `BATTLE_COMMAND` 命令 battle 切图（`enterMap`，`allowChaos` 放行混沌图）；
 * - 只经 `EVENT_BUS` 订阅 battle 的 `ChaosRunEnded`，**不 import battle 的 service**。
 */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  BusinessErrorCode,
  type ActionResult,
  type ChaosFailMode,
  type ChaosStateDto,
  type ChaosTierDto,
  fail,
  ok,
} from '@idle-dark/protocol';
import {
  CHAOS_MAX_SEQUENCE,
  chaosLevelOfTier,
  chaosMapKeyOfTier,
  keystoneKeyOfTier,
  type Player,
} from '@idle-dark/game-core';
import {
  BATTLE_COMMAND,
  EVENT_BUS,
  PlayerContextService,
  type BattleCommandPort,
  type EventBus,
} from '../shared/index.js';
import {
  countsOf,
  currentTierOf,
  firstChaosStep,
  isChaosSequenceValid,
  nextChaosStep,
  stateOf,
  type ChaosOutcome,
  type ChaosStep,
} from './internal/chaos-ops.js';

/** 中断 / 序列走完后角色回到的普通地图（安全区）。 */
export const CHAOS_HOME_MAP = 'home';

@Injectable()
export class ChaosLogicService implements OnModuleInit {
  private readonly logger = new Logger(ChaosLogicService.name);

  constructor(
    private readonly contexts: PlayerContextService,
    @Inject(BATTLE_COMMAND) private readonly battle: BattleCommandPort,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    // battle 每次结算混沌 run → 同步事件驱动下一步（事件总线是进程内同步实现）。
    this.events.on('ChaosRunEnded', (event) => {
      void this.onRunEnded(
        event.userId,
        event.characterId,
        event.tier,
        event.outcome,
      ).catch((error: unknown) => {
        this.logger.warn(`混沌仪推进失败：${event.characterId}`, {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  // ────────────────────────────── 查询 ──────────────────────────────

  /** 混沌仪状态（解锁 / 16 阶 + 钥石持有 / 序列 / 失败选项 / 进度）。 */
  async state(userId: number, characterId: string): Promise<ActionResult<ChaosStateDto>> {
    const player = await this.contexts.load(userId, characterId);
    if (player === null) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    return ok(this.buildState(player));
  }

  /** 保存钥石序列（≤16、每项合法、可重复）。 */
  async setSequence(
    userId: number,
    characterId: string,
    sequence: unknown,
  ): Promise<ActionResult<ChaosStateDto>> {
    if (!isChaosSequenceValid(sequence)) {
      return fail(
        BusinessErrorCode.INVALID_PARAM,
        `钥石序列非法（最多 ${CHAOS_MAX_SEQUENCE} 条，且必须是 keystone.t01~t16）`,
      );
    }
    const player = await this.contexts.load(userId, characterId);
    if (player === null) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    player.chaosSequence = sequence.slice(0, CHAOS_MAX_SEQUENCE);
    // 序列变短可能让当前下标越界：夹回合法区间，避免存档残留越界值。
    if (player.chaosIndex > player.chaosSequence.length) {
      player.chaosIndex = player.chaosSequence.length;
    }
    if (player.chaosSequence.length === 0) {
      player.chaosActive = false;
      player.chaosIndex = 0;
      player.chaosRetry = 0;
    }
    await this.persist(userId, characterId);
    return ok(this.buildState(player));
  }

  /** 设置失败选项。 */
  async setFailMode(
    userId: number,
    characterId: string,
    failMode: unknown,
  ): Promise<ActionResult<ChaosStateDto>> {
    if (failMode !== 'normal' && failMode !== 'continue') {
      return fail(BusinessErrorCode.INVALID_PARAM, '失败选项非法');
    }
    const player = await this.contexts.load(userId, characterId);
    if (player === null) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    player.chaosFailMode = failMode as ChaosFailMode;
    await this.persist(userId, characterId);
    return ok(this.buildState(player));
  }

  // ────────────────────────────── 运行 ──────────────────────────────

  /** 开始运行：解锁 + 序列首个可用钥石 → 消耗 1 把 → 进入对应 T 阶。 */
  async start(userId: number, characterId: string): Promise<ActionResult<ChaosStateDto>> {
    const player = await this.contexts.load(userId, characterId);
    if (player === null) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    if (player.chaosActive) return fail(BusinessErrorCode.CHAOS_ALREADY_ACTIVE);
    if (!player.hasAllWorldBossesKilled()) return fail(BusinessErrorCode.CHAOS_LOCKED);

    const step = firstChaosStep(stateOf(player), countsOf(player));
    if (step.action === 'stop') {
      return fail(
        step.reason === 'sequence-exhausted'
          ? BusinessErrorCode.INVALID_PARAM
          : BusinessErrorCode.CHAOS_KEYSTONE_MISSING,
        step.reason === 'sequence-exhausted' ? '尚未编排钥石序列' : '缺少可用的混沌钥石',
      );
    }

    const entered = await this.enterTier(userId, characterId, step);
    if (!entered) return fail(BusinessErrorCode.INTERNAL, '进入混沌领域失败');
    await this.persist(userId, characterId);
    return ok(this.buildState(player));
  }

  /** 停止运行：清运行态并把角色送回普通地图。 */
  async stop(userId: number, characterId: string): Promise<ActionResult<ChaosStateDto>> {
    const player = await this.contexts.load(userId, characterId);
    if (player === null) return fail(BusinessErrorCode.PLAYER_NOT_FOUND);
    player.chaosActive = false;
    player.chaosIndex = 0;
    player.chaosRetry = 0;
    await this.persist(userId, characterId);
    await this.battle.enterMap(userId, characterId, CHAOS_HOME_MAP);
    return ok(this.buildState(player));
  }

  // ────────────────────────────── 事件推进 ──────────────────────────────

  /**
   * battle 报告一次混沌挑战已结算 → 按失败分支推进。
   *
   * `tier` 与当前序列下标不一致 = 过期事件（例如角色已重置），直接忽略。
   */
  private async onRunEnded(
    userId: number,
    characterId: string,
    tier: number,
    outcome: ChaosOutcome,
  ): Promise<void> {
    const player = await this.contexts.load(userId, characterId);
    if (player === null || !player.chaosActive) return;
    const currentTier = currentTierOf(player);
    if (currentTier === null || currentTier !== tier) return;

    const step = nextChaosStep(stateOf(player), outcome, countsOf(player));
    if (step.action === 'stop') {
      await this.abortToHome(userId, characterId, player);
      return;
    }
    const entered = await this.enterTier(userId, characterId, step);
    if (!entered) {
      await this.abortToHome(userId, characterId, player);
      return;
    }
    await this.persist(userId, characterId);
  }

  /** 应用一步「进入」：先切图（失败不扣钥石），成功后再扣 1 把并写运行态。 */
  private async enterTier(
    userId: number,
    characterId: string,
    step: Extract<ChaosStep, { action: 'enter' }>,
  ): Promise<boolean> {
    const mapKey = chaosMapKeyOfTier(step.tier);
    if (mapKey === null || !this.contexts.tables.maps[mapKey]) return false;
    const player = await this.contexts.load(userId, characterId);
    if (player === null) return false;
    const entered = await this.battle.enterMap(userId, characterId, mapKey, undefined, {
      allowChaos: true,
    });
    if (!entered.success) return false;
    const rest = player.costGood(step.keystone, 1);
    if (rest !== 0) return false;
    player.chaosActive = true;
    player.chaosIndex = step.index;
    player.chaosRetry = step.retry;
    return true;
  }

  /** 干净停止：清运行态并把角色送回普通地图。 */
  private async abortToHome(userId: number, characterId: string, player: Player): Promise<void> {
    player.chaosActive = false;
    player.chaosRetry = 0;
    player.chaosIndex = 0;
    await this.persist(userId, characterId);
    await this.battle.enterMap(userId, characterId, CHAOS_HOME_MAP);
  }

  private async persist(userId: number, characterId: string): Promise<void> {
    this.contexts.markDirty(userId, characterId);
    this.contexts.markAccountDirty(userId);
    await this.contexts.flush(userId, characterId);
  }

  // ────────────────────────────── 投影 ──────────────────────────────

  private buildState(player: Player): ChaosStateDto {
    const unlocked = player.hasAllWorldBossesKilled();
    const tiers: ChaosTierDto[] = [];
    for (let tier = 1; tier <= 16; tier += 1) {
      const mapKey = chaosMapKeyOfTier(tier);
      const keystoneKey = keystoneKeyOfTier(tier);
      const level = chaosLevelOfTier(tier);
      if (mapKey === null || keystoneKey === null || level === null) continue;
      tiers.push({
        tier,
        mapKey,
        name: this.contexts.tables.maps[mapKey]?.name ?? `混沌 T${tier}`,
        level,
        keystoneKey,
        keystoneCount: player.countGood(keystoneKey),
        unlocked,
      });
    }
    return {
      unlocked,
      tiers,
      sequence: [...player.chaosSequence],
      failMode: player.chaosFailMode,
      active: player.chaosActive,
      currentTier: currentTierOf(player),
      retry: player.chaosRetry,
    };
  }
}

// ────────────────────────────── 纯函数辅助 ──────────────────────────────
// 状态机适配（`stateOf` / `currentTierOf` / `countsOf`）定义在 `internal/chaos-ops.ts`，
// 在线与离线（`IdleService`）共用同一实现。
