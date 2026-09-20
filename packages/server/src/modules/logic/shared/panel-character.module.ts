/**
 * 面板域「当前角色」服务的全局装配模块。
 *
 * `@Global()`：所有面板域（inventory / bank / lootrule / career / produce / shop）
 * 都能注入 `PanelCharacterService`，而不需要各自 import 本模块。
 */
import { Global, Module } from '@nestjs/common';
import { PanelCharacterService } from './panel-character.service.js';

@Global()
@Module({
  providers: [PanelCharacterService],
  exports: [PanelCharacterService],
})
export class PanelCharacterModule {}
