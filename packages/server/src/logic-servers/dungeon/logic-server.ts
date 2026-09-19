/**
 * dungeon（秘境）逻辑服 seam。
 *
 * 拥有：秘境挑战 + 挑战队列 + 冷却/每日重置 + **离线结算编排**（cmd 段 idle，09 §6.3）。
 * R1 阶段源码仍由 `modules/logic/idle` 承载；R3 迁入后在此登记。
 */
import { BaseLogicServer } from '../logic-server.js';
import { SERVER_DEFINITIONS } from '../registry.js';

export class DungeonLogicServer extends BaseLogicServer {
  constructor() {
    super(SERVER_DEFINITIONS.dungeon);
  }
}
