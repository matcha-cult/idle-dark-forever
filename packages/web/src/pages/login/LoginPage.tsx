/**
 * LoginPage —— 登录 / 注册（REST `POST /api/auth/login` | `/api/auth/register`）。
 *
 * 容器层：表单交给 antd `Form`，提交后交给 `RootStore.login` / `RootStore.register`
 * （store 负责 REST 调用、token 落盘、`?token=` 连 WS 与并发拉账号/角色列表）。
 *
 * 注册成功后服务端**直接签发 token**，因此与登录走完全相同的后续编排 ——
 * 新账号没有角色，会自然落到建角页。
 */
import { observer } from 'mobx-react-lite';
import { Alert, Button, Card, Flex, Form, Input, Segmented, Typography } from 'antd';
import { useState } from 'react';
import { useRootStore } from '../../app/root-context.js';
import { AppThemeToggle } from '../../theme/theme-root.js';
import {
  AUTH_MESSAGES,
  AUTH_MODE_LOGIN,
  AUTH_MODE_REGISTER,
  AUTH_LIMITS,
  normalizeUsername,
  validateAuthForm,
  type AuthFormValues,
  type AuthMode,
} from './auth-form.js';

const MODE_OPTIONS = [
  { label: '登录', value: AUTH_MODE_LOGIN },
  { label: '注册', value: AUTH_MODE_REGISTER },
];

export const LoginPage = observer(function LoginPage() {
  const root = useRootStore();
  const [mode, setMode] = useState<AuthMode>(AUTH_MODE_LOGIN);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isRegister = mode === AUTH_MODE_REGISTER;

  const submit = async (values: AuthFormValues): Promise<void> => {
    // 行内 rules 之外再做一次提交校验：两处共用同一组常量，不会漂移
    const invalid = validateAuthForm(mode, values);
    if (invalid !== null) {
      setLocalError(invalid);
      return;
    }
    setLocalError(null);
    setSubmitting(true);
    try {
      const username = normalizeUsername(values.username);
      const password = values.password ?? '';
      await (isRegister ? root.register(username, password) : root.login(username, password));
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: AuthMode): void => {
    setMode(next);
    setLocalError(null);
    // 切换模式时清掉上一个模式的报错，避免「注册失败」残留在登录视图上
    root.session.clearError();
  };

  const errorMessage = localError ?? root.session.errorMessage;

  return (
    <Flex align="center" justify="center" vertical gap="middle" style={{ minHeight: '100vh', padding: 16 }} data-testid="login-page">
      <Card style={{ width: 420 }} variant="outlined">
        <Flex justify="space-between" align="flex-start">
          <Typography.Title level={4} data-testid="login-title" style={{ marginTop: 0 }}>
            永夜 · 重制
          </Typography.Title>
          <AppThemeToggle />
        </Flex>

        <Segmented<AuthMode>
          block
          options={MODE_OPTIONS}
          value={mode}
          onChange={switchMode}
          data-testid="login-mode"
          style={{ marginBottom: 12 }}
        />

        <Typography.Paragraph type="secondary">
          {isRegister ? (
            <>
              注册后直接进入；账号与角色存档都保存在服务端，战斗、掉落、成长全部由服务端结算。
            </>
          ) : (
            <>
              登录后经 <Typography.Text code>?token=</Typography.Text> 建立 WS 连接；战斗、掉落、成长全部由服务端结算。
            </>
          )}
        </Typography.Paragraph>

        <Form<AuthFormValues>
          layout="vertical"
          onFinish={(values) => void submit(values)}
          disabled={submitting}
          data-testid="login-form"
        >
          <Form.Item
            name="username"
            label="账号"
            rules={[
              {
                required: true,
                min: AUTH_LIMITS.usernameMin,
                max: AUTH_LIMITS.usernameMax,
                message: AUTH_MESSAGES.username,
              },
            ]}
          >
            <Input placeholder="例如：nightwalker" autoComplete="username" maxLength={AUTH_LIMITS.usernameMax} />
          </Form.Item>
          <Form.Item
            name="password"
            label="口令"
            rules={[{ required: true, min: AUTH_LIMITS.passwordMin, message: AUTH_MESSAGES.password }]}
          >
            <Input.Password
              placeholder="••••••"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </Form.Item>

          {isRegister ? (
            <Form.Item
              name="confirm"
              label="确认口令"
              dependencies={['password']}
              rules={[
                { required: true, message: AUTH_MESSAGES.confirmRequired },
                ({ getFieldValue }) => ({
                  validator(_rule, value: string | undefined) {
                    const password = getFieldValue('password') as string | undefined;
                    if ((value ?? '') === (password ?? '')) return Promise.resolve();
                    return Promise.reject(new Error(AUTH_MESSAGES.confirm));
                  },
                }),
              ]}
            >
              <Input.Password placeholder="••••••" autoComplete="new-password" />
            </Form.Item>
          ) : null}

          {errorMessage === null ? null : (
            <Alert
              type="error"
              showIcon
              title={errorMessage}
              data-testid="login-error"
              style={{ marginBottom: 12 }}
            />
          )}

          <Button type="primary" htmlType="submit" block loading={submitting} data-testid="login-submit">
            {isRegister ? '创建账号' : '进入永夜'}
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
