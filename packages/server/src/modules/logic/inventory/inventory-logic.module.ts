/**
 * 背包域模块（cmd 段 inventory）。
 *
 * `PanelCharacterService` 由 `@Global()` 的 `PanelCharacterModule` 提供，本模块不重复 provide
 * （否则会得到第二个实例，破坏「当前角色」注册表的一致性）。
 */
import { Module } from '@nestjs/common';
import { InventoryAction } from './inventory.action.js';
import { InventoryLogicService } from './inventory.logic.service.js';

@Module({
  providers: [InventoryLogicService, InventoryAction],
  exports: [InventoryLogicService, InventoryAction],
})
export class InventoryLogicModule {}
