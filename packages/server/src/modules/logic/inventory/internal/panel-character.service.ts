/**
 * 面板域的「当前角色」解析（服务端权威）。
 *
 * 背景：面板请求（`inventory.equip` / `career.list` / …）的载荷里**没有** characterId
 * （见 `@idle-dark/ionet-transport` 的 typed API 与任务书附录 A），而服务端必须知道
 * 操作的是哪个角色。本服务把「当前角色」收敛成一个显式注册表：
 *
 * 1. 请求显式带 `characterId`（可选扩展字段）→ 以它为准；
 * 2. 否则读内存注册表（`player.select` / `world.enterMap` 应调用 `setActive` 写入）；
 * 3. 否则回落到 DB 里该用户**最近创建**的角色（单角色用户开箱即用）。
 *
 * ⚠️ 集成要求：`player.select` 完成后应调用 `setActive(userId, characterId)`，
 *    否则多角色账号会一直操作「最近创建」的那个角色。
 */
import { Inject, Injectable } from '@nestjs/common';
import { GameDatabaseService } from '../../../game/game-database.service.js';

interface CharacterRow {
  id: string;
}

@Injectable()
export class PanelCharacterService {
  private readonly active = new Map<number, string>();

  constructor(private readonly db: GameDatabaseService) {}

  /** 记录当前角色（`player.select` / `world.enterMap` 调用）。 */
  setActive(userId: number, characterId: string): void {
    if (!Number.isSafeInteger(userId) || userId <= 0) return;
    const key = characterId.trim();
    if (key === '') {
      this.active.delete(userId);
      return;
    }
    this.active.set(userId, key);
  }

  /** 内存中的当前角色（未登记返回 null；不触发 IO）。 */
  peekActive(userId: number): string | null {
    return this.active.get(userId) ?? null;
  }

  /** 清除（登出 / 删角）。 */
  clear(userId: number): void {
    this.active.delete(userId);
  }

  /**
   * 解析目标角色 id。
   *
   * @returns 无法确定时返回 null（调用方按 `PLAYER_NOT_FOUND` 处理）。
   */
  async resolve(userId: number, explicit?: string): Promise<string | null> {
    if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim();
    const active = this.active.get(userId);
    if (active !== undefined) return active;

    const rows = await this.db.query<CharacterRow>(
      `SELECT id FROM characters WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [userId],
    );
    const id = rows.rows[0]?.id;
    if (typeof id !== 'string' || id === '') return null;
    this.active.set(userId, id);
    return id;
  }
}
