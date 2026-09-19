/**
 * item（物品）逻辑服 seam。
 *
 * 拥有：背包 / 装备 / 银行 / 商店 / 生产 / 拾取规则（cmd 段 inventory/bank/lootrule/produce/shop），
 * 且是 `characters.state` 物品切片的**唯一写者**（08 §2.2 C2）。
 */
import { BaseLogicServer } from '../logic-server.js';
import { SERVER_DEFINITIONS } from '../registry.js';

export class ItemLogicServer extends BaseLogicServer {
  constructor() {
    super(SERVER_DEFINITIONS.item);
  }
}
