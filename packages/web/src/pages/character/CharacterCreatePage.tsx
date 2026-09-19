/**
 * CharacterCreatePage —— 建角。
 *
 * 账号下没有任何角色时展示。角色列表 / 建角走 WS（`player` 段），
 * 提交成功后由 `RootStore.createCharacter` 直接进入新角色。
 *
 * ⚠️ 可选角色目前是前端常量（原版数据只有 `Eyer` / `Aleanor` 两个 role）：
 * 服务端应提供一个「可选角色」只读接口，届时改为拉取（见交付报告「已知限制」）。
 */
import { observer } from 'mobx-react-lite';
import { Alert, Button, Card, Flex, Form, Input, Select, Typography } from 'antd';
import { useState } from 'react';
import { useRootStore } from '../../app/root-context.js';
import { AppThemeToggle } from '../../theme/theme-root.js';

/** 可选角色（`key` 是服务端的 role key）。 */
export const ROLE_OPTIONS: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'Eyer', name: '艾尔（近战 · 坚韧）' },
  { key: 'Aleanor', name: '亚莲娜（远程 · 爆发）' },
];

interface CharacterFormValues {
  name?: string;
  role?: string;
}

export interface CharacterCreatePageProps {
  /** 账号已有角色时，允许返回选角页（App 持有该开关）。 */
  onCancel?: () => void;
}

export const CharacterCreatePage = observer(function CharacterCreatePage({ onCancel }: CharacterCreatePageProps) {
  const root = useRootStore();
  const [submitting, setSubmitting] = useState(false);

  const submit = async (values: CharacterFormValues): Promise<void> => {
    const name = (values.name ?? '').trim();
    const role = values.role ?? ROLE_OPTIONS[0]?.key ?? 'Eyer';
    if (name.length === 0) return;
    setSubmitting(true);
    try {
      await root.createCharacter(name, role);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Flex
      align="center"
      justify="center"
      vertical
      gap="middle"
      style={{ minHeight: '100vh', padding: 16 }}
      data-testid="character-create-page"
    >
      <Card style={{ width: 460 }} variant="outlined">
        <Flex justify="space-between" align="flex-start">
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            点燃第一簇火
          </Typography.Title>
          <AppThemeToggle />
        </Flex>
        <Typography.Paragraph type="secondary" data-testid="character-create-account">
          账号：{root.session.me?.displayName ?? root.session.me?.userId ?? '—'}（尚未创建角色）
        </Typography.Paragraph>

        <Form<CharacterFormValues>
          layout="vertical"
          initialValues={{ role: ROLE_OPTIONS[0]?.key }}
          onFinish={(values) => void submit(values)}
          disabled={submitting}
          data-testid="character-create-form"
        >
          <Form.Item
            name="name"
            label="角色名"
            rules={[{ required: true, max: 50, message: '角色名不超过 50 字' }]}
          >
            <Input placeholder="例如：无名守夜人" maxLength={50} />
          </Form.Item>
          <Form.Item name="role" label="命途" rules={[{ required: true }]}>
            <Select
              options={ROLE_OPTIONS.map((role) => ({ label: role.name, value: role.key }))}
              data-testid="character-create-role"
            />
          </Form.Item>

          {root.session.errorMessage === null ? null : (
            <Alert
              type="error"
              showIcon
              title={root.session.errorMessage}
              data-testid="character-create-error"
              style={{ marginBottom: 12 }}
            />
          )}

          <Button type="primary" htmlType="submit" block loading={submitting} data-testid="character-create-submit">
            创建并进入
          </Button>
        </Form>

        <Button type="link" block onClick={() => root.logout()} data-testid="character-create-logout">
          退出登录
        </Button>
        {onCancel === undefined ? null : (
          <Button type="link" block onClick={onCancel} data-testid="character-create-cancel">
            返回选角
          </Button>
        )}
      </Card>
    </Flex>
  );
});
