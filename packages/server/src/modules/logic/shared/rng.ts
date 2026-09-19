/**
 * 面板域随机源装配。
 *
 * `game-core` 禁止裸 `Math.random()`；消耗类操作的随机（附魔词缀 / 重铸 / 开包 / 炼金分配）
 * 一律走 `Rng` 端口。种子优先取自 `opId`（同一次操作重放得到同结果），
 * 否则由调用方给出「用户 + 角色 + 时钟 + 序号」派生文本。
 */
import { SeededRngFactory, type Rng } from '@idle-dark/game-core';

export function rngFromText(seedText: string): Rng {
  const factory = new SeededRngFactory();
  return factory.create(factory.seedFromText(seedText));
}

/** 由若干片段拼出稳定种子文本（`|` 分隔，空片段跳过）。 */
export function seedTextOf(...parts: Array<string | number | undefined>): string {
  return parts
    .filter((part): part is string | number => part !== undefined)
    .map((part) => String(part))
    .join('|');
}
