/**
 * idle（离线结算）逻辑服 seam。
 *
 * 拥有：离线结算编排（cmd 段 idle，09 §6.3）。
 * W6 起旧氪金秘境（dungeon）域已删除，idle 域只负责开放世界的离线挂机结算。
 */
import { BaseLogicServer } from '../logic-server.js';
import { SERVER_DEFINITIONS } from '../registry.js';

export class IdleLogicServer extends BaseLogicServer {
  constructor() {
    super(SERVER_DEFINITIONS.idle);
  }
}
