/**
 * character（角色）逻辑服 seam。
 *
 * 拥有：角色 / 属性 / 职业（cmd 段 player + career）与账号级状态；
 * 目标方向 `character → battle`（StartSession/StopSession 命令，R4 落地）。
 */
import { BaseLogicServer } from '../logic-server.js';
import { SERVER_DEFINITIONS } from '../registry.js';

export class CharacterLogicServer extends BaseLogicServer {
  constructor() {
    super(SERVER_DEFINITIONS.character);
  }
}
