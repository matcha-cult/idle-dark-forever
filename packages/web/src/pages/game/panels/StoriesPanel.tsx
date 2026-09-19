/**
 * StoriesPanel —— 故事（原版 Tab「故事」）：剧情列表 + 逐句播放。
 *
 * 左侧目录来自 `(story, list)` 的 `StoryDto`（状态：未开启 / 进行中 / 已完成，全部由服务端判定）；
 * 右侧播放的是 `(story, play)` 返回的 **DSL 节点**，本面板只推进「播放游标」，
 * 不解释节点语义、不推导任务数值。
 */
import { observer } from 'mobx-react-lite';
import { Button, Col, Flex, Progress, Row, Space, Tag, Typography, theme } from 'antd';
import type { StoryDto } from '@idle-dark/protocol';
import { ActionBar, EmptyState, SectionCard } from '@idle-dark/ui-kit';
import { useRootStore } from '../../../app/root-context.js';

/** 剧情状态 → 中文 + 颜色（纯展示映射）。 */
const STATUS_META: Readonly<Record<StoryDto['status'], { label: string; color: string }>> = {
  none: { label: '未开启', color: 'default' },
  task: { label: '进行中', color: 'processing' },
  done: { label: '已完成', color: 'success' },
};

/** DSL 节点类型 → 中文标签（未知类型原样展示 type）。 */
const NODE_LABELS: Readonly<Record<string, string>> = {
  text: '旁白',
  say: '对话',
  talk: '对话',
  choice: '选择',
  battle: '战斗',
  award: '奖励',
  scene: '场景',
  end: '结束',
};

export const StoriesPanel = observer(function StoriesPanel() {
  const root = useRootStore();
  const { story } = root;
  const { token } = theme.useToken();

  const current = story.current;
  const node = story.currentNode;
  const total = story.nodes.length;
  const percent = total === 0 ? 0 : Math.round(((story.cursor + (node === null ? 0 : 1)) / total) * 100);

  const open = (entry: StoryDto): void => {
    if (!entry.canStart && entry.status === 'none') return;
    void story.open(entry.key);
  };

  return (
    <Flex vertical gap={token.paddingSM} data-testid="stories-panel">
      <SectionCard
        title="故事"
        extra={<Button onClick={() => void story.load()} data-testid="stories-refresh">刷新</Button>}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Flex vertical gap={token.marginXS} data-testid="stories-list">
              {story.stories.length === 0 ? (
                <EmptyState description="暂无剧情" hint="完成战斗与任务后服务端会解锁新篇章" />
              ) : (
                story.stories.map((entry) => {
                  const meta = STATUS_META[entry.status];
                  const active = entry.key === story.play?.key;
                  return (
                    <Flex
                      key={entry.key}
                      vertical
                      gap={2}
                      onClick={() => open(entry)}
                      data-testid={`story-${entry.key}`}
                      style={{
                        padding: token.paddingXS,
                        border: `1px solid ${active ? token.colorPrimary : token.colorBorderSecondary}`,
                        borderRadius: token.borderRadiusSM,
                        background: active ? token.colorPrimaryBg : token.colorBgContainer,
                        cursor: entry.canStart ? 'pointer' : 'not-allowed',
                        opacity: entry.canStart ? 1 : 0.6,
                      }}
                    >
                      <Flex justify="space-between" align="center" gap={token.marginXXS}>
                        <Typography.Text strong>{entry.name}</Typography.Text>
                        <Tag color={meta.color}>{meta.label}</Tag>
                      </Flex>
                      <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                        {entry.group}
                      </Typography.Text>
                      {entry.status === 'task' && entry.taskType === 'kill' ? (
                        <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary }}>
                          {`击杀 ${entry.enemy ?? '目标'}：剩 ${entry.remaining ?? '?'}${entry.killCount === undefined ? '' : ` / ${entry.killCount}`}`}
                        </Typography.Text>
                      ) : null}
                      {entry.status === 'task' && entry.taskType === 'purchase' ? (
                        <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary }}>
                          {`需要花费 ${entry.price ?? '?'} 金币`}
                        </Typography.Text>
                      ) : null}
                      {entry.lockedReason === null ? null : (
                        <Typography.Text style={{ fontSize: token.fontSizeSM, color: token.colorTextTertiary }}>
                          {entry.lockedReason}
                        </Typography.Text>
                      )}
                    </Flex>
                  );
                })
              )}
            </Flex>
          </Col>

          <Col xs={24} md={16}>
            {story.play === null ? (
              <EmptyState description="从左侧选择一段剧情开始阅读" height={240} />
            ) : (
              <Flex vertical gap={token.marginXS} data-testid="story-play">
                <Flex justify="space-between" align="center" wrap gap={token.marginXS}>
                  <Space wrap>
                    <Typography.Text strong>{story.play.name}</Typography.Text>
                    {current === null ? null : <Tag color={STATUS_META[current.status].color}>{STATUS_META[current.status].label}</Tag>}
                  </Space>
                  <Typography.Text type="secondary">{`${story.cursor + (node === null ? 0 : 1)} / ${total}`}</Typography.Text>
                </Flex>

                <Progress
                  percent={percent}
                  showInfo={false}
                  strokeColor={token.colorPrimary}
                  trailColor={token.colorFillSecondary}
                  style={{ marginBottom: 0 }}
                />

                {node === null ? (
                  <EmptyState description="剧本已播放完" height={160} />
                ) : (
                  <Flex
                    vertical
                    gap={token.marginXXS}
                    data-testid="story-node"
                    style={{
                      minHeight: 160,
                      padding: token.padding,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadiusSM,
                      background: token.colorFillQuaternary,
                    }}
                  >
                    <Tag>{NODE_LABELS[node.type] ?? node.type}</Tag>
                    <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                      {node.args.length === 0 ? '（空节点）' : node.args.join(' ')}
                    </Typography.Paragraph>
                  </Flex>
                )}

                <ActionBar
                  actions={[
                    { key: 'prev', label: '上一句', disabled: story.cursor === 0, onClick: () => story.prev() },
                    {
                      key: 'next',
                      label: '下一句',
                      type: 'primary',
                      disabled: node === null || story.isLastNode,
                      onClick: () => story.next(),
                    },
                    {
                      key: 'finish',
                      label: '完成剧情',
                      disabled: current === null || current.status === 'done',
                      onClick: () => story.finish(story.play!.key),
                    },
                    { key: 'close', label: '关闭', onClick: () => story.close() },
                  ]}
                />
              </Flex>
            )}
          </Col>
        </Row>
      </SectionCard>
    </Flex>
  );
});
