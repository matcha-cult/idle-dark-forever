/**
 * SkillsPanel —— 技能（原版 Tab「技能」）：职业切换 + 主动技能 + 强化（被动）。
 *
 * 三段结构：
 *   1. 职业：当前职业的等级 / 巅峰 / 经验（服务端 `CareerProgressDto`），可切换；
 *   2. 主动技能：可学 / 已选 / 槽位顺序（`SkillDto.selected` + `PlayerStateDto.selectedSkills`）；
 *   3. 强化：被动列表（`EnhanceDto`）。
 *
 * 纪律：解锁条件（`unlocked` / `unlockLevel` / `usable`）全部由服务端判定，本面板只渲染与发意图。
 */
import { observer } from 'mobx-react-lite';
import { Button, Flex, Progress, Space, Tag, Tooltip, Typography, theme } from 'antd';
import { ActionBar, EmptyState, SectionCard, StatList, formatAmount } from '@idle-dark/ui-kit';
import { useRootStore } from '../../../app/root-context.js';

export const SkillsPanel = observer(function SkillsPanel() {
  const root = useRootStore();
  const { career, player } = root;
  const { token } = theme.useToken();

  const current = career.careers.find((entry) => entry.key === career.currentCareer) ?? null;
  const selectedSkills = player.selectedSkills;

  return (
    <Flex vertical gap={token.paddingSM} data-testid="skills-panel">
      <SectionCard
        title="职业"
        extra={<Button onClick={() => void career.load()} data-testid="skills-refresh">刷新</Button>}
      >
        {career.careers.length === 0 ? (
          <EmptyState description="尚未加载职业数据" />
        ) : (
          <Flex vertical gap={token.paddingXS}>
            <Flex wrap gap={token.paddingXS}>
              {career.careers.map((entry) => {
                const active = entry.key === career.currentCareer;
                const percent =
                  entry.maxExp > 0 ? Math.min(100, Math.max(0, (entry.exp / entry.maxExp) * 100)) : 0;
                return (
                  <Flex
                    key={entry.key}
                    vertical
                    gap={2}
                    style={{
                      minWidth: 220,
                      padding: token.paddingXS,
                      border: `1px solid ${active ? token.colorPrimary : token.colorBorderSecondary}`,
                      borderRadius: token.borderRadiusSM,
                      background: active ? token.colorPrimaryBg : token.colorBgContainer,
                    }}
                    data-testid={`career-${entry.key}`}
                  >
                    <Flex justify="space-between" align="center">
                      <Typography.Text strong>{entry.name}</Typography.Text>
                      {active ? <Tag color="blue">当前</Tag> : null}
                    </Flex>
                    <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                      {`Lv.${entry.level}/${entry.maxLevel}${entry.peakLevel > 0 ? ` · 巅峰 ${entry.peakLevel}` : ''}`}
                    </Typography.Text>
                    <Progress
                      percent={percent}
                      size={{ width: 180, height: 6 }}
                      showInfo={false}
                      strokeColor={token.colorPrimary}
                      trailColor={token.colorFillSecondary}
                      style={{ marginBottom: 0 }}
                    />
                    <Button
                      size="small"
                      disabled={active}
                      onClick={() => void career.switchCareer(entry.key)}
                      data-testid={`career-switch-${entry.key}`}
                    >
                      {active ? '使用中' : '切换'}
                    </Button>
                  </Flex>
                );
              })}
            </Flex>
            {current === null ? null : (
              <StatList
                items={[
                  { key: 'level', label: '当前等级', value: formatAmount(current.level) },
                  { key: 'peak', label: '巅峰等级', value: formatAmount(current.peakLevel) },
                  {
                    key: 'exp',
                    label: '经验',
                    value: `${formatAmount(current.exp)} / ${formatAmount(current.maxExp)}`,
                  },
                  {
                    key: 'peakExp',
                    label: '巅峰经验',
                    value: `${formatAmount(current.peakExp)} / ${formatAmount(current.maxPeakExp)}`,
                  },
                ]}
              />
            )}
          </Flex>
        )}
      </SectionCard>

      <SectionCard
        title="主动技能"
        extra={
          <Typography.Text type="secondary">
            {`已装备 ${selectedSkills.length} / ${career.maxSkillCount}（顺序即优先级）`}
          </Typography.Text>
        }
      >
        {career.skills.length === 0 ? (
          <EmptyState description="尚未加载技能" />
        ) : (
          <Flex vertical gap={token.paddingXS}>
            <Space wrap data-testid="skills-selected">
              {selectedSkills.length === 0 ? (
                <Typography.Text type="secondary">未装备任何技能</Typography.Text>
              ) : (
                selectedSkills.map((key, index) => {
                  const skill = career.skills.find((entry) => entry.key === key);
                  return (
                    <Tag key={key} color="blue">
                      {`${index + 1}. ${skill?.name ?? key}`}
                    </Tag>
                  );
                })
              )}
            </Space>

            {career.skills.map((skill) => (
              <Flex
                key={skill.key}
                align="center"
                gap={token.marginXS}
                wrap
                style={{ opacity: skill.unlocked ? 1 : 0.6 }}
                data-testid={`skill-${skill.key}`}
              >
                <Space wrap>
                  <Typography.Text strong>{skill.name}</Typography.Text>
                  {skill.isAttack ? <Tag color="red">攻击</Tag> : <Tag>辅助</Tag>}
                  <Tag>{`Lv.${skill.level}`}</Tag>
                  <Tag>{skill.group}</Tag>
                  {skill.unlocked ? null : (
                    <Tooltip title={`需要职业等级 ${skill.unlockLevel}`}>
                      <Tag color="default">{`未解锁（Lv.${skill.unlockLevel}）`}</Tag>
                    </Tooltip>
                  )}
                  {skill.selected ? <Tag color="green">已装备</Tag> : null}
                  {skill.coolDown > 0 ? (
                    <Typography.Text type="secondary">{`冷却 ${skill.coolDown}s`}</Typography.Text>
                  ) : null}
                </Space>
                <Typography.Text type="secondary" style={{ flex: '1 1 220px', minWidth: 160 }}>
                  {skill.description}
                </Typography.Text>
                <Button
                  type={skill.selected ? 'default' : 'primary'}
                  disabled={!skill.unlocked}
                  onClick={() =>
                    skill.selected
                      ? void career.unselectSkill(skill.key)
                      : void career.selectSkill(skill.key)
                  }
                  data-testid={`skill-toggle-${skill.key}`}
                >
                  {skill.selected ? '卸下' : '装备'}
                </Button>
              </Flex>
            ))}
          </Flex>
        )}
      </SectionCard>

      <SectionCard
        title="强化（被动）"
        extra={
          <Typography.Text type="secondary">
            {`已装备 ${career.selectedEnhances.length} / ${career.maxEnhanceCount}`}
          </Typography.Text>
        }
      >
        {career.enhances.length === 0 ? (
          <EmptyState description="尚未加载强化" />
        ) : (
          <Flex vertical gap={token.paddingXS}>
            {career.enhances.map((enhance) => (
              <Flex
                key={enhance.key}
                align="center"
                gap={token.marginXS}
                wrap
                style={{ opacity: enhance.unlocked ? 1 : 0.6 }}
                data-testid={`enhance-${enhance.key}`}
              >
                <Space wrap>
                  <Typography.Text strong>{enhance.name}</Typography.Text>
                  {enhance.unlocked ? null : <Tag>{`未解锁（Lv.${enhance.unlockLevel}）`}</Tag>}
                  {enhance.selected ? <Tag color="green">已装备</Tag> : null}
                </Space>
                <Typography.Text type="secondary" style={{ flex: '1 1 220px', minWidth: 160 }}>
                  {enhance.description}
                </Typography.Text>
                <Button
                  disabled={!enhance.unlocked}
                  onClick={() =>
                    enhance.selected
                      ? void career.unselectEnhance(enhance.key)
                      : void career.selectEnhance(enhance.key)
                  }
                  data-testid={`enhance-toggle-${enhance.key}`}
                >
                  {enhance.selected ? '卸下' : '装备'}
                </Button>
              </Flex>
            ))}
            <ActionBar actions={[{ key: 'refresh', label: '刷新技能', onClick: () => void career.load() }]} />
          </Flex>
        )}
      </SectionCard>
    </Flex>
  );
});
