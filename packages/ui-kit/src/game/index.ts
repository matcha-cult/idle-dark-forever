/** game 分组 barrel：游戏语义通用组件（品质 / 物品 / 资源 / 战斗 / 费用 / 操作）。 */
export { ActionBar, type ActionBarProps, type ActionItem } from './action-bar.js';
export { CostList, type CostListProps } from './cost-list.js';
export { ItemCard, type ItemCardProps } from './item-card.js';
export { ItemGrid, type ItemGridProps } from './item-grid.js';
export {
  clampQuality,
  COMMON_QUALITY,
  MAX_QUALITY,
  QUALITY_LABELS,
  qualityLabel,
} from './quality.js';
export { QuantityInput, type QuantityInputProps } from './quantity-input.js';
export { PlayerAttributesPanel, type PlayerAttributesPanelProps } from './player-attributes-panel.js';
export {
  RarityPaletteProvider,
  type RarityColor,
  type RarityPalette,
  type RarityPaletteProviderProps,
  useRarityColor,
  useRarityTagStyle,
} from './rarity-palette.js';
export { RarityTag, type RarityTagProps } from './rarity-tag.js';
export {
  RESOURCE_COLOR_TOKEN_NAMES,
  RESOURCE_LABELS,
  ResourceBar,
  type ResourceBarProps,
  type ResourceKind,
} from './resource-bar.js';
export { UnitCard, type UnitCardProps } from './unit-card.js';
