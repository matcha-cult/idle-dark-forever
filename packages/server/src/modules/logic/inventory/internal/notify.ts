/**
 * 面板域推送助手（`NOTIFICATION_BATCHER` 入队）。
 *
 * 前端对各推送的消费方式（见任务书附录 A.2）：
 * - `inventory.changed`：`data` 为 `InventorySlotDto[]` → 整体替换；
 * - `story.unlock`：`data` 为 `StoryUnlockDto`（`{ key, name, taskType, autoPlay }`）→
 *   `autoPlay` 为真时自动打开剧本，否则提示 + 刷新列表；
 * - `career.levelup`：`data` 为 `{ level, peak, career }`。
 */
import type { InventorySlotDto, StoryUnlockDto } from '@idle-dark/protocol';
import { CAREER_CMD, INVENTORY_CMD, STORY_CMD } from '@idle-dark/protocol';
import type { NotificationBatcher } from '../../../game/notification-batcher.js';

export function pushInventoryChanged(
  batcher: NotificationBatcher,
  userId: number,
  slots: InventorySlotDto[],
): void {
  batcher.enqueue(userId, {
    cmd: INVENTORY_CMD.cmd,
    subCmd: INVENTORY_CMD.changed,
    data: slots,
  });
}

export function pushStoryUnlock(
  batcher: NotificationBatcher,
  userId: number,
  payload: StoryUnlockDto,
): void {
  batcher.enqueue(userId, {
    cmd: STORY_CMD.cmd,
    subCmd: STORY_CMD.unlock,
    data: payload,
  });
}

export function pushCareerLevelup(
  batcher: NotificationBatcher,
  userId: number,
  payload: { level: number; peak: boolean; career: string },
): void {
  batcher.enqueue(userId, {
    cmd: CAREER_CMD.cmd,
    subCmd: CAREER_CMD.levelup,
    data: payload,
  });
}
