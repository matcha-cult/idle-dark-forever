/**
 * quest（任务）逻辑服 seam。
 *
 * 拥有：剧情三态 / 击杀任务进度（cmd 段 story）；订阅 battle 的 `MapEntered` / `EnemyKilled`。
 */
import { BaseLogicServer } from '../logic-server.js';
import { SERVER_DEFINITIONS } from '../registry.js';

export class QuestLogicServer extends BaseLogicServer {
  constructor() {
    super(SERVER_DEFINITIONS.quest);
  }
}
