import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, login } from '../../api/client';

type LoginValues = {
  identifier: string;
  password: string;
};

export function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(values: LoginValues) {
    setLoading(true);
    setError(null);
    try {
      const result = await login(values);
      navigate(result.landingPath, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError({ code: 'CLIENT_ERROR', message: '登录请求失败' }),
      );
    } finally {
      setLoading(false);
    }
  }

  const fieldMessages = Object.values(error?.fields ?? {}).flat();

  return (
    <main className="login-screen">
      <Card className="login-card">
        <Typography.Title level={1}>QMS 2.0</Typography.Title>
        <Typography.Paragraph type="secondary">质量管理基础平台</Typography.Paragraph>
        {error ? (
          <Alert
            showIcon
            type="error"
            title={error.message}
            description={
              <div>
                {fieldMessages.map((message) => (
                  <div key={message}>{message}</div>
                ))}
                {error.traceId ? <code>{error.traceId}</code> : null}
              </div>
            }
          />
        ) : null}
        <Form layout="vertical" onFinish={submit} className="login-form">
          <Form.Item label="账号" name="identifier" rules={[{ required: true, message: '请输入账号' }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button aria-label="登录" block type="primary" htmlType="submit" loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </main>
  );
}
