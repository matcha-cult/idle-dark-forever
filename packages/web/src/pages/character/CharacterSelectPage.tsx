/**
 * CharacterSelectPage —— 选角（已有角色、但尚未进入游戏时展示）。
 *
 * 数据来自 `SessionStore.players`（WS `(player, list)` 的服务端权威元数据）；
 * 「进入」调用 `RootStore.selectCharacter`（会拉完整角色态并并发拉面板）。
 */
import { observer } from 'mobx-react-lite';
import { App as AntApp, Button, Card, Empty, Flex, Space, Spin, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useRootStore } from '../../app/root-context.js';
import { AppThemeToggle } from '../../theme/theme-root.js';

export interface CharacterSelectPageProps {
  /** 请求切到建角页（App 持有该开关）。 */
  onCreateNew: () => void;
}

export const CharacterSelectPage = observer(function CharacterSelectPage({ onCreateNew }: CharacterSelectPageProps) {
  const root = useRootStore();
  const { modal } = AntApp.useApp();
  const [enteringKey, setEnteringKey] = useState<string | null>(null);

  const enter = async (key: string): Promise<void> => {
    setEnteringKey(key);
    try {
      await root.selectCharacter(key);
    } finally {
      setEnteringKey(null);
    }
  };

  const remove = (key: string, name: string): void => {
    modal.confirm({
      title: `删除角色「${name}」？`,
      content: '删除后不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => root.session.removePlayer(key),
    });
  };

  return (
    <Flex
      align="center"
      justify="center"
      vertical
      gap="middle"
      style={{ minHeight: '100vh', padding: 16 }}
      data-testid="character-select-page"
    >
      <Card style={{ width: 560 }} variant="outlined" title="选择角色" extra={<AppThemeToggle />}>
        {root.session.playersLoading ? (
          <Flex justify="center" style={{ padding: 24 }}>
            <Spin />
          </Flex>
        ) : root.session.players.length === 0 ? (
          <Empty description="还没有角色" />
        ) : (
          <Flex vertical gap={8}>
            {root.session.players.map((player) => (
              <Flex
                key={player.key}
                align="center"
                justify="space-between"
                wrap
                gap={8}
                data-testid={`character-item-${player.key}`}
                style={{ padding: 8, border: '1px solid rgba(128,128,128,0.25)', borderRadius: 6 }}
              >
                <Flex vertical gap={2} style={{ minWidth: 0 }}>
                  <Space wrap>
                    <Typography.Text strong>{player.name}</Typography.Text>
                    <Tag>{player.roleName}</Tag>
                    <Tag color="blue">{`Lv.${player.level}`}</Tag>
                    {player.inBattle ? <Tag color="red">战斗中</Tag> : null}
                  </Space>
                  <Typography.Text type="secondary">{`职业：${player.currentCareerName || '—'}`}</Typography.Text>
                </Flex>
                <Space>
                  <Button
                    type="primary"
                    loading={enteringKey === player.key}
                    onClick={() => void enter(player.key)}
                    data-testid={`character-enter-${player.key}`}
                  >
                    进入
                  </Button>
                  <Button
                    danger
                    onClick={() => remove(player.key, player.name)}
                    data-testid={`character-remove-${player.key}`}
                  >
                    删除
                  </Button>
                </Space>
              </Flex>
            ))}
          </Flex>
        )}

        <Flex gap={8} style={{ marginTop: 12 }}>
          <Button onClick={onCreateNew} data-testid="character-select-create">
            新建角色
          </Button>
          <Button onClick={() => root.logout()} data-testid="character-select-logout">
            退出登录
          </Button>
        </Flex>
      </Card>
    </Flex>
  );
});
