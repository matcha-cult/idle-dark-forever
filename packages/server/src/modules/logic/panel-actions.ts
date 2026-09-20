/**
 * 面板域 Action / Module 登记片段（**供集成方并入 `src/ionet/game-actions.ts`**）。
 *
 * ```ts
 * import { PANEL_ACTION_CLASSES, PANEL_LOGIC_MODULES } from './modules/logic/panel-actions.js';
 * export const GAME_ACTION_CLASSES = [HealthAction, AuthAction, ...PANEL_ACTION_CLASSES] as const;
 * export const GAME_ACTION_MODULES = [HealthModule, AuthModule, ...PANEL_LOGIC_MODULES] as const;
 * ```
 *
 * ⚠️ `PanelCharacterModule` 是 `@Global()`：提供「当前角色」注册表
 * （`PanelCharacterService`），各面板域共享同一实例。必须列入模块表一次。
 *
 * 覆盖的 cmd 段：inventory(50) / bank(60) / lootrule(70) / career(80) / produce(90) /
 * shop(110)。
 */
import { CMD_SEGMENTS } from '@idle-dark/protocol';
import { InventoryAction } from './inventory/inventory.action.js';
import { BankAction } from './bank/bank.action.js';
import { LootRuleAction } from './lootrule/lootrule.action.js';
import { CareerAction } from './career/career.action.js';
import { ProduceAction } from './produce/produce.action.js';
import { ShopAction } from './shop/shop.action.js';

import { PanelCharacterModule } from './shared/panel-character.module.js';
import { InventoryLogicModule } from './inventory/inventory-logic.module.js';
import { BankLogicModule } from './bank/bank-logic.module.js';
import { LootRuleLogicModule } from './lootrule/lootrule-logic.module.js';
import { CareerLogicModule } from './career/career-logic.module.js';
import { ProduceLogicModule } from './produce/produce-logic.module.js';
import { ShopLogicModule } from './shop/shop-logic.module.js';

/** 面板域的 Action 类（登记到 `GAME_ACTION_CLASSES`）。 */
export const PANEL_ACTION_CLASSES = [
  InventoryAction,
  BankAction,
  LootRuleAction,
  CareerAction,
  ProduceAction,
  ShopAction,
] as const;

/** 面板域的 Nest 模块（登记到 `GAME_ACTION_MODULES`）。 */
export const PANEL_LOGIC_MODULES = [
  PanelCharacterModule,
  InventoryLogicModule,
  BankLogicModule,
  LootRuleLogicModule,
  CareerLogicModule,
  ProduceLogicModule,
  ShopLogicModule,
] as const;

/** 面板域覆盖的 cmd 段（供 `route-check` / 集成自检）。 */
export const PANEL_CMD_SEGMENTS = [
  CMD_SEGMENTS.inventory,
  CMD_SEGMENTS.bank,
  CMD_SEGMENTS.lootrule,
  CMD_SEGMENTS.career,
  CMD_SEGMENTS.produce,
  CMD_SEGMENTS.shop,
] as const;
