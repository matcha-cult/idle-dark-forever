/**
 * battle（战斗）逻辑服 seam。
 *
 * 拥有：唯一战斗仿真器 + 会话宿主（`BattleWorld`、tick 调度、伤害/经验/掉落判定）。
 * cmd 段 world + battle。**不写业务**（08 §1 C2）；类里禁止 `@ActionMethod`。
 */
import { BaseLogicServer } from '../logic-server.js';
import { SERVER_DEFINITIONS } from '../registry.js';

export class BattleLogicServer extends BaseLogicServer {
  constructor() {
    super(SERVER_DEFINITIONS.battle);
  }
}
