/**
 * ChaosPanel —— 混沌仪（无尽，W6）。
 *
 * 玩家在这里回答三个问题：
 *   1. 我能不能用？→ 解锁状态（通关全部野外 BOSS）；
 *   2. 我有哪些钥石？→ T1~T16 阶位列表 + 服务端下发的钥石持有量；
 *   3. 怎么挂机？→ 编排钥石序列 + 失败选项 + 开始/停止。
 *
 * 纪律：本面板**不做任何数值推导**（等级、数量、当前阶全部来自 `ChaosStateDto`），
 * 只维护「序列草稿」这一份 UI 意图。
 */
import { observer } from 'mobx-react-lite';
import { Button, Flex, Radio, Space, Tag, Typography, theme } from 'antd';
import type { ChaosFailMode, ChaosTierDto } from '@idle-dark/protocol';
import { ActionBar, EmptyState, SectionCard } from '@idle-dark/ui-kit';
import { useRootStore } from '../../../app/root-context.js';

const FAIL_MODE_OPTIONS: ReadonlyArray<{ value: ChaosFailMode; label: string }> = [
  { value: 'normal', label: '回普通地图挂机' },
  { value: 'continue', label: '继续挑战' },
];

export const ChaosPanel = observer(function ChaosPanel() {
  const root = useRootStore();
  const chaos = root.chaos;
  const { token } = theme.useToken();
  const state = chaos.state;

  const tierOfKeystone = (keystoneKey: string): ChaosTierDto | undefined =>
    state?.tiers.find((tier) => tier.keystoneKey === keystoneKey);

  if (state === null) {
    return (
      <SectionCard title="混沌仪">
        <EmptyState
          description="混沌仪数据加载中"
          hint="若长时间为空，请检查与服务端的连接"
        />
      </SectionCard>
    );
  }

  if (!state.unlocked) {
    return (
      <SectionCard title="混沌仪">
        <EmptyState
          description="混沌仪尚未解锁"
          hint="通关全部野外地图 BOSS 后，混沌仪会自动点亮。"
        />
      </SectionCard>
    );
  }

  return (
    <Flex vertical gap={token.paddingSM} data-testid="chaos-panel">
      <SectionCard
        title="混沌仪"
        extra={
          <Space>
            <Typography.Text type="secondary">
              {state.active
                ? `挑战中：T${state.currentTier ?? '-'}${state.retry > 0 ? `（连续失败 ${state.retry}）` : ''}`
                : '未运行'}
            </Typography.Text>
            {state.active ? (
              <Button danger onClick={() => void chaos.stop()} loading={chaos.busy} data-testid="chaos-stop">
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                onClick={() => void chaos.start()}
                loading={chaos.busy}
                data-testid="chaos-start"
              >
                开始挑战
              </Button>
            )}
          </Space>
        }
      >
        <Flex vertical gap={token.paddingXS}>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {`混沌钥石按序列逐个消耗：投入 1 把 → 打对应 T 阶 → 结算 → 取下一把（全程挂机自动推进）。`}
          </Typography.Text>
          <Flex wrap gap={token.paddingXS}>
            {state.tiers.map((tier) => {
              const current = state.active && state.currentTier === tier.tier;
              return (
                <Flex
                  key={tier.mapKey}
                  vertical
                  gap={2}
                  style={{
                    minWidth: 168,
                    padding: token.paddingXS,
                    border: `1px solid ${current ? token.colorPrimary : token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusSM,
                    background: current ? token.colorPrimaryBg : token.colorBgContainer,
                  }}
                  data-testid={`chaos-tier-${tier.tier}`}
                >
                  <Flex justify="space-between" align="center" gap={token.marginXXS}>
                    <Typography.Text strong>{tier.name}</Typography.Text>
                    <Tag color={tier.keystoneCount > 0 ? 'green' : 'default'}>{`钥石 ${tier.keystoneCount}`}</Tag>
                  </Flex>
                  <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                    {`Lv.${tier.level}`}
                  </Typography.Text>
                  <Button
                    disabled={!chaos.canAddMore}
                    onClick={() => chaos.addToSequence(tier.keystoneKey)}
                    data-testid={`chaos-add-${tier.tier}`}
                  >
                    加入序列
                  </Button>
                </Flex>
              );
            })}
          </Flex>
        </Flex>
      </SectionCard>

      <SectionCard
        title="钥石序列"
        extra={
          <Space>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {`${chaos.sequenceDraft.length} / ${chaos.maxSequenceLength}${chaos.dirty ? '（未保存）' : ''}`}
            </Typography.Text>
            <Button onClick={() => chaos.clearSequence()} disabled={chaos.sequenceDraft.length === 0}>
              清空
            </Button>
            <Button
              type="primary"
              onClick={() => void chaos.saveSequence()}
              loading={chaos.saving}
              disabled={!chaos.dirty}
              data-testid="chaos-save-sequence"
            >
              保存序列
            </Button>
          </Space>
        }
      >
        {chaos.sequenceDraft.length === 0 ? (
          <EmptyState description="序列为空" hint="从上方 T 阶列表点「加入序列」，可重复放同阶钥石。" />
        ) : (
          <Flex vertical gap={token.paddingXXS} data-testid="chaos-sequence">
            {chaos.sequenceDraft.map((keystoneKey, index) => {
              const tier = tierOfKeystone(keystoneKey);
              return (
                <Flex
                  key={`${keystoneKey}-${index}`}
                  align="center"
                  gap={token.paddingXS}
                  style={{
                    padding: `${token.paddingXXS}px ${token.paddingXS}px`,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusSM,
                  }}
                >
                  <Typography.Text type="secondary" style={{ width: 28 }}>
                    {`#${index + 1}`}
                  </Typography.Text>
                  <Typography.Text strong>{tier?.name ?? keystoneKey}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {tier === undefined ? keystoneKey : `Lv.${tier.level}`}
                  </Typography.Text>
                  <Space style={{ marginInlineStart: 'auto' }}>
                    <Button
                      disabled={index === 0}
                      onClick={() => chaos.moveInSequence(index, -1)}
                      data-testid={`chaos-up-${index}`}
                    >
                      上移
                    </Button>
                    <Button
                      disabled={index === chaos.sequenceDraft.length - 1}
                      onClick={() => chaos.moveInSequence(index, 1)}
                      data-testid={`chaos-down-${index}`}
                    >
                      下移
                    </Button>
                    <Button danger onClick={() => chaos.removeFromSequence(index)} data-testid={`chaos-remove-${index}`}>
                      移除
                    </Button>
                  </Space>
                </Flex>
              );
            })}
          </Flex>
        )}
      </SectionCard>

      <SectionCard title="失败选项">
        <Flex vertical gap={token.paddingXS}>
          <Radio.Group
            optionType="button"
            value={state.failMode}
            options={FAIL_MODE_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
            onChange={(event) => void chaos.setFailMode(event.target.value as ChaosFailMode)}
            data-testid="chaos-fail-mode"
          />
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {state.failMode === 'normal'
              ? '挑战失败即中断序列，角色回到普通地图继续挂机。'
              : '挑战失败会重试当前钥石，连续失败 3 次后跳到序列下一把；缺少下一把钥石时干净停止。'}
          </Typography.Text>
          <ActionBar
            actions={[
              {
                key: 'chaos-refresh',
                label: '刷新状态',
                tooltip: '重新向服务端拉取混沌仪状态',
                onClick: () => void chaos.load(),
              },
            ]}
          />
        </Flex>
      </SectionCard>
    </Flex>
  );
});
