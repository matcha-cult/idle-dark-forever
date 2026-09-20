/**
 * battle（战斗逻辑服）**对外命令契约**（09 §4.2；C3「跨服只走通信契约」）
 *
 * 为什么要有这个端口：拓扑 B 里 map / character 都需要命令 battle
 * "开/切/关会话、要快照、解析当前角色"，但**不允许 import 另一个服的 service/internal**。
 * 因此把跨服命令面收敛成本文件的接口 + 注入令牌：
 *
 * - 消费方（map/character）只依赖 `shared`（允许）；
 * - battle 在自己的模块里用 `useExisting: WorldService` 绑定令牌（R4 过渡实现；
 *   框架逻辑服运行时（ionet-ts RS5 的 `FlowContext.call`）就绪后换成真正跨进程调用，
 *   **消费方代码不变**）。
 *
 * 只放**跨服真需要**的方法；battle 内部方法（focus/…）不出现在这里。
 */
import type { ActionResult, WorldSnapshotDto } from '@idle-dark/protocol';
import type { WorldPosition } from './map-dto.js';

/** 角色归属校验结果（与 `WorldService.resolveActiveCharacter` 同形）。 */
export type ActiveCharacterResolution =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly fail: ActionResult<never> };

export interface BattleCommandPort {
  /** 当前世界快照。 */
  snapshot(userId: number, characterId: string): Promise<ActionResult<WorldSnapshotDto>>;
  /**
   * 切换到某张图：**会做解锁判定**；`opId` 幂等。
   *
   * `options.allowChaos = true` 只允许混沌仪（`chaos` 域）放行 `chaos.tNN` ——
   * 普通 `map.enter` / `world.enterMap` 一律拒绝混沌图（W6）。
   */
  enterMap(
    userId: number,
    characterId: string,
    mapKey: string,
    opId?: string,
    options?: { readonly allowChaos?: boolean },
  ): Promise<ActionResult<WorldSnapshotDto>>;
  /** 关闭会话（离开地图 / 切人 / 登出）。 */
  leave(userId: number, characterId: string): Promise<ActionResult<null>>;
  /**
   * 解析"本次请求操作哪个角色"——**角色归属校验唯一入口**（AGENTS §15）。
   * 显式 key 必须等于当前角色；未选角一律拒绝。
   */
  resolveActiveCharacter(userId: number, raw: unknown): ActiveCharacterResolution;

  // ── character 服需要的会话/位置命令（R4-b） ──
  /** 启动 / 获取会话；角色不存在 → `false`。 */
  startSession(userId: number, characterId: string): Promise<boolean>;
  /** 停会话并落库（切人 / 删角 / 登出）。 */
  stopSession(userId: number, characterId: string): Promise<void>;
  /** 最近一次选的当前角色。 */
  activeCharacterOf(userId: number): string | undefined;
  /** 会话所在地图（无会话 → `undefined`）。 */
  positionOf(userId: number, characterId: string): WorldPosition | undefined;
  /** 待结算离线时长（ms）。 */
  pendingOfflineMs(userId: number, characterId: string): number;
  /** 技能可用性投影（当前为空表 = 全部未判定）。 */
  usableByKey(): Record<string, boolean>;
  /** 该角色是否有活跃会话。 */
  isInBattle(userId: number, characterId: string): boolean;
}

/** 注入 battle 命令端口的令牌（battle 侧 `useExisting: WorldService`）。 */
export const BATTLE_COMMAND = Symbol('BATTLE_COMMAND');
