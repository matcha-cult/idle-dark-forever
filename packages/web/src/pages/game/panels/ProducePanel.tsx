/**
 * ProducePanel —— 生产（原版 Tab「生产」）：附魔 / 重铸 / 分解 / 炼金。
 *
 * 四个子页共用一个「目标物品」选择区（只列可生产的背包物品），
 * 费用与结果**全部来自服务端**（`EnchantCostsDto` / `DecomposeResultDto` / `MedicineStateDto`）。
 *
 * ⚠️ 已知限制：重铸费用（`RebuildCostsDto`）在协议里已定义，但 transport 的 typed API
 * 只暴露 `produce.enchantCosts`（返回 `EnchantCostsDto`），因此本页只展示「可重铸词缀」
 * 与二次确认，不显示重铸价格（见交付报告）。
 */
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { App as AntApp, Button, Checkbox, Flex, Input, Radio, Space, Tabs, Tag, Typography, theme } from 'antd';
import type { InventorySlotDto } from '@idle-dark/protocol';
import {
  ActionBar,
  CostList,
  EmptyState,
  ItemGrid,
  QuantityInput,
  SectionCard,
  StatList,
  formatAmount,
} from '@idle-dark/ui-kit';
import { useRootStore } from '../../../app/root-context.js';

export const ProducePanel = observer(function ProducePanel() {
  const root = useRootStore();
  const { produce, inventory, player } = root;
  const { modal } = AntApp.useApp();
  const { token } = theme.useToken();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [locks, setLocks] = useState<string[]>([]);
  const [affixKey, setAffixKey] = useState<string | null>(null);
  const [material, setMaterial] = useState('');
  const [materialCount, setMaterialCount] = useState(1);

  const candidates: InventorySlotDto[] = inventory.inventory.filter((slot) => slot.type === 'equip');
  const target = candidates.find((slot) => slot.id === targetId) ?? null;
  const medicine = produce.medicineState;

  const pick = (slot: InventorySlotDto): void => {
    setTargetId(slot.id);
    setLocks([]);
    setAffixKey(null);
    void produce.loadEnchantCosts(slot.id);
  };

  const targetPicker = (): ReactNode => (
    <Flex vertical gap={token.marginXS} data-testid="produce-target">
      <Typography.Text strong>选择目标物品</Typography.Text>
      {candidates.length === 0 ? (
        <EmptyState description="背包里没有可生产的装备" height={100} />
      ) : (
        <ItemGrid
          slots={candidates}
          columns={8}
          minSlots={8}
          selectedId={targetId}
          onSelect={pick}
          compact
          footer={
            <Typography.Text type="secondary">
              {target === null ? '未选择目标' : `当前目标：${target.name}`}
            </Typography.Text>
          }
        />
      )}
    </Flex>
  );

  return (
    <Flex vertical gap={token.paddingSM} data-testid="produce-panel">
      <SectionCard title="生产" extra={<Button onClick={() => void produce.load()} data-testid="produce-refresh">刷新</Button>}>
        <Tabs
          activeKey={produce.subPage}
          onChange={(key) => produce.setSubPage(key as typeof produce.subPage)}
          data-testid="produce-tabs"
          items={[
            {
              key: 'enchant',
              label: '附魔',
              children: (
                <Flex vertical gap={token.paddingSM}>
                  {targetPicker()}
                  {target === null ? (
                    <EmptyState description="先选择要附魔的装备" height={100} />
                  ) : (
                    <Flex vertical gap={token.marginXS}>
                      <Typography.Text strong>锁定词缀（锁定项不参与重掷，但要额外消耗神力）</Typography.Text>
                      <Checkbox.Group
                        value={locks}
                        onChange={(values) => setLocks(values.map(String))}
                        options={target.affixes.map((affix) => ({ label: affix.display, value: affix.key }))}
                      />
                      <Space>
                        <Typography.Text type="secondary">费用预览</Typography.Text>
                        {produce.enchantCosts === null ? (
                          <Button onClick={() => void produce.loadEnchantCosts(target.id)}>获取费用</Button>
                        ) : (
                          <CostList
                            costs={produce.enchantCosts.enchant}
                            owned={{ gold: player.gold, diamonds: player.diamonds }}
                          />
                        )}
                        {produce.enchantCosts === null ? null : (
                          <Tag color="purple">{`锁定额外神力 ${formatAmount(produce.enchantCosts.lockDiamond)}`}</Tag>
                        )}
                      </Space>
                      <ActionBar
                        actions={[
                          {
                            key: 'enchant',
                            label: '附魔',
                            type: 'primary',
                            disabled: produce.enchantCosts === null,
                            onClick: () => {
                              modal.confirm({
                                title: `附魔「${target.name}」？`,
                                content: '附魔会重掷未锁定的词缀，结果由服务端生成。',
                                okText: '附魔',
                                cancelText: '取消',
                                onOk: () => produce.enchant(target.id, locks.length === 0 ? undefined : locks),
                              });
                            },
                          },
                          { key: 'reload-costs', label: '重新计价', onClick: () => void produce.loadEnchantCosts(target.id) },
                        ]}
                      />
                    </Flex>
                  )}
                </Flex>
              ),
            },
            {
              key: 'rebuild',
              label: '重铸',
              children: (
                <Flex vertical gap={token.paddingSM}>
                  {targetPicker()}
                  {target === null ? (
                    <EmptyState description="先选择要重铸的装备" height={100} />
                  ) : target.affixes.length === 0 ? (
                    <EmptyState description="该装备没有可重铸的词缀" height={100} />
                  ) : (
                    <Flex vertical gap={token.marginXS}>
                      <Radio.Group value={affixKey} onChange={(event) => setAffixKey(String(event.target.value))}>
                        <Space direction="vertical">
                          {target.affixes.map((affix) => (
                            <Radio key={affix.key} value={affix.key} disabled={affix.rebuilt === true}>
                              {`${affix.display}${affix.rebuilt === true ? '（已重铸，不可再重铸）' : ''}`}
                            </Radio>
                          ))}
                        </Space>
                      </Radio.Group>
                      <ActionBar
                        actions={[
                          {
                            key: 'rebuild',
                            label: '重铸所选词缀',
                            type: 'primary',
                            disabled: affixKey === null,
                            onClick: () => {
                              if (affixKey === null) return;
                              modal.confirm({
                                title: '重铸该词缀？',
                                content: '重铸会重新随机该条词缀的数值，费用由服务端结算。',
                                okText: '重铸',
                                cancelText: '取消',
                                onOk: () => produce.rebuild(target.id, affixKey),
                              });
                            },
                          },
                        ]}
                      />
                    </Flex>
                  )}
                </Flex>
              ),
            },
            {
              key: 'decompose',
              label: '分解',
              children: (
                <Flex vertical gap={token.paddingSM}>
                  {targetPicker()}
                  <ActionBar
                    actions={[
                      {
                        key: 'decompose-one',
                        label: '分解选中物品',
                        danger: true,
                        disabled: target === null,
                        onClick: () => {
                          if (target === null) return;
                          modal.confirm({
                            title: `分解「${target.name}」？`,
                            content: '分解不可撤销，产出材料由服务端结算。',
                            okText: '分解',
                            okButtonProps: { danger: true },
                            cancelText: '取消',
                            onOk: () => produce.decompose({ id: target.id }),
                          });
                        },
                      },
                      {
                        key: 'decompose-build',
                        label: `分解建造背包（${inventory.buildInventory.length} 件）`,
                        danger: true,
                        disabled: inventory.buildInventory.length === 0,
                        onClick: () => {
                          const ids = inventory.buildInventory.map((slot) => slot.id);
                          modal.confirm({
                            title: `分解建造背包中的 ${ids.length} 件物品？`,
                            content: '分解不可撤销。',
                            okText: '全部分解',
                            okButtonProps: { danger: true },
                            cancelText: '取消',
                            onOk: () => produce.decompose({ ids }),
                          });
                        },
                      },
                    ]}
                  />
                  {produce.lastDecompose === null ? null : (
                    <StatList
                      items={[
                        { key: 'diamonds', label: '返还神力', value: formatAmount(produce.lastDecompose.diamonds) },
                        {
                          key: 'materials',
                          label: '获得材料',
                          value:
                            produce.lastDecompose.materials.length === 0
                              ? '无'
                              : produce.lastDecompose.materials
                                  .map((entry) => `${entry.key}×${entry.count}`)
                                  .join('、'),
                        },
                      ]}
                    />
                  )}
                </Flex>
              ),
            },
            {
              key: 'medicine',
              label: '炼金',
              children: (
                <Flex vertical gap={token.paddingSM} data-testid="medicine">
                  {medicine === null ? (
                    <EmptyState description="尚未加载炼金状态" actionText="加载" onAction={() => void produce.load()} />
                  ) : (
                    <>
                      <StatList
                        items={[
                          { key: 'exp', label: '炼金经验', value: `${formatAmount(medicine.exp)} / ${formatAmount(medicine.maxExp)}` },
                          { key: 'bowel', label: '坩埚等级', value: formatAmount(medicine.bowelLevel) },
                          { key: 'effect', label: '转化倍率', value: medicine.bowelEffect.toFixed(2) },
                          { key: 'price', label: '升级价格', value: formatAmount(medicine.bowelUpgradePrice) },
                          ...Object.entries(medicine.levels).map(([key, level]) => ({
                            key: `lv:${key}`,
                            label: `药剂 ${key}`,
                            value: formatAmount(level),
                          })),
                        ]}
                      />
                      <Space wrap>
                        <Input
                          placeholder="材料 key（如 bone）"
                          value={material}
                          onChange={(event) => setMaterial(event.target.value)}
                          style={{ width: 220 }}
                        />
                        <QuantityInput value={materialCount} max={999} onChange={setMaterialCount} />
                        <Button
                          type="primary"
                          disabled={material.trim() === ''}
                          onClick={() => void produce.medicineUse(material.trim(), materialCount)}
                          data-testid="medicine-use"
                        >
                          投入材料
                        </Button>
                      </Space>
                      <ActionBar
                        actions={[
                          {
                            key: 'reset-gold',
                            label: '金币重置药剂',
                            onClick: () =>
                              modal.confirm({
                                title: '用金币重置药剂？',
                                content: '费用由服务端结算。',
                                okText: '重置',
                                cancelText: '取消',
                                onOk: () => produce.medicineReset('gold'),
                              }),
                          },
                          {
                            key: 'reset-diamonds',
                            label: '神力重置药剂',
                            danger: true,
                            onClick: () =>
                              modal.confirm({
                                title: '用神力重置药剂？',
                                content: '费用由服务端结算。',
                                okText: '重置',
                                okButtonProps: { danger: true },
                                cancelText: '取消',
                                onOk: () => produce.medicineReset('diamonds'),
                              }),
                          },
                        ]}
                      />
                    </>
                  )}
                </Flex>
              ),
            },
          ]}
        />
      </SectionCard>
    </Flex>
  );
});
