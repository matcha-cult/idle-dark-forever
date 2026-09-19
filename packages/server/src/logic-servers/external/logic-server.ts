/**
 * external（对外服）逻辑服 seam。
 *
 * 拥有：握手鉴权 / 路由 / 在线集合 / 当前角色 / 推送汇聚（cmd 段 system + auth）。
 * **不写业务**（08 §1 C2）；业务在 battle/item/quest/character/dungeon/map。
 */
import { BaseLogicServer } from '../logic-server.js';
import { SERVER_DEFINITIONS } from '../registry.js';

export class ExternalLogicServer extends BaseLogicServer {
  constructor() {
    super(SERVER_DEFINITIONS.external);
  }
}
