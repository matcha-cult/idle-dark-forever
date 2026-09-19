/**
 * LoginPage —— 登录（REST `POST /api/auth/login`）。
 *
 * 容器层：表单交给 antd `Form`，提交后交给 `RootStore.login`（store 负责 REST 调用、
 * token 落盘、`?token=` 连 WS 与并发拉面板）。
 */
import { observer } from 'mobx-react-lite';
import { Alert, Button, Card, Flex, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useRootStore } from '../../app/root-context.js';
import { AppThemeToggle } from '../../theme/theme-root.js';

interface LoginFormValues {
  username?: string;
  password?: string;
}

export const LoginPage = observer(function LoginPage() {
  const root = useRootStore();
  const [submitting, setSubmitting] = useState(false);

  const submit = async (values: LoginFormValues): Promise<void> => {
    const username = (values.username ?? '').trim();
    const password = values.password ?? '';
    if (username.length === 0 || password.length === 0) return;
    setSubmitting(true);
    try {
      await root.login(username, password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Flex align="center" justify="center" vertical gap="middle" style={{ minHeight: '100vh', padding: 16 }} data-testid="login-page">
      <Card style={{ width: 420 }} variant="outlined">
        <Flex justify="space-between" align="flex-start">
          <Typography.Title level={4} data-testid="login-title" style={{ marginTop: 0 }}>
            永夜 · 重制
          </Typography.Title>
          <AppThemeToggle />
        </Flex>
        <Typography.Paragraph type="secondary">
          登录后经 <Typography.Text code>?token=</Typography.Text> 建立 WS 连接；战斗、掉落、成长全部由服务端结算。
        </Typography.Paragraph>

        <Form<LoginFormValues>
          layout="vertical"
          onFinish={(values) => void submit(values)}
          disabled={submitting}
          data-testid="login-form"
        >
          <Form.Item
            name="username"
            label="账号"
            rules={[{ required: true, min: 3, max: 50, message: '账号长度 3–50 字符' }]}
          >
            <Input placeholder="例如：nightwalker" autoComplete="username" maxLength={50} />
          </Form.Item>
          <Form.Item
            name="password"
            label="口令"
            rules={[{ required: true, min: 6, message: '口令至少 6 位' }]}
          >
            <Input.Password placeholder="••••••" autoComplete="current-password" />
          </Form.Item>

          {root.session.errorMessage === null ? null : (
            <Alert
              type="error"
              showIcon
              title={root.session.errorMessage}
              data-testid="login-error"
              style={{ marginBottom: 12 }}
            />
          )}

          <Button type="primary" htmlType="submit" block loading={submitting} data-testid="login-submit">
            进入永夜
          </Button>
        </Form>
      </Card>
      <Typography.Text type="secondary">
        后端：REST <Typography.Text code>/api</Typography.Text>（认证） · WS{' '}
        <Typography.Text code>/ws</Typography.Text>（全部游戏交互）
      </Typography.Text>
    </Flex>
  );
});
