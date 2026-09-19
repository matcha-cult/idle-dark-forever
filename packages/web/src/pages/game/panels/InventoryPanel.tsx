/**
 * InventoryPanel —— 包裹（原版 Tab「包裹」）。
 *
 * 五个子页：
 * - 背包：物品网格 + 详情（装备 / 出售 / 锁定 / 开包）+ 整理 / 扩容；
 * - 装备：4 个固定槽位（点击卸下）；
 * - 储藏箱：背包 ↔ 储藏箱搬运 + 扩容；
 * - 拾取规则：自动拾取/出售/分解规则 + 最低等级；
 * - 神力商店：角色栏位购买 + 神力搬运。
 *
 * 纪律：格子数据一律来自服务端（`InventorySlotDto[]`），操作后由服务端返回的最新格子
 * **整体替换**；本面板不本地增删、不推导价格。
 */
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { App as AntApp, Button, Divider, Flex, InputNumber, Select, Space, Switch, Tabs, Tag, Typography, theme } from 'antd';
import type { InventorySlotDto, LootRuleAction } from '@idle-dark/protocol';
import type { LootRuleEntryDto } from '@idle-dark/ionet-transport';
import {
  ActionBar,
  CostList,
  EmptyState,
  ItemCard,
  ItemGrid,
  QuantityInput,
  RarityTag,
  SectionCard,
  StatList,
  formatAmount,
} from '@idle-dark/ui-kit';
import { useRootStore } from '../../../app/root-context.js';
import { EQUIP_POSITION_NAMES } from '../../../stores/inventory-store.js';

const LOOT_ACTIONS: ReadonlyArray<{ value: LootRuleAction; label: string }> = [
  { value: 0, label: '拾取' },
  { value: 1, label: '出售' },
  { value: 2, label: '分解' },
];

export const InventoryPanel = observer(function InventoryPanel() {
  const root = useRootStore();
  const { inventory, bank, shop, player } = root;
  const { modal } = AntApp.useApp();
  const { token } = theme.useToken();
  const [tab, setTab] = useState('bag');
  const [expandCount, setExpandCount] = useState(1);
  const [bankExpandCount, setBankExpandCount] = useState(1);
  const [sellCount, setSellCount] = useState(1);
  const [bankSelectedId, setBankSelectedId] = useState<string | null>(null);
  const [bankMoveCount, setBankMoveCount] = useState(1);

  const selected = inventory.selected;
  const bankSelected = bank.slots.find((slot) => slot.id === bankSelectedId) ?? null;

  const confirmSell = (slot: InventorySlotDto): void => {
    modal.confirm({
      title: `出售「${slot.name}」？`,
      content: `数量 ${sellCount}，可得 ${formatAmount(slot.price * sellCount)} 金币（服务端结算为准）。`,
      okText: '出售',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => inventory.sell(slot.id, sellCount),
    });
  };

  const confirmExpand = (): void => {
    modal.confirm({
      title: `扩容 ${expandCount} 格？`,
      content: '扩容消耗神力，价格由服务端结算。',
      okText: '扩容',
      cancelText: '取消',
      onOk: () => inventory.expand(expandCount),
    });
  };

  const itemDetail = (): ReactNode => {
    if (selected === null) {
      return <EmptyState description="选择一件物品查看详情" height={160} bordered />;
    }
    const isEquip = selected.type === 'equip';
    const isPackage = selected.type === 'package';
    return (
      <Flex vertical gap={token.paddingXS} data-testid="inventory-detail">
        <Flex justify="space-between" align="center" wrap gap={token.marginXXS}>
          <Space wrap>
            <Typography.Text strong>{selected.name}</Typography.Text>
            <RarityTag quality={selected.displayQuality ?? selected.quality} />
            {selected.level > 0 ? <Tag>{`Lv.${selected.level}`}</Tag> : null}
            {selected.locked ? <Tag color="gold">已锁定</Tag> : null}
          </Space>
          <Typography.Text style={{ color: token.gold }}>{`售价 ${formatAmount(selected.price)}`}</Typography.Text>
        </Flex>

        {selected.description === undefined ? null : (
          <Typography.Text type="secondary">{selected.description}</Typography.Text>
        )}

        <StatList
          items={[
            { key: 'count', label: '数量', value: formatAmount(selected.count) },
            ...(selected.equipPosition === undefined
              ? []
              : [{ key: 'position', label: '部位', value: EQUIP_POSITION_NAMES[selected.equipPosition] }]),
            ...(selected.requireLevel === undefined
              ? []
              : [{ key: 'require', label: '需求等级', value: formatAmount(selected.requireLevel) }]),
            ...(selected.atkSpeed === undefined
              ? []
              : [{ key: 'atkSpeed', label: '攻速', value: selected.atkSpeed.toFixed(2) }]),
            {
              key: 'enchant',
              label: '附魔次数',
              value: formatAmount(selected.enchantTimes),
            },
          ]}
        />

        {selected.affixes.length === 0 ? null : (
          <Flex vertical gap={0}>
            {selected.affixes.map((affix) => (
              <Typography.Text
                key={affix.key}
                style={{ color: affix.isLegend ? token.gold : token.colorTextSecondary }}
              >
                {`· ${affix.display}${affix.rebuilt === true ? '（已重铸）' : ''}`}
              </Typography.Text>
            ))}
          </Flex>
        )}

        <ActionBar
          actions={[
            ...(isEquip && selected.position !== 'equip'
              ? [{ key: 'equip', label: '装备', type: 'primary' as const, onClick: () => void inventory.equip(selected.id) }]
              : []),
            ...(selected.position === 'equip'
              ? [{ key: 'unequip', label: '卸下', onClick: () => void inventory.unequip(selected.id) }]
              : []),
            ...(isPackage
              ? [{ key: 'open', label: '开包', onClick: () => void inventory.usePackage(selected.id) }]
              : []),
            {
              key: 'lock',
              label: selected.locked ? '解锁' : '锁定',
              onClick: () => void inventory.toggleLock(selected.id, !selected.locked),
            },
            { key: 'sell', label: '出售', danger: true, onClick: () => confirmSell(selected) },
          ]}
        />

        {selected.type === 'equip' ? (
          <Space>
            <Typography.Text type="secondary">出售数量</Typography.Text>
            <QuantityInput value={sellCount} max={Math.max(1, selected.count)} onChange={setSellCount} />
          </Space>
        ) : null}
      </Flex>
    );
  };

  return (
    <SectionCard title="包裹">
      <Tabs
        activeKey={tab}
        onChange={setTab}
        data-testid="inventory-tabs"
        items={[
          {
            key: 'bag',
            label: '背包',
            children: (
              <Flex vertical gap={token.paddingSM}>
                <ActionBar
                  actions={[
                    { key: 'sort', label: '整理', onClick: () => void inventory.sort() },
                    { key: 'refresh', label: '刷新', onClick: () => void inventory.load() },
                  ]}
                >
                  <Space>
                    <QuantityInput value={expandCount} max={50} onChange={setExpandCount} />
                    <Button onClick={confirmExpand} data-testid="inventory-expand">
                      扩容
                    </Button>
                  </Space>
                </ActionBar>
                <ItemGrid
                  slots={inventory.inventory}
                  columns={8}
                  minSlots={Math.max(24, inventory.size)}
                  selectedId={inventory.selectedId}
                  onSelect={(slot) => inventory.select(slot.id)}
                  onActivate={(slot) => {
                    if (slot.type === 'package') void inventory.usePackage(slot.id);
                    else if (slot.type === 'equip' && slot.position !== 'equip') void inventory.equip(slot.id);
                  }}
                  footer={
                    <Typography.Text type="secondary">
                      {`占用 ${inventory.inventory.length}/${inventory.size}`}
                    </Typography.Text>
                  }
                />
                <Divider style={{ margin: 0 }} />
                {itemDetail()}
              </Flex>
            ),
          },
          {
            key: 'equip',
            label: '装备',
            children: (
              <Flex vertical gap={token.paddingXS}>
                {inventory.equipments.map(({ position, slot }) => (
                  <Flex key={position} align="center" gap={token.paddingXS} data-testid={`equip-slot-${position}`}>
                    <Typography.Text style={{ width: 56, color: token.colorTextTertiary }}>
                      {EQUIP_POSITION_NAMES[position]}
                    </Typography.Text>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ItemCard
                        slot={slot}
                        emptyText="空槽"
                        onClick={slot === null ? undefined : () => inventory.select(slot.id)}
                        onActivate={slot === null ? undefined : () => void inventory.unequip(slot.id)}
                      />
                    </div>
                    <Button
                      disabled={slot === null}
                      onClick={() => slot !== null && void inventory.unequip(slot.id)}
                      data-testid={`equip-unequip-${position}`}
                    >
                      卸下
                    </Button>
                  </Flex>
                ))}
              </Flex>
            ),
          },
          {
            key: 'bank',
            label: '储藏箱',
            children: (
              <Flex vertical gap={token.paddingSM}>
                <ActionBar
                  actions={[{ key: 'refresh', label: '刷新储藏箱', onClick: () => void bank.load() }]}
                >
                  <Space>
                    <QuantityInput value={bankExpandCount} max={50} onChange={setBankExpandCount} />
                    <Button onClick={() => void bank.expand(bankExpandCount)} data-testid="bank-expand">
                      扩容
                    </Button>
                  </Space>
                </ActionBar>
                <Space wrap>
                  <QuantityInput value={bankMoveCount} max={999} onChange={setBankMoveCount} />
                  <Button
                    disabled={inventory.selectedId === null}
                    onClick={() => inventory.selectedId !== null && void bank.deposit(inventory.selectedId, bankMoveCount)}
                    data-testid="bank-deposit"
                  >
                    存入选中物品
                  </Button>
                  <Button
                    disabled={bankSelectedId === null}
                    onClick={() => bankSelectedId !== null && void bank.withdraw(bankSelectedId, bankMoveCount)}
                    data-testid="bank-withdraw"
                  >
                    取出选中物品
                  </Button>
                </Space>
                <Flex wrap gap={token.paddingSM}>
                  <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                    <Typography.Text strong>背包</Typography.Text>
                    <ItemGrid
                      slots={inventory.inventory}
                      columns={6}
                      minSlots={12}
                      selectedId={inventory.selectedId}
                      onSelect={(slot) => inventory.select(slot.id)}
                      compact
                    />
                  </div>
                  <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                    <Typography.Text strong>储藏箱</Typography.Text>
                    <ItemGrid
                      slots={bank.slots}
                      columns={6}
                      minSlots={12}
                      selectedId={bankSelectedId}
                      onSelect={(slot) => setBankSelectedId(slot.id)}
                      compact
                    />
                  </div>
                </Flex>
              </Flex>
            ),
          },
          {
            key: 'loot',
            label: '拾取规则',
            children: (
              <Flex vertical gap={token.paddingSM} data-testid="loot-rule">
                {inventory.lootRule === null ? (
                  <EmptyState
                    description="尚未加载拾取规则"
                    actionText="加载"
                    onAction={() => void inventory.loadLootRule()}
                  />
                ) : (
                  <>
                    <ActionBar
                      actions={[
                        { key: 'refresh', label: '刷新', onClick: () => void inventory.loadLootRule() },
                      ]}
                    >
                      <Space>
                        <Typography.Text type="secondary">启用电控</Typography.Text>
                        <Switch
                          checked={inventory.lootRule.enabled}
                          onChange={(enabled) => void inventory.updateLootRule({ enabled })}
                          data-testid="loot-enabled"
                        />
                        <Typography.Text type="secondary">最低等级</Typography.Text>
                        <InputNumber
                          min={0}
                          max={9999}
                          value={inventory.lootRule.minLevel}
                          onChange={(value) => {
                            if (typeof value === 'number') void inventory.setLootMinLevel(value);
                          }}
                          data-testid="loot-min-level"
                        />
                      </Space>
                    </ActionBar>
                    <Flex vertical gap={token.marginXXS}>
                      {inventory.lootRule.rules.map((rule) => (
                        <Flex key={rule.id} align="center" gap={token.marginXS} data-testid={`loot-rule-${rule.id}`}>
                          <RarityTag quality={rule.minQuality} />
                          <Select<LootRuleAction>
                            value={rule.action}
                            options={LOOT_ACTIONS.map((action) => ({ ...action }))}
                            onChange={(action) => {
                              const next: LootRuleEntryDto[] = inventory.lootRule!.rules.map((entry) =>
                                entry.id === rule.id ? { ...entry, action } : entry,
                              );
                              void inventory.updateLootRule({ rules: next });
                            }}
                            style={{ width: 120 }}
                          />
                          <Switch
                            checked={rule.enabled}
                            onChange={(enabled) => {
                              const next: LootRuleEntryDto[] = inventory.lootRule!.rules.map((entry) =>
                                entry.id === rule.id ? { ...entry, enabled } : entry,
                              );
                              void inventory.updateLootRule({ rules: next });
                            }}
                          />
                          <Typography.Text type="secondary">{`等级 ≥ ${rule.minLevel}`}</Typography.Text>
                        </Flex>
                      ))}
                    </Flex>
                  </>
                )}
              </Flex>
            ),
          },
          {
            key: 'shop',
            label: '神力商店',
            children: (
              <Flex vertical gap={token.paddingSM} data-testid="shop">
                {shop.state === null ? (
                  <EmptyState description="尚未加载商店" actionText="加载" onAction={() => void shop.load()} />
                ) : (
                  <>
                    <StatList
                      items={[
                        { key: 'diamonds', label: '神力', value: formatAmount(shop.state.diamonds) },
                        {
                          key: 'slots',
                          label: '角色栏位',
                          value: `${shop.state.playerSlotCount}/${shop.state.playerSlotMax}`,
                        },
                        { key: 'price', label: '下个栏位价格', value: formatAmount(shop.state.nextSlotPrice) },
                      ]}
                    />
                    <ActionBar
                      actions={[
                        {
                          key: 'buy-slot',
                          label: '购买角色栏位',
                          type: 'primary',
                          disabled: shop.state.playerSlotCount >= shop.state.playerSlotMax,
                          onClick: () => {
                            modal.confirm({
                              title: '购买角色栏位？',
                              content: `消耗神力 ${formatAmount(shop.state?.nextSlotPrice ?? 0)}。`,
                              okText: '购买',
                              cancelText: '取消',
                              onOk: () => shop.buyPlayerSlot(),
                            });
                          },
                        },
                        { key: 'refresh', label: '刷新', onClick: () => void shop.load() },
                      ]}
                    />
                    <SectionCard title="神力搬运" dense>
                      <Flex vertical gap={token.marginXS}>
                        {shop.state.exchangeOptions.length === 0 ? (
                          <Typography.Text type="secondary">暂无可用的搬运方案</Typography.Text>
                        ) : (
                          shop.state.exchangeOptions.map((option) => (
                            <Flex key={`${option.from}->${option.to}`} align="center" gap={token.marginXS}>
                              <Typography.Text>{`${option.from} → ${option.to}`}</Typography.Text>
                              <CostList costs={{ diamonds: option.cost }} owned={{ diamonds: player.diamonds }} />
                              <Button
                                onClick={() => void shop.exchange(option.from, option.to)}
                                data-testid={`exchange-${option.from}-${option.to}`}
                              >
                                兑换
                              </Button>
                            </Flex>
                          ))
                        )}
                      </Flex>
                    </SectionCard>
                  </>
                )}
              </Flex>
            ),
          },
        ]}
      />
    </SectionCard>
  );
});
