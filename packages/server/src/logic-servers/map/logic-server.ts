/**
 * map（地图）逻辑服 seam。
 *
 * 拥有：开放世界控制器（地图目录/解锁判定/位置与种子/`map.enter`/…，09 R2）。
 * R1 阶段 `roots` 为空（源码仍在 battle），R2 迁入后在 `registry.ts` 登记 roots 与 cmd 段。
 */
import { BaseLogicServer } from '../logic-server.js';
import { SERVER_DEFINITIONS } from '../registry.js';

export class MapLogicServer extends BaseLogicServer {
  constructor() {
    super(SERVER_DEFINITIONS.map);
  }
}
